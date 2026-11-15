package main

// The plan-review card. A plan approval arrives as a `user-questions/request`
// whose single question carries the `plan-review` presentation intent:
//
//	{ id, question, detail, options:[{label}], intent:{ kind:"plan-review", approve, callId? } }
//
// `detail` is the plan markdown, `approve` names the option that approves the
// plan, and every other option declines it. Both come from the Host schema
// (`dsh-api-session-controller` `userQuestions.active[].questions[]`), and this
// client submits the chosen option's label verbatim through the existing
// `answerQuestions` path — never an index, so no verdict is inferred from
// option order.
//
// The narrowing below is the upstream `planReviewOf`
// (packages/client/ui-user-questions/src/client/contract/slots.ts:81-101): a
// request that does not fit stays in the generic question card, which is still
// answerable, instead of becoming a card with no working controls.

import (
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

// planReviewOption is one answer the card can submit.
type planReviewOption struct {
	Label       string
	Description string
}

// planReview is a pending request narrowed to the plan decision.
type planReview struct {
	QuestionID string // echoed in the answer
	Prompt     string // the asker's question text
	Plan       string // the plan markdown under review
	CallID     string // logged invocation that holds the plan, when named
	Approve    planReviewOption
	Decline    *planReviewOption
}

// planReviewOf narrows a pending request to a renderable plan review, or nil
// when the generic question card owns it.
func planReviewOf(p interaction) *planReview {
	if len(p.Questions) != 1 {
		return nil
	}
	q := p.Questions[0]
	if q.Intent == nil || q.Intent.Kind != "plan-review" {
		return nil
	}
	if q.Detail == "" || q.MultiSelect || q.Intent.Approve == "" || len(q.Options) > 2 {
		return nil
	}
	var approve *questionOption
	var decline *questionOption
	for i := range q.Options {
		option := &q.Options[i]
		if option.Label == q.Intent.Approve {
			approve = option
			continue
		}
		if decline == nil {
			decline = option
		}
	}
	if approve == nil {
		return nil
	}
	review := &planReview{
		QuestionID: q.ID,
		Prompt:     q.Question,
		Plan:       q.Detail,
		CallID:     q.Intent.CallID,
		Approve:    planReviewOption{Label: approve.Label, Description: approve.Description},
	}
	if decline != nil {
		review.Decline = &planReviewOption{Label: decline.Label, Description: decline.Description}
	}
	return review
}

// answerPlanReview submits one option label, as the asker's own answer value.
func (a *app) answerPlanReview(p interaction, review *planReview, choice planReviewOption) {
	if a.busy || choice.Label == "" {
		return
	}
	a.request("answerQuestions", map[string]any{
		"requestId": p.ID,
		"answers":   []questionAnswer{{ID: review.QuestionID, Selected: []string{choice.Label}}},
	}, nil)
}

// planReviewView draws the plan decision: the summary, the complete plan, and
// the two verdicts.
func (a *app) planReviewView(c *ui.Context, p interaction, review *planReview) {
	ui.Row(c).AlignItems(ui.Center).Gap(6).Children(func() {
		ui.Text(c, "计划待审").FontSize(12).FontWeight(500).TextColor(a.theme.TextMuted)
		if review.CallID != "" {
			ui.Text(c, "· "+review.CallID).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…").Shrink(1)
		}
	})
	// The asker's question is the card's accessible name and stays readable.
	if prompt := strings.TrimSpace(review.Prompt); prompt != "" {
		ui.Text(c, maskSecrets(prompt)).Wrap().Bold()
	}
	if title, paragraph := planSummary(review.Plan); title != "" {
		ui.Text(c, maskSecrets(title)).FontSize(14).FontWeight(500).Wrap()
		if paragraph != "" {
			ui.Text(c, maskSecrets(paragraph)).Wrap().FontSize(12).TextColor(a.colors.Tertiary)
		}
	}
	// The complete plan opens in place: the card owns the composer seat, so
	// there is no second surface to send it to, and the summary above already
	// answers what the plan says first.
	open := a.foldState("plan-review:"+p.ID, false)
	ui.Collapsible(c, "查看完整计划", open, func() {
		ui.Scroll(c).MaxHeight(220).Children(func() {
			ui.Column(c).FillWidth().MinWidth(0).Padding(10, 12).Radius(12).Background(a.colors.CodeBlock).Children(func() {
				markdown.View(c.Key("plan-review:"+p.ID), maskSecrets(review.Plan), &a.md)
			})
		})
	})
	// One Tab stop, like the approval card: Tab lands on a verdict, the arrows
	// move between them, Enter confirms the focused one and Esc cancels the
	// whole request through the questions path.
	ui.Row(c).Gap(8).FocusGroup(ui.Horizontal).Children(func() {
		if review.Decline != nil {
			decline := *review.Decline
			if ui.Button(c, "拒绝").Disabled(a.busy).Tooltip(planReviewTooltip(decline)).Clicked() {
				a.answerPlanReview(p, review, decline)
			}
		}
		if ui.PrimaryButton(c, "批准").Disabled(a.busy).Tooltip(planReviewTooltip(review.Approve)).Clicked() {
			a.answerPlanReview(p, review, review.Approve)
		}
	})
}

// unknownPendingView degrades an unrecognized interaction to read-only facts and
// one local dismissal. It shows no dead control: an unknown kind has no answer
// this client can address, so nothing is sent.
func (a *app) unknownPendingView(c *ui.Context, p interaction) {
	ui.Text(c, "这个交互来自更新版本的 Host，当前客户端无法回答。关闭卡片不会改变 Host 的等待；它会在自己的超时或取消时结束。").
		Wrap().FontSize(12).TextColor(a.theme.TextMuted)
	if p.Kind != "" {
		ui.Text(c, "类型 "+maskSecrets(p.Kind)).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).NoWrap()
	}
	for _, q := range p.Questions {
		if question := strings.TrimSpace(q.Question); question != "" {
			ui.Text(c, maskSecrets(question)).Wrap().FontSize(12)
		}
		for _, option := range q.Options {
			ui.Text(c, "· "+maskSecrets(option.Label)).Wrap().FontSize(11).TextColor(a.colors.Caption)
		}
	}
	ui.Row(c).Gap(8).Children(func() {
		if ui.Button(c, "关闭卡片").Clicked() {
			a.dismissPending(p)
		}
	})
}

