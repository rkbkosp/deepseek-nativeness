package main

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestFormatTokensPerSecondMatchesOriginalLadder(t *testing.T) {
	for _, tc := range []struct {
		in   float64
		want string
	}{
		{-1, "0"},
		{0, "0"},
		{3.14, "3.1"},
		{9.96, "10"},
		{20, "20"},
		{34.4, "34"},
		{268.94, "269"},
	} {
		if got := formatTokensPerSecond(tc.in); got != tc.want {
			t.Fatalf("formatTokensPerSecond(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSessionReadingPrefersWholeLogProjections(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{
		SessionID: "s",
		Turns:     []json.RawMessage{json.RawMessage(`{"turn":1,"startTime":1000,"endTime":5000}`)},
		Messages: []message{{
			ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Step: 1,
			Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`),
		}},
	}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{
		SessionStats: &sessionStatsProjection{Turns: 3, Steps: 7, DecodeMs: 2000, DecodeTokens: 50},
		TokenUsage:   &tokenUsageProjection{UncachedInputTokens: 10, CacheReadTokens: 90, OutputTokens: 5, CacheWriteTokens: 5},
	}}
	reading := a.sessionReading()
	if reading.turns != 3 || reading.steps != 7 {
		t.Fatalf("counts = %d轮 %d步, want projection 3轮 7步", reading.turns, reading.steps)
	}
	tps, ok := reading.tokensPerSecond()
	if !ok || formatTokensPerSecond(tps) != "25" {
		t.Fatalf("speed = %v (%v), want 25 tok/s from the projection's decode window", tps, ok)
	}
	// Usage rides tokenUsage: prompt-side billed input plus output.
	if reading.tokens != 110 || reading.promptTokens != 105 || reading.outputTokens != 5 {
		t.Fatalf("usage = total %d prompt %d output %d, want 110/105/5", reading.tokens, reading.promptTokens, reading.outputTokens)
	}
}

func TestSessionReadingFallsBackToTurnWallTimeWithoutProjection(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{
		SessionID: "s",
		Turns:     []json.RawMessage{json.RawMessage(`{"turn":1,"startTime":1000,"endTime":5000}`)},
		Messages: []message{{
			ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Step: 1,
			Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`),
		}},
	}
	a.composer = &composerState{sessionID: "s"}
	if tps, ok := a.sessionReading().tokensPerSecond(); !ok || formatTokensPerSecond(tps) != "5" {
		t.Fatalf("fallback speed = %v (%v), want 5 tok/s over the 4s Turn", tps, ok)
	}
}

func TestAcceptComposerProjectionsKeepsSessionStatsAndTokenUsage(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.composer = &composerState{hostID: a.hostID, sessionID: "s", generation: a.remoteGeneration}
	raw := json.RawMessage(`{"values":{"sessionStats":{"turns":2,"steps":4,"llmMs":6000,"toolMs":500,"ttftMs":400,"ttftSteps":2,"decodeMs":1000,"decodeTokens":30},"tokenUsage":{"uncachedInputTokens":3,"outputTokens":7,"cacheReadTokens":90,"cacheWriteTokens":0}},"asOfSeq":9}`)
	if err := a.acceptComposerProjections(raw); err != nil {
		t.Fatal(err)
	}
	stats := a.composer.values.SessionStats
	if stats == nil || stats.Turns != 2 || stats.Steps != 4 || stats.DecodeMs != 1000 || stats.DecodeTokens != 30 {
		t.Fatalf("sessionStats not consumed: %+v", stats)
	}
	usage := a.composer.values.TokenUsage
	if usage == nil || usage.total() != 100 || usage.billedInput() != 93 {
		t.Fatalf("tokenUsage not consumed: %+v", usage)
	}
}

func TestComposerStatsShowTokenSpeedFromProjection(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{SessionID: "s", Messages: []message{{
		ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Step: 1, Text: "answer",
		Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`),
	}}}
	a.composer = &composerState{hostID: a.hostID, sessionID: "s", generation: a.remoteGeneration, values: composerProjectionValues{
		SessionStats: &sessionStatsProjection{Turns: 2, Steps: 6, DecodeMs: 3000, DecodeTokens: 450},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("2轮 6步 · 150 tok/s") {
		t.Fatalf("footer missing projected token speed: %v", tt.Texts())
	}
}
