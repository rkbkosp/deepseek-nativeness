package main

import (
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"reflect"
	"strings"
	"testing"
)

func presentationTestApp(t *testing.T, tail string, answer string) *app {
	t.Helper()
	var s snapshot
	raw := `{"sessionId":"p","messages":[{"id":"old","seq":2,"turn":1,"step":1,"role":"assistant","kind":"assistant","text":"earlier text","assistantBlocks":[{"kind":"text","text":"earlier text"}]},` + tail + `],"chatPresentation":{"schemaVersion":1,"presentationEpoch":"chat:1","baselineSerial":1,"presentationRevision":0,"turns":[{"turn":1,"status":"closed","foldEligible":true,"startLoaded":true,"latestStep":2,"endReasonKind":"completed","alwaysOpen":false,"spec":{"turn":1,"controlAnchorSeq":1,"processStartSeq":1,"answerAnchorSeq":` + answer + `,"answerStep":` + map[bool]string{true: "2", false: "null"}[answer != "null"] + `}}],"steps":[{"nodeKey":"step:1:1","turn":1,"step":1,"payloadId":"old","anchorSeq":2,"status":"settled","hasReply":true},{"nodeKey":"step:1:2","turn":1,"step":2,"payloadId":"latest","anchorSeq":4.5,"status":"settled","hasReply":` + map[bool]string{true: "true", false: "false"}[answer != "null"] + `,"hasToolCall":` + map[bool]string{true: "false", false: "true"}[answer != "null"] + `}]}}`
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatal(err)
	}
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.FoldedReplies = "final"
	a.replaceSnapshot(s)
	return a
}

