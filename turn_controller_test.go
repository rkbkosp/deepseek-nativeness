package main

import (
	"bytes"
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"os/exec"
	"reflect"
	"testing"
)

func TestTurnControllerIsSingleForAllRepliesAndSharesFoldState(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"latest response","assistantBlocks":[{"kind":"reasoning","text":"latest reasoning"},{"kind":"text","text":"latest response"}]}`, "4.5")
	a.uiPrefs.FoldedReplies = "all"
	a.current.ChatPresentation.Steps[0].HasReasoning = true
	a.current.ChatPresentation.Steps[1].HasReasoning = true
	a.current.Messages[0].AssistantBlocks = append([]assistantBlock{{Kind: "reasoning", Text: "old reasoning"}}, a.current.Messages[0].AssistantBlocks...)
	before, _ := json.Marshal(a.current.Messages)
	controls := 0
	var controller chatRow
	for _, row := range a.chatRows() {
		if row.Control {
			controls++
			controller = row
		}
	}
	if controls != 1 || !controller.CanCollapse || controller.LayoutAnchor != .9 {
		t.Fatal("turn must have one independent fractional controller", controls, controller)
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("latest response") || tt.HasText("已完成分析") {
		t.Fatal("all replies must remain visible while their independent reasoning folds")
	}
	if err := tt.Click("轮次执行过程 1"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	tt.Frame()
	if !tt.HasText("已完成分析") || !tt.HasText("latest response") {
		t.Fatal("shared turn control did not reveal all reasoning groups")
	}
	count := 0
	for _, label := range tt.Texts() {
		if label == "已完成" {
			count++
		}
	}
	if count != 1 {
		t.Fatal("process segments duplicated the whole-turn controller", count)
	}
	if err := tt.Click("轮次执行过程 1"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	tt.Frame()
	if tt.HasText("已完成分析") {
		t.Fatal("one control failed to close every process segment")
	}
	after, _ := json.Marshal(a.current.Messages)
	if string(before) != string(after) {
		t.Fatal("folding changed payload identities or body")
	}
}
func TestTurnControllerPureFinalAndOpenTurnRules(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"final"}`, "4.5")
	// Keep only the closing text: there is no external process content.
	a.current.Messages = a.current.Messages[1:]
	a.current.ChatPresentation.Steps = a.current.ChatPresentation.Steps[1:]
	a.reindexMessages()
	a.invalidateChatRows()
	rows := a.chatRows()
	if len(rows) != 2 || !rows[0].Control || rows[0].CanCollapse || rows[1].Parts[0].PayloadID != "latest" {
		t.Fatal("pure final still needs one disabled closing controller", rows)
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("已完成") {
		t.Fatal("closed pure final lost its completed status")
	}
	patch := currentPatch(a)
	turn := a.current.ChatPresentation.Turns[0]
	turn.Status = "open"
	turn.AlwaysOpen = true
	patch.TurnUpserts = []chatTurn{turn}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	tt.Frame()
	if tt.HasText("已完成") {
		t.Fatal("live turn painted a false closed controller")
	}
}
func TestTurnControllerManualChoiceSurvivesDefaultTimingUntilAnswerChanges(t *testing.T) {
	a := presentationTestApp(t, `{"id":"latest","seq":5,"turn":1,"step":2,"role":"assistant","kind":"assistant","text":"answer"}`, "4.5")
	var control chatRow
	for _, r := range a.chatRows() {
		if r.Control {
			control = r
		}
	}
	a.toggleTurnProcess(control)
	if !a.turnProcessIsOpen(control) {
		t.Fatal("explicit open not retained")
	}
	a.uiPrefs.StepsCollapse = "next-input"
	patch := currentPatch(a)
	patch.PayloadChanges.Upserts = []chatPayloadUpsert{{Index: 2, Message: message{ID: "next-input", Kind: "user", Role: "user", Turn: 2, Seq: 8, Text: "new input"}}}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	for _, r := range a.chatRows() {
		if r.Control && r.Turn == 1 {
			control = r
		}
	}
	if !a.turnProcessIsOpen(control) {
		t.Fatal("default timing erased a saved choice for the same answer generation")
	}
	patch = currentPatch(a)
	turn := a.current.ChatPresentation.Turns[0]
	s := *turn.Spec
	s.AnswerStep = nil
	s.AnswerAnchorSeq = nil
	turn.Spec = &s
	patch.TurnUpserts = []chatTurn{turn}
	presentationNotify(t, a, "chatPresentationPatch", patch)
	for _, r := range a.chatRows() {
		if r.Control && r.Turn == 1 {
			control = r
		}
	}
	if a.turnProcessIsOpen(control) {
		t.Fatal("a new answer generation reused an obsolete disclosure choice")
	}
}
func TestAssistantNonblankMatchesECMAScriptTrim(t *testing.T) {
	values := []string{"", " ", "\ufeff", "\u0085", "\u180e", "\u200b", "\u00a0", "\u2028", "\u2029", "\u1680", "\u2007", "\u202f", "\u205f", "\u3000", "\t\r\n\ufeff", " \ufeff\u0085 "}
	raw, _ := json.Marshal(values)
	cmd := exec.Command("node", "--input-type=module", "-e", "let raw='';for await(const c of process.stdin)raw+=c;console.log(JSON.stringify(JSON.parse(raw).map(s=>s.trim()!=='')))")
	cmd.Stdin = bytes.NewReader(raw)
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	var want []bool
	if json.Unmarshal(output, &want) != nil {
		t.Fatal("invalid Node oracle")
	}
	var got []bool
	for _, s := range values {
		got = append(got, assistantNonblank(s))
	}
	if !reflect.DeepEqual(want, got) {
		t.Fatal("native blank classification diverges from pinned JS predicate", want, got)
	}
}
