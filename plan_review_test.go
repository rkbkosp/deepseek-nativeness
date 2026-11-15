package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// planReviewFixture decodes a Host plan-review request from its wire form: one
// question carrying the plan as `detail` and the approving option's label in
// `intent.approve`, exactly as `dsh-api-session-controller` describes it. Going
// through JSON also proves the two intent fields survive decoding.
func planReviewFixture(t *testing.T) interaction {
	t.Helper()
	const wire = `{
		"id": "req-plan",
		"kind": "questions",
		"title": "需要你的回答",
		"questions": [{
			"id": "q-plan",
			"header": "计划模式",
			"question": "是否按这个计划开始实施？",
			"detail": "# 迁移会话存储\n\n把会话存储从 JSON 文件迁到 SQLite，先双写再截断。\n\n## 步骤\n\n1. 增加迁移脚本\n2. 双写一周\n3. 切换读取\n",
			"options": [
				{"label": "同意执行", "description": "开始实施计划"},
				{"label": "拒绝", "description": "回到计划模式修改"}
			],
			"intent": {"kind": "plan-review", "approve": "同意执行", "callId": "call-plan-7"}
		}]
	}`
	var p interaction
	if err := json.Unmarshal([]byte(wire), &p); err != nil {
		t.Fatalf("decode the fixture request: %v", err)
	}
	return p
}

// The card shows the plan and submits the approving option by its label.
func TestPlanReviewCardApprovesWithTheOptionLabel(t *testing.T) {
	f := newPendingCardFixture(t, planReviewFixture(t))
	if !f.tt.HasText("计划待审") || !f.tt.HasText("批准") || !f.tt.HasText("拒绝") {
		t.Fatalf("plan card missing: %v", f.tt.Texts())
	}
	if !f.tt.HasText("迁移会话存储") {
		t.Fatalf("plan summary missing: %v", f.tt.Texts())
	}
	if !f.tt.HasText("是否按这个计划开始实施？") {
		t.Fatalf("the asker's question is not shown: %v", f.tt.Texts())
	}
	if err := f.tt.Click("批准"); err != nil {
		t.Fatal(err)
	}
	if !f.tt.Focused("批准") {
		t.Fatalf("the clicked verdict does not hold the focus: %v", f.tt.Texts())
	}
	f.tt.Frame()
	f.tt.Key(0, ui.KeyEnter)
	f.tt.Frame()
	answers := f.settle(t, 1)
	if answers[0].Method != "answerQuestions" {
		t.Fatalf("Enter sent %q", answers[0].Method)
	}
	if answers[0].Params["requestId"] != "req-plan" {
		t.Fatalf("Enter answered %v", answers[0].Params["requestId"])
	}
	rows, ok := answers[0].Params["answers"].([]any)
	if !ok || len(rows) != 1 {
		t.Fatalf("answers = %v", answers[0].Params["answers"])
	}
	answer, _ := rows[0].(map[string]any)
	if answer["id"] != "q-plan" {
		t.Fatalf("answer id = %v", answer["id"])
	}
	selected, _ := answer["selected"].([]any)
	// The label, never an index or a position.
	if len(selected) != 1 || selected[0] != "同意执行" {
		t.Fatalf("selected = %v, want the approve option label", selected)
	}
}

// The declining verdict submits the other option's own label, and Esc cancels
// the whole request through the questions path.
func TestPlanReviewCardDeclinesAndCancels(t *testing.T) {
	f := newPendingCardFixture(t, planReviewFixture(t))
	if err := f.tt.Click("拒绝"); err != nil {
		t.Fatal(err)
	}
	f.tt.Frame()
	answers := f.settle(t, 1)
	rows, _ := answers[0].Params["answers"].([]any)
	answer, _ := rows[0].(map[string]any)
	selected, _ := answer["selected"].([]any)
	if len(selected) != 1 || selected[0] != "拒绝" {
		t.Fatalf("selected = %v, want the decline option label", selected)
	}
	f.flush(t)
	f.tt.Frame()
	f.tt.Key(0, ui.KeyEscape)
	f.tt.Frame()
	answers = f.settle(t, 2)
	if answers[1].Method != "answerQuestions" || answers[1].Params["cancelled"] != true {
		t.Fatalf("Esc sent %v %v", answers[1].Method, answers[1].Params)
	}
}