func presentationNotify(t *testing.T, a *app, method string, payload any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var params map[string]json.RawMessage
	if json.Unmarshal(raw, &params) == nil && params["sessionId"] == nil {
		params["sessionId"], _ = json.Marshal(a.sessionID)
		raw, _ = json.Marshal(params)
	}
	a.notification(bridge.Notification{Method: method, Params: raw, Scope: &bridge.NotificationScope{HostID: a.hostID, AccountScope: a.accountScope, Generation: a.remoteGeneration}})
}
func currentPatch(a *app) chatPresentationPatch {
	p := a.current.ChatPresentation
	return chatPresentationPatch{SessionID: a.sessionID, SchemaVersion: 1, BaselineSerial: p.BaselineSerial, PresentationEpoch: p.PresentationEpoch, BaseRevision: p.PresentationRevision, PresentationRevision: p.PresentationRevision + 1}
}
func TestPresentationActualReceiverMetadataBoundaryIsAtomicAndRejectsStale(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"latest text","assistantBlocks":[{"kind":"text","text":"latest text"}]}`, "4.5")
	before := a.chatRowsCache
	_ = a.chatRows()
	before = a.chatRowsCache
	beforeRevision := before.revision
	patch := currentPatch(a)
	turn := a.current.ChatPresentation.Turns[0]
	turn.Spec = &chatProcessSpec{Turn: 1, ControlAnchorSeq: 1, ProcessStartSeq: 1}
	third := 3
	turn.LatestStep = &third
	patch.TurnUpserts = []chatTurn{turn}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	if a.error != "" || a.current.ChatPresentation.PresentationRevision != 1 {
		t.Fatal("actual notification path did not admit metadata-only patch", a.error)
	}
	rows := a.chatRows()
	processCount := 0
	for _, row := range rows {
		if row.Process {
			processCount++
		}
	}
	if a.chatRowsCache.revision == beforeRevision || processCount != 2 {
		t.Fatal("same-turn later empty boundary retained previous final qualification", rows)
	}
	state, _ := json.Marshal(a.current)
	bad := currentPatch(a)
	bad.PayloadChanges.Removes = []string{"latest"}
	bad.StepUpserts = []chatStep{{NodeKey: "invalid", Turn: 1, Step: 4, PayloadID: "missing", AnchorSeq: 7.5}}
	presentationNotify(t, a, "chatPresentationPatch", bad)
	after, _ := json.Marshal(a.current)
	if string(state) != string(after) || a.error == "" {
		t.Fatal("invalid atomic frame changed old valid arena/references")
	}
	a.error = ""
	gap := currentPatch(a)
	gap.BaseRevision += 2
	gap.PresentationRevision += 2
	presentationNotify(t, a, "chatPresentationPatch", gap)
	after, _ = json.Marshal(a.current)
	if string(state) != string(after) || a.error == "" {
		t.Fatal("gap must preserve the prior readable snapshot")
	}
	a.error = ""
	stale := patch
	stale.PayloadChanges.Removes = []string{"old", "latest"}
	presentationNotify(t, a, "chatPresentationPatch", stale)
	after, _ = json.Marshal(a.current)
	if string(state) != string(after) || a.error != "" {
		t.Fatal("duplicate revision was not ignored")
	}
	wrongScopeRaw, _ := json.Marshal(currentPatch(a))
	a.notification(bridge.Notification{Method: "chatPresentationPatch", Params: wrongScopeRaw, Scope: &bridge.NotificationScope{HostID: "other"}})
	after, _ = json.Marshal(a.current)
	if string(state) != string(after) {
		t.Fatal("presentation bypassed captured scope guard")
	}
}
func TestPresentationAtomicSettlementRebindsStablePartsWithoutCopyingHistory(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer","assistantBlocks":[{"kind":"reasoning","text":"first reason"},{"kind":"text","text":"answer"},{"kind":"reasoning","text":"second reason"}]}`, "4.5")
	p := a.current.ChatPresentation
	p.Steps[1].HasReasoning = true
	a.uiPrefs.FoldedReplies = "all"
	rows := a.chatRows()
	var parts []chatPartRef
	for _, r := range rows {
		parts = append(parts, r.Parts...)
	}
	if len(parts) != 3 || parts[1].Part != "reasoning" || parts[2].Part != "response" || parts[1].NodeKey != parts[2].NodeKey {
		t.Fatal("reasoning and response must independently reference one stable node", parts)
	}
	oldArena := &a.current.Messages[0]
	oldText := a.current.Messages[0].Text
	stepKey := parts[2].key()
	patch := currentPatch(a)
	step := p.Steps[1]
	step.PayloadID = "durable"
	seq := int64(9)
	step.FinalEventSeq = &seq
	step.CommittedMessageID = json.RawMessage(`"committed-id"`)
	patch.StepUpserts = []chatStep{step}
	patch.PayloadChanges.Removes = []string{"latest"}
	m := a.current.Messages[1]
	m.ID = "durable"
	m.Seq = 9
	m.SourceMessageID = json.RawMessage(`"committed-id"`)
	patch.PayloadChanges.Upserts = []chatPayloadUpsert{{Message: m, Index: 1}}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	if a.error != "" || len(a.current.Messages) != 2 || &a.current.Messages[0] != oldArena || a.current.Messages[0].Text != oldText {
		t.Fatal("settlement copied/replaced old arena unnecessarily", a.error)
	}
	rows = a.chatRows()
	var response chatPartRef
	for _, r := range rows {
		for _, part := range r.Parts {
			if part.NodeKey == step.NodeKey && part.Part == "response" {
				response = part
			}
		}
	}
	if response.key() != stepKey || response.PayloadID != "durable" || response.AnchorSeq != 4.5 || a.chatPartMessage(response).Seq != 9 {
		t.Fatal("layout anchor, stable key and durable identity were conflated", response)
	}
	cache := a.chatRowsCache
	delta := chatMessageDelta{BaselineSerial: p.BaselineSerial, PresentationEpoch: p.PresentationEpoch, PresentationRevision: &patch.PresentationRevision, MessageID: "durable", TextAppend: " suffix", Streaming: true}
	presentationNotify(t, a, "messageDelta", delta)
	if a.error != "" || a.chatRowsCache != cache || a.chatPartMessage(response).Text != "answer suffix" {
		t.Fatal("ordinary suffix must remain visible through the same part references/cache", a.error)
	}
}
func TestPresentationBaselineSerialPreventsLateRPCAndMissingDeltaEpoch(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer"}`, "4.5")
	old := a.current
	fresh := old
	cp := *old.ChatPresentation
	cp.BaselineSerial = 2
	cp.PresentationEpoch = "chat:2"
	fresh.ChatPresentation = &cp
	fresh.Messages = append([]message(nil), old.Messages...)
	fresh.Messages[1].Text = "new baseline"
	if !a.replaceSnapshot(fresh) {
		t.Fatal(a.error)
	}
	if a.replaceSnapshot(old) || a.current.Messages[1].Text != "new baseline" {
		t.Fatal("late same-scope RPC baseline rolled epoch back")
	}
	delta := chatMessageDelta{BaselineSerial: 2, PresentationEpoch: "chat:2", PresentationRevision: &cp.PresentationRevision, MessageID: "latest", TextAppend: " suffix"}
	presentationNotify(t, a, "messageDelta", delta)
	if a.replaceSnapshot(fresh) || a.current.Messages[1].Text != "new baseline suffix" {
		t.Fatal("duplicate snapshot rewound same-revision suffix")
	}
	presentationNotify(t, a, "messageDelta", map[string]any{"sessionId": a.sessionID, "messageId": "latest", "textAppend": " bypass"})
	if a.current.Messages[1].Text != "new baseline suffix" || a.error == "" {
		t.Fatal("metadata session accepted legacy unversioned delta")
	}
}
func TestPresentationAlwaysOpenAndPartialPrependKeepReadableStableParts(t *testing.T) {
	for _, reason := range []string{"aborted", "interrupted", "error", "open", "partial", "interleaved"} {
		t.Run(reason, func(t *testing.T) {
			a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer"}`, "null")
			turn := &a.current.ChatPresentation.Turns[0]
			turn.AlwaysOpen = false
			turn.EndReasonKind = chatEndReason(reason)
			if reason == "open" || reason == "partial" {
				turn.Status = reason
			}
			if reason == "partial" {
				turn.FoldEligible = false
			}
			if reason == "interleaved" {
				turn.HasInterleavedInput = true
			}
			for _, r := range a.chatRows() {
				if r.Process && (!r.AlwaysOpen || !r.DefaultOpen) {
					t.Fatal("live/stopped/failed/partial/interleaved process can be hidden", r)
				}
			}
		})
	}
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer"}`, "4.5")
	a.uiPrefs.FoldedReplies = "all"
	before := a.chatRows()
	var key string
	for _, r := range before {
		for _, part := range r.Parts {
			if part.PayloadID == "latest" {
				key = part.key()
			}
		}
	}
	newSnapshot := a.current
	newP := *a.current.ChatPresentation
	newP.BaselineSerial = 3
	newP.PresentationEpoch = "chat:3"
	newSnapshot.ChatPresentation = &newP
	newSnapshot.Messages = append([]message{{ID: "older", Kind: "user", Role: "user", Seq: 0, Text: "earlier page"}}, newSnapshot.Messages...)
	if !a.replaceSnapshot(newSnapshot) {
		t.Fatal(a.error)
	}
	found := false
	for _, r := range a.chatRows() {
		for _, part := range r.Parts {
			if part.PayloadID == "latest" {
				found = part.key() == key
			}
		}
	}
	if !found {
		t.Fatal("older prepend changed existing response key")
	}
}
func TestPresentationActualViewKeepsUnknownAndIndependentReasoningBlocks(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","assistantBlocks":[{"kind":"reasoning","text":"first reason"},{"kind":"other","block":{"type":"file","name":"fixture.csv"}},{"kind":"reasoning","text":"second reason"}]}`, "4.5")
	a.current.ChatPresentation.Steps[1].HasReasoning = true
	a.uiPrefs.StepsDetail = "verbose"
	for _, index := range []int{0, 2} {
		key := fmt.Sprintf("step:1:2:reasoning:%d", index)
		a.foldState(key, true)
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("first reason") || !tt.HasText("second reason") || !tt.HasText("未知内容块") {
		t.Fatal("actual view lost part ordering/rich block disclosures")
	}
	var refs []string
	for _, r := range a.chatRows() {
		for _, part := range r.Parts {
			refs = append(refs, part.Part)
		}
	}
	if !reflect.DeepEqual(refs, []string{"response", "reasoning", "response"}) {
		t.Fatal(refs)
	}
}

func TestPresentationAtomicSuffixValidationNeverPartiallyChangesArena(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer","assistantBlocks":[{"kind":"text","text":"answer"}]}`, "4.5")
	before, _ := json.Marshal(a.current)
	patch := currentPatch(a)
	zero, bad := 0, 5
	patch.PayloadChanges.Deltas = []chatMessageDelta{{MessageID: "latest", TextAppend: " first", TextBlockIndex: &zero}, {MessageID: "latest", TextAppend: " invalid", TextBlockIndex: &bad}}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	after, _ := json.Marshal(a.current)
	if string(before) != string(after) || a.error == "" {
		t.Fatal("later invalid suffix allowed the first suffix to mutate the arena")
	}
	patch.PayloadChanges.Deltas = patch.PayloadChanges.Deltas[:1]
	a.error = ""
	presentationNotify(t, a, "chatPresentationPatch", patch)
	if a.error != "" || a.current.Messages[1].Text != "answer first" || a.current.Messages[1].AssistantBlocks[0].Text != "answer first" {
		t.Fatal("valid atomic suffix did not commit both representations", a.error)
	}
}

func BenchmarkPresentationSuffixRows(b *testing.B) {
	for _, n := range []int{1000, 10000} {
		b.Run(fmt.Sprint(n), func(b *testing.B) {
			a := &app{uiPrefs: defaultViewPreferences(), sessionID: "budget", current: snapshot{SessionID: "budget"}}
			p := &chatPresentation{SchemaVersion: 1, BaselineSerial: 1, PresentationEpoch: "chat:1"}
			for i := 0; i < n; i++ {
				id := fmt.Sprintf("body:%d", i)
				answer, anchor, step := float64(i*3+1), float64(i*3+1), 1
				p.Turns = append(p.Turns, chatTurn{Turn: i, Status: "closed", StartLoaded: true, FoldEligible: true, LatestStep: &step, Spec: &chatProcessSpec{Turn: i, ProcessStartSeq: float64(i * 3), ControlAnchorSeq: float64(i * 3), AnswerAnchorSeq: &answer, AnswerStep: &step}})
				p.Steps = append(p.Steps, chatStep{NodeKey: id, PayloadID: id, Turn: i, Step: 1, AnchorSeq: anchor, HasReply: true, Status: "settled"})
				a.current.Messages = append(a.current.Messages, message{ID: id, Role: "assistant", Kind: "assistant", Turn: i, Step: 1, Text: "chunk", AssistantBlocks: []assistantBlock{{Kind: "text", Text: "chunk"}}})
			}
			a.current.ChatPresentation = p
			a.reindexMessages()
			a.chatRows()
			cache := a.chatRowsCache
			raw := json.RawMessage(fmt.Sprintf(`{"sessionId":"budget","baselineSerial":1,"presentationEpoch":"chat:1","presentationRevision":0,"messageId":"body:%d","textAppend":"!","textBlockIndex":0,"streaming":true}`, n-1))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m := &a.current.Messages[n-1]
				m.Text = "chunk"
				m.AssistantBlocks[0].Text = "chunk"
				if err := a.applyIncremental("messageDelta", raw); err != nil {
					b.Fatal(err)
				}
				rows := a.chatRows()
				last := rows[len(rows)-1].Parts[0]
				if a.chatRowsCache != cache || a.chatPartMessage(last).AssistantBlocks[0].Text != "chunk!" {
					b.Fatal("fresh suffix not visible through retained part arena")
				}
			}
		})
	}
}

