package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestDisplayReasoningStripsSignatureAndHidesSignatureOnly(t *testing.T) {
	if got, ok := displayReasoning("plain reasoning"); !ok || got != "plain reasoning" {
		t.Fatalf("plain=%q %v", got, ok)
	}
	if _, ok := displayReasoning("<signature>abc</signature>"); ok {
		t.Fatal("signature-only reasoning must be hidden")
	}
	if _, ok := displayReasoning("<signature>abc"); ok {
		t.Fatal("unterminated signature must be hidden")
	}
	in := "<signature>abc</signature>\n\nvisible **summary**\nsecond line"
	got, ok := displayReasoning(in)
	if !ok || got != "visible **summary**\nsecond line" {
		t.Fatalf("stripped=%q %v", got, ok)
	}
	if summary := reasoningFirstLine(got); summary != "visible **summary**" {
		t.Fatalf("summary=%q", summary)
	}
}

func TestReasoningRowUsesOriginalTitleAndPreview(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "r", Role: "assistant", Kind: "assistant", Text: "answer", Turn: 1,
		AssistantBlocks: []assistantBlock{{Kind: "reasoning", Text: "first line\nsecond"}, {Kind: "text", Text: "answer"}},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("思考") || !tt.HasText("first line") {
		t.Fatalf("reasoning disclosure missing title/preview: %v", tt.Texts())
	}
	if tt.HasText("思考过程") {
		t.Fatal("legacy reasoning title survived")
	}
}