// dismissPending withdraws an unanswerable card from the local snapshot. It
// writes nothing: the Host still owns the request, and a later snapshot can list
// it again, which is the truthful state.
func (a *app) dismissPending(p interaction) {
	kept := make([]interaction, 0, len(a.current.Pending))
	for _, item := range a.current.Pending {
		if item.ID == p.ID && item.Kind == p.Kind {
			continue
		}
		kept = append(kept, item)
	}
	a.current.Pending = kept
}

// cancelOrDismissPending answers the card the way Esc does: the interaction's own
// wire cancel when the kind has one, otherwise a local dismissal.
func (a *app) cancelOrDismissPending(p interaction) {
	if method, _ := pendingCancelRequest(p); method != "" {
		a.cancelPending(p)
		return
	}
	a.dismissPending(p)
}

// planSummary derives the card's title and description from the plan markdown:
// the first non-empty line, then the paragraph under it. Markdown markers are
// stripped because both are drawn as plain text.
func planSummary(plan string) (title, paragraph string) {
	lines := strings.Split(plan, "\n")
	const maxRunes = 180
	clean := func(line string) string {
		line = strings.TrimSpace(line)
		for {
			trimmed := strings.TrimLeft(line, "#>-*+ \t")
			if trimmed == line {
				break
			}
			line = trimmed
		}
		return strings.TrimSpace(strings.ReplaceAll(line, "**", ""))
	}
	var body []string
	for _, raw := range lines {
		line := clean(raw)
		if line == "" {
			if len(body) > 0 {
				break
			}
			continue
		}
		if title == "" {
			title = truncateRunes(line, maxRunes)
			continue
		}
		body = append(body, line)
	}
	paragraph = truncateRunes(strings.Join(body, " "), maxRunes)
	return title, paragraph
}

// truncateRunes caps a summary line without splitting a character.
func truncateRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

// planReviewTooltip is the button tooltip for an option: the asker's own
// description when it has one, else the exact label the answer will carry.
func planReviewTooltip(option planReviewOption) string {
	if option.Description != "" {
		return option.Description
	}
	return "提交「" + option.Label + "」"
}