func TestPresentationInterruptedReasoningWhitespacePreservesOriginalMarkerRule(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	m := message{ID: "stopped-whitespace", Role: "assistant", Interrupted: true, AssistantBlocks: []assistantBlock{{Kind: "reasoning", Text: "partial reasoning"}, {Kind: "text", Text: " \n\t"}}}
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.messagePartView(c, m, "reasoning", "stable-step") }, 640, 400)
	tt.Frame()
	count := 0
	for _, text := range tt.Texts() {
		if text == "已停止" {
			count++
		}
	}
	if count != 0 {
		t.Fatal("original raw blank-text block suppresses the reasoning-part terminal marker", count)
	}
	m.Interrupted = false
	tt.Frame()
	if tt.HasText("已停止") {
		t.Fatal("normal completed reasoning got a stopped tag")
	}
}

func TestPresentationArenaOrderAndForeignTurnBarrierSurvivePartialRegroup(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"last"}`, "null")
	// An input outside the Turn remains at its arena position, even though the
	// same foreign Turn also appeared before the first assistant body.
	m := a.current.Messages
	a.current.Messages = []message{{ID: "input-first", Role: "user", Kind: "user", Turn: 0, Seq: 0, Text: "first"}, m[0], {ID: "input-middle", Role: "user", Kind: "user", Turn: 0, Seq: 4, Text: "middle"}, m[1]}
	a.current.ChatPresentation.Steps[1].HasReply = true
	a.current.ChatPresentation.Steps[1].HasToolCall = false
	a.reindexMessages()
	a.invalidateChatRows()
	check := func() {
		var ids []string
		for _, r := range a.chatRows() {
			for _, part := range r.Parts {
				ids = append(ids, part.PayloadID)
			}
		}
		if !reflect.DeepEqual(ids, []string{"input-first", "old", "input-middle", "latest"}) {
			t.Fatal("per-turn cache reordered nonassistant nodes or grouped across foreign input", ids)
		}
	}
	check()
	patch := currentPatch(a)
	turn := a.current.ChatPresentation.Turns[0]
	turn.LatestStep = nil
	patch.TurnUpserts = []chatTurn{turn}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	check()
	for _, row := range a.chatRows() {
		if row.Process && len(row.Parts) > 1 {
			t.Fatal("process group crossed an intervening input from another location")
		}
	}
}

func TestPresentationRetiredAssistantNeverFallsBackToPrintableLegacyBody(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"must disappear after retry"}`, "4.5")
	patch := currentPatch(a)
	patch.StepRemoves = []string{"step:1:2"}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	for _, r := range a.chatRows() {
		for _, part := range r.Parts {
			if part.PayloadID == "latest" {
				t.Fatal("retired original node was promoted via printable arena Text")
			}
		}
	}
	if a.current.Messages[1].Text != "must disappear after retry" {
		t.Fatal("retiring a UI reference erased the retained source body")
	}
}