// A request that does not fit the plan card keeps the generic question flow,
// which is answerable: no verdict is guessed from option order.
func TestPlanReviewFallsBackToTheQuestionFlow(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*interaction)
	}{
		{"no approve label", func(p *interaction) { p.Questions[0].Intent.Approve = "" }},
		{"approve names no option", func(p *interaction) { p.Questions[0].Intent.Approve = "同意" }},
		{"no plan detail", func(p *interaction) { p.Questions[0].Detail = "" }},
		{"three options", func(p *interaction) {
			p.Questions[0].Options = append(p.Questions[0].Options, questionOption{Label: "稍后"})
		}},
		{"multi select", func(p *interaction) { p.Questions[0].MultiSelect = true }},
		{"two questions", func(p *interaction) {
			p.Questions = append(p.Questions, question{ID: "q2", Question: "还有别的吗？", Options: []questionOption{{Label: "有"}}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := planReviewFixture(t)
			tc.edit(&p)
			f := newPendingCardFixture(t, p)
			if !f.tt.HasText("提交回答") {
				t.Fatalf("generic question flow missing: %v", f.tt.Texts())
			}
			if f.tt.HasText("批准") {
				t.Fatalf("the plan card guessed a verdict: %v", f.tt.Texts())
			}
		})
	}
}

// A kind this client does not know still renders its facts and one dismissal,
// so it can never be a card with no controls.
func TestUnknownPendingKindIsNotADeadCard(t *testing.T) {
	f := newPendingCardFixture(t, interaction{
		ID: "req-unknown", Kind: "plan-review", Title: "未知交互", Reason: "Host 发来了一种新交互",
		Questions: []question{{ID: "q", Question: "要如何处理？", Options: []questionOption{{Label: "继续"}}}},
	})
	if !f.tt.HasText("未知交互") || !f.tt.HasText("关闭卡片") {
		t.Fatalf("unknown card missing controls: %v", f.tt.Texts())
	}
	if !f.tt.HasText("要如何处理？") || !f.tt.HasText("· 继续") {
		t.Fatalf("unknown card is not showing its read-only facts: %v", f.tt.Texts())
	}
	if f.tt.HasText("提交回答") || f.tt.HasText("批准") {
		t.Fatalf("unknown card invented an answer: %v", f.tt.Texts())
	}
	if err := f.tt.Click("关闭卡片"); err != nil {
		t.Fatal(err)
	}
	f.tt.Frame()
	if f.tt.HasText("未知交互") {
		t.Fatalf("dismissal left the card: %v", f.tt.Texts())
	}
	if answers := f.answers(t); len(answers) != 0 {
		t.Fatalf("an unknown kind sent %v", answers)
	}
}

// An unanswerable card has no wire cancel, so its Esc route withdraws it
// locally instead of inventing one. The keystroke reaches a card through the
// focus chain (the same rule the approval card follows), so this drives the
// route the key is bound to.
func TestUnknownPendingKindCancelFallsBackToLocalDismissal(t *testing.T) {
	f := newPendingCardFixture(t, interaction{ID: "req-unknown", Kind: "host-future", Title: "未来交互"})
	pending := f.a.current.Pending[0]
	if method, _ := pendingCancelRequest(pending); method != "" {
		t.Fatalf("an unknown kind invented a wire cancel: %q", method)
	}
	f.a.cancelOrDismissPending(pending)
	f.tt.Frame()
	if f.tt.HasText("未来交互") {
		t.Fatalf("the card stayed on screen: %v", f.tt.Texts())
	}
	if answers := f.answers(t); len(answers) != 0 {
		t.Fatalf("an unknown kind sent %v", answers)
	}
}

// planReviewOf mirrors the upstream narrowing, so the card and the generic flow
// cannot both claim a request.
func TestPlanReviewOfNarrowing(t *testing.T) {
	if review := planReviewOf(planReviewFixture(t)); review == nil {
		t.Fatal("a well formed request is not narrowed")
	} else {
		if review.QuestionID != "q-plan" || review.Approve.Label != "同意执行" || review.CallID != "call-plan-7" {
			t.Fatalf("review = %+v", review)
		}
		if review.Decline == nil || review.Decline.Label != "拒绝" {
			t.Fatalf("decline = %+v", review.Decline)
		}
		if !strings.HasPrefix(review.Plan, "# 迁移会话存储") {
			t.Fatalf("plan = %q", review.Plan)
		}
	}
	// The approve option alone leaves no decline, which is the asker's choice.
	single := planReviewFixture(t)
	single.Questions[0].Options = []questionOption{{Label: "同意执行"}}
	if review := planReviewOf(single); review == nil || review.Decline != nil {
		t.Fatalf("single-option review = %+v", review)
	}
	// An approval intent is not a plan review.
	approval := planReviewFixture(t)
	approval.Questions[0].Intent.Kind = "approval"
	approval.Questions[0].Intent.Approve = "{{SECRET_8ya2w3tq}}"
	if review := planReviewOf(approval); review != nil {
		t.Fatalf("approval intent narrowed to %+v", review)
	}
	// A questions card without an intent keeps the generic flow.
	generic := planReviewFixture(t)
	generic.Questions[0].Intent = nil
	if review := planReviewOf(generic); review != nil {
		t.Fatalf("generic questions narrowed to %+v", review)
	}
}

// The card's summary is the first line and the paragraph under it, with the
// markdown markers stripped because both are drawn as plain text.
func TestPlanSummary(t *testing.T) {
	title, paragraph := planSummary("# 迁移会话存储\n\n把存储从 **JSON** 迁到 SQLite。\n\n## 步骤\n\n1. 增加脚本\n")
	if title != "迁移会话存储" {
		t.Fatalf("title = %q", title)
	}
	if paragraph != "把存储从 JSON 迁到 SQLite。" {
		t.Fatalf("paragraph = %q", paragraph)
	}
	title, paragraph = planSummary("- 只有一行")
	if title != "只有一行" || paragraph != "" {
		t.Fatalf("single line = %q / %q", title, paragraph)
	}
	if title, paragraph = planSummary(""); title != "" || paragraph != "" {
		t.Fatalf("empty plan = %q / %q", title, paragraph)
	}
	long := strings.Repeat("很长的计划", 100)
	if title, _ = planSummary(long); len([]rune(title)) > 181 {
		t.Fatalf("summary is not capped: %d runes", len([]rune(title)))
	}
	if !strings.HasSuffix(title, "…") {
		t.Fatalf("a capped summary has no ellipsis: %q", title)
	}
}
