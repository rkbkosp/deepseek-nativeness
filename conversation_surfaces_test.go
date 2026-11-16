package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
)

func TestHistoryHeroSteeringAndStatsSurfaces(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{SessionID: "s", HasMore: true, Messages: []message{{ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Text: "answer", Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`), AssistantBlocks: []assistantBlock{{Kind: "text", Text: "answer"}}}}}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{Inbox: map[string][]composerQueueItem{
		"next-step": {{ID: "steer", Source: json.RawMessage(`{"kind":"user","rpcId":"r-1"}`), Content: []struct {
			Type       string          `json:"type"`
			Text       string          `json:"text"`
			Attachment json.RawMessage `json:"attachment"`
		}{{Type: "text", Text: "插话内容"}}}},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	for _, want := range []string{"加载更早", "插话内容", "1轮 1步", "100 tok"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q", want)
		}
	}

	empty := newApp(true)
	t.Cleanup(empty.cancel)
	empty.sessionID = "blank"
	empty.current = snapshot{SessionID: "blank"}
	et := ui.NewTester(empty.view, 1280, 820)
	et.Frame()
	if !et.HasText("探索未至之境") || !et.HasText("预览版") {
		t.Fatalf("hero missing: %v", et.Texts())
	}
}

func TestTriggerCardRendersSourceKind(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "t", Role: "context", Kind: "context", Trigger: "github", Text: "event body", Time: 1700000000000}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("收到 GitHub 事件") {
		t.Fatalf("trigger card missing: %v", tt.Texts())
	}
}

func TestTodoPanelUsesProjectedList(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	todos := []todoItem{{Content: "读取文件", Status: "completed"}, {Content: "运行测试", Status: "in_progress"}}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{Todos: &todos}}
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "u", Role: "user", Text: "go", Turn: 1}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("任务") || !tt.HasText("1 已完成  ·  1 进行中") {
		t.Fatalf("todo panel missing: %v", tt.Texts())
	}
}

func TestHeaderShowsModeSubagentsAndBackgroundJobs(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	preset := "ptc"
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{
		AgentPreset:     &preset,
		SubagentCatalog: []subagentEntry{{ID: "child", Label: "worker", Mode: "continuable"}},
	}}
	a.current = snapshot{SessionID: "s", Messages: []message{
		{ID: "u", Role: "user", Text: "go", Turn: 1},
		{ID: "job", Role: "tool", Kind: "tool", Turn: 1, Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":"sleep 10","run_in_background":true}`}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("PTC 模式") || !tt.HasText("worker") {
		// "worker" is inside the closed menu, so only the count is visible.
		if !tt.HasText("PTC 模式") {
			t.Fatalf("mode label missing: %v", tt.Texts())
		}
	}
	if !tt.HasText("1") {
		t.Fatalf("subagent/job counts missing: %v", tt.Texts())
	}
}

func TestRetryRowUsesProjectedAttempt(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: "s", Messages: []message{
		{ID: "u", Role: "user", Text: "go", Turn: 1},
		{ID: "retry", Role: "context", Kind: "model-retry", Turn: 1, Retry: json.RawMessage(`{"retry":2,"delayMs":1500,"mode":"normal","failure":{"message":"network"}}`)},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("模型重试") || !tt.HasText("第 2 次 · 等待 2 秒") {
		t.Fatalf("retry row missing: %v", tt.Texts())
	}
}

// A pending card blocks the turn that asks it, so it answers from the keyboard
// too: Enter takes the choice that has the focus and Esc takes the card's cancel
// choice, in a launch that owns its Host and in a Remote one alike (this is the
// same view code for both).

// pendingAnswerHelper is the fake helper behind the card: it records every
// request and answers with an empty result, which is all the acceptance test
// looks at.
func pendingAnswerHelper(logPath string) string {
	return fmt.Sprintf(`const fs = require("node:fs");
const readline = require("node:readline");
const logPath = %q;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(logPath, JSON.stringify({ method: request.method, params: request.params }) + "\n");
  process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\n");
});
`, logPath)
}

// pendingAnswer card sets: a card in the composer seat and the requests it sent.
type pendingCardFixture struct {
	a     *app
	tt    *ui.Tester
	log   string
	ctx   context.Context
	queue chan func()
}

func newPendingCardFixture(t *testing.T, p interaction) *pendingCardFixture {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required for the stdio helper fixture")
	}
	dir := t.TempDir()
	logPath := filepath.Join(dir, "answers.jsonl")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	client, err := bridge.Start(ctx, node, "-e", pendingAnswerHelper(logPath))
	if err != nil {
		t.Fatalf("start the fixture helper: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	a := newApp(false)
	t.Cleanup(a.cancel)
	a.client = client
	a.connected = true
	a.hostID = "fixture-host"
	a.accountScope = "fixture-account"
	a.sessionID = "fixture-session"
	a.current = snapshot{SessionID: a.sessionID, Pending: []interaction{p}}
	f := &pendingCardFixture{a: a, log: logPath, ctx: ctx, queue: make(chan func(), 32)}
	a.testDispatch = func(fn func()) { f.queue <- fn }
	f.tt = ui.NewTester(a.view, 1280, 820)
	f.tt.Frame()
	return f
}

// answers returns the requests the helper received, in order.
func (f *pendingCardFixture) answers(t *testing.T) []struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
} {
	t.Helper()
	raw, err := os.ReadFile(f.log)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		t.Fatalf("read the helper log: %v", err)
	}
	var out []struct {
		Method string         `json:"method"`
		Params map[string]any `json:"params"`
	}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line == "" {
			continue
		}
		var entry struct {
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("helper log line %q: %v", line, err)
		}
		out = append(out, entry)
	}
	return out
}

// settle runs the queued window updates until the card has sent another answer.
func (f *pendingCardFixture) settle(t *testing.T, want int) []struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
} {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if answers := f.answers(t); len(answers) >= want {
			return answers
		}
		select {
		case fn := <-f.queue:
			fn()
		case <-f.ctx.Done():
			t.Fatalf("fixture helper context: %v", f.ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	t.Fatalf("the card sent %d answers, want %d", len(f.answers(t)), want)
	return nil
}

// flush runs the window updates already queued, so the card is done answering
// before the next key press looks at it.
func (f *pendingCardFixture) flush(t *testing.T) {
	t.Helper()
	for {
		select {
		case fn := <-f.queue:
			fn()
		case <-time.After(50 * time.Millisecond):
			return
		case <-f.ctx.Done():
			t.Fatalf("fixture helper context: %v", f.ctx.Err())
		}
	}
}

// The choice under the focus is what Enter confirms, and the card's cancel
// choice is what Esc takes.
func TestPendingApprovalCardAnswersFromTheKeyboard(t *testing.T) {
	f := newPendingCardFixture(t, interaction{ID: "req-1", Kind: "approval", Title: "需要审批", Reason: "运行命令前需要确认"})
	if !f.tt.HasText("需要审批") || !f.tt.HasText("允许一次") || !f.tt.HasText("拒绝") {
		t.Fatalf("approval card missing: %v", f.tt.Texts())
	}
	// Tab reaches the pair as one stop; a click lands on the same focus.
	if err := f.tt.Click("允许一次"); err != nil {
		t.Fatal(err)
	}
	if !f.tt.Focused("允许一次") {
		t.Fatalf("the clicked choice does not hold the focus: %v", f.tt.Texts())
	}
	f.tt.Key(0, ui.KeyEnter)
	f.tt.Frame()
	answers := f.settle(t, 1)
	if answers[0].Method != "answerApproval" {
		t.Fatalf("Enter sent %q", answers[0].Method)
	}
	if answers[0].Params["requestId"] != "req-1" || answers[0].Params["outcome"] != "allowed-once" {
		t.Fatalf("Enter answer = %v, want the focused allow choice", answers[0].Params)
	}
	f.flush(t)

	// The same focus takes the card's cancel choice with Esc, and the pending
	// card that is still waiting answers again.
	f.tt.Frame()
	f.tt.Key(0, ui.KeyEscape)
	f.tt.Frame()
	answers = f.settle(t, 2)
	if answers[1].Method != "answerApproval" || answers[1].Params["outcome"] != "rejected" {
		t.Fatalf("Esc answer = %v %v", answers[1].Method, answers[1].Params)
	}
	if answers[1].Params["requestId"] != "req-1" {
		t.Fatalf("Esc answered %v", answers[1].Params["requestId"])
	}
}

// The question card's cancel is its own: Esc sends the same cancellation its
// "取消回答" button sends.
func TestPendingQuestionCardCancelsFromTheKeyboard(t *testing.T) {
	f := newPendingCardFixture(t, interaction{ID: "req-q", Kind: "questions", Title: "需要你的回答", Questions: []question{{
		ID: "q1", Question: "选一个", Options: []questionOption{{Label: "甲"}, {Label: "乙"}},
	}}})
	if !f.tt.HasText("需要你的回答") || !f.tt.HasText("取消回答") {
		t.Fatalf("question card missing: %v", f.tt.Texts())
	}
	if err := f.tt.Click("甲"); err != nil {
		t.Fatal(err)
	}
	if !f.tt.Focused("甲") {
		t.Fatal("the clicked option does not hold the focus")
	}
	f.tt.Frame()
	f.tt.Key(0, ui.KeyEscape)
	f.tt.Frame()
	answers := f.settle(t, 1)
	if answers[0].Method != "answerQuestions" {
		t.Fatalf("Esc sent %q", answers[0].Method)
	}
	if answers[0].Params["cancelled"] != true || answers[0].Params["requestId"] != "req-q" {
		t.Fatalf("Esc answer = %v", answers[0].Params)
	}
}

// The card's keyboard routes are decided by pure tables, so the buttons and the
// two keys cannot disagree about which answer is the default or the cancel.
func TestPendingChoicesDefaultAndCancel(t *testing.T) {
	choices := approvalChoices()
	defaults, cancels := 0, 0
	for _, choice := range choices {
		if choice.Default {
			defaults++
			if choice.Outcome != "allowed-once" {
				t.Errorf("default choice = %q, want the allow outcome", choice.Outcome)
			}
		}
		if choice.Cancel {
			cancels++
			if choice.Outcome != "rejected" {
				t.Errorf("cancel choice = %q, want the reject outcome", choice.Outcome)
			}
		}
	}
	if len(choices) != 2 || defaults != 1 || cancels != 1 {
		t.Fatalf("approval choices = %+v", choices)
	}

	method, params := pendingCancelRequest(interaction{ID: "a", Kind: "approval"})
	if method != "answerApproval" || params["outcome"] != "rejected" || params["requestId"] != "a" {
		t.Errorf("approval cancel = %q %v", method, params)
	}
	method, params = pendingCancelRequest(interaction{ID: "q", Kind: "questions"})
	if method != "answerQuestions" || params["cancelled"] != true || params["requestId"] != "q" {
		t.Errorf("questions cancel = %q %v", method, params)
	}
	if method, _ := pendingCancelRequest(interaction{ID: "x", Kind: "plan-review"}); method != "" {
		t.Errorf("an unknown card kind invented a cancel: %q", method)
	}
}