func BenchmarkPresentationMetadataBoundary(b *testing.B) {
	for _, n := range []int{1000, 10000} {
		b.Run(fmt.Sprint(n), func(b *testing.B) {
			a := &app{uiPrefs: defaultViewPreferences(), sessionID: "boundary", current: snapshot{SessionID: "boundary"}}
			p := &chatPresentation{SchemaVersion: 1, BaselineSerial: 1, PresentationEpoch: "chat:1"}
			for i := 0; i < n; i++ {
				id := fmt.Sprintf("body:%d", i)
				answer, anchor, step := float64(i*3+1), float64(i*3+1), 1
				p.Turns = append(p.Turns, chatTurn{Turn: i, Status: "closed", StartLoaded: true, FoldEligible: true, LatestStep: &step, Spec: &chatProcessSpec{Turn: i, ProcessStartSeq: float64(i * 3), ControlAnchorSeq: float64(i * 3), AnswerAnchorSeq: &answer, AnswerStep: &step}})
				p.Steps = append(p.Steps, chatStep{NodeKey: id, PayloadID: id, Turn: i, Step: 1, AnchorSeq: anchor, HasReply: true, Status: "settled"})
				a.current.Messages = append(a.current.Messages, message{ID: id, Role: "assistant", Kind: "assistant", Turn: i, Step: 1, Seq: int64(i*3 + 1), Text: "unchanged history"})
			}
			a.current.ChatPresentation = p
			a.reindexMessages()
			a.chatRows()
			turn := p.Turns[n-1]
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				patch := currentPatch(a)
				patch.TurnUpserts = []chatTurn{turn}
				raw, _ := json.Marshal(patch)
				if err := a.applyIncremental("chatPresentationPatch", raw); err != nil {
					b.Fatal(err)
				}
				rows := a.chatRows()
				if len(rows) != n*2 || a.current.Messages[n-1].Text != "unchanged history" {
					b.Fatal("boundary damaged historical arena")
				}
			}
		})
	}
}

func BenchmarkPresentationLongTurnBoundary(b *testing.B) {
	for _, n := range []int{1000, 10000} {
		for _, replies := range []string{"all", "final"} {
			b.Run(fmt.Sprintf("%d/%s", n, replies), func(b *testing.B) {
				a := &app{uiPrefs: defaultViewPreferences(), sessionID: "long", current: snapshot{SessionID: "long"}}
				a.uiPrefs.FoldedReplies = replies
				answer, last := float64(n*2), n
				p := &chatPresentation{SchemaVersion: 1, BaselineSerial: 1, PresentationEpoch: "chat:1", Turns: []chatTurn{{Turn: 1, Status: "closed", StartLoaded: true, FoldEligible: true, LatestStep: &last, Spec: &chatProcessSpec{Turn: 1, ControlAnchorSeq: 1, ProcessStartSeq: 1, AnswerAnchorSeq: &answer, AnswerStep: &last}}}}
				for i := 0; i < n; i++ {
					id := fmt.Sprintf("body:%d", i)
					p.Steps = append(p.Steps, chatStep{NodeKey: id, PayloadID: id, Turn: 1, Step: i + 1, AnchorSeq: float64((i + 1) * 2), HasReply: true, Status: "settled"})
					a.current.Messages = append(a.current.Messages, message{ID: id, Role: "assistant", Kind: "assistant", Turn: 1, Step: i + 1, Seq: int64((i + 1) * 2), Text: strings.Repeat("historical ", 200) + id})
				}
				a.current.ChatPresentation = p
				a.reindexMessages()
				a.chatRows()
				turn := p.Turns[0]
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					nextTurn := turn
					spec := *turn.Spec
					if i%2 == 0 {
						spec.AnswerStep = nil
						spec.AnswerAnchorSeq = nil
					}
					nextTurn.Spec = &spec
					patch := currentPatch(a)
					patch.TurnUpserts = []chatTurn{nextTurn}
					raw, _ := json.Marshal(patch)
					if err := a.applyIncremental("chatPresentationPatch", raw); err != nil {
						b.Fatal(err)
					}
					rows := a.chatRows()
					if len(rows) == 0 || a.current.Messages[n-1].ID != fmt.Sprintf("body:%d", n-1) {
						b.Fatal("lost historical arena")
					}
				}
			})
		}
	}
}

func TestPresentationClosingUnknownIsReplyWithoutTextPlaceholder(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","assistantBlocks":[{"kind":"other","block":{"type":"file","name":"fixture.csv"}}]}`, "4.5")
	for _, row := range a.chatRows() {
		if row.Process {
			continue
		}
		for _, part := range row.Parts {
			if part.PayloadID == "latest" {
				return
			}
		}
	}
	t.Fatal("original latest-step unknown reply must remain outside folded process even without Text")
}

func TestPresentationLaterToolOnlyDoesNotFallBackToEarlierText(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","assistantBlocks":[{"kind":"tool-call","callId":"fixture"}]}`, "null")
	for _, row := range a.chatRows() {
		if !row.Process && !row.Control {
			t.Fatal("chronological latest tool-only step must not promote earlier text as final")
		}
	}
}

func TestHistorySnapshotAdoptionIsExplicitAndMonotonic(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer"}`, "null")
	old := a.current
	older := message{ID: "older", Seq: 1, Role: "user", Kind: "user", Text: "older", Turn: 1}
	merged := old
	merged.Messages = append([]message{older}, old.Messages...)
	p := *old.ChatPresentation
	merged.ChatPresentation = &p
	if a.replaceSnapshot(merged) {
		t.Fatal("ordinary duplicate snapshot must not replace the arena")
	}
	adopted := a.adoptHistorySnapshot(merged)
	if !adopted {
		t.Fatalf("history adoption failed: err=%q currentSession=%q targetSession=%q baseline=%d/%d revision=%d/%d", a.error, a.current.SessionID, merged.SessionID, a.current.ChatPresentation.BaselineSerial, merged.ChatPresentation.BaselineSerial, a.current.ChatPresentation.PresentationRevision, merged.ChatPresentation.PresentationRevision)
	}
	if len(a.current.Messages) != 3 || a.current.Messages[0].ID != "older" {
		t.Fatalf("history adoption arena=%v", a.current.Messages)
	}
	a.current.ChatPresentation.PresentationRevision = 1
	stale := merged
	stalePresentation := p
	stalePresentation.PresentationRevision = 0
	stale.ChatPresentation = &stalePresentation
	if a.adoptHistorySnapshot(stale) {
		t.Fatal("history adoption accepted a reworded revision")
	}
}
