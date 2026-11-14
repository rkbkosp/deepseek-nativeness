package main

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

type questionDraft struct {
	Single   string
	Selected map[string]bool
	Custom   string
}
type questionAnswer struct {
	ID       string   `json:"id"`
	Selected []string `json:"selected"`
	Custom   string   `json:"custom,omitempty"`
}

func (a *app) questionDraft(requestID, questionID string) *questionDraft {
	if a.answers == nil {
		a.answers = make(map[string]map[string]*questionDraft)
	}
	if a.answers[requestID] == nil {
		a.answers[requestID] = make(map[string]*questionDraft)
	}
	d := a.answers[requestID][questionID]
	if d == nil {
		d = &questionDraft{Selected: make(map[string]bool)}
		a.answers[requestID][questionID] = d
	}
	return d
}

func collectAnswers(questions []question, drafts map[string]*questionDraft) ([]questionAnswer, error) {
	answers := make([]questionAnswer, 0, len(questions))
	for _, q := range questions {
		d := drafts[q.ID]
		if d == nil {
			return nil, fmt.Errorf("请回答：%s", q.Question)
		}
		answer := questionAnswer{ID: q.ID, Selected: []string{}}
		custom := strings.TrimSpace(d.Custom)
		if q.Intent != nil && q.Intent.Kind == "approval" {
			custom = ""
		}
		for _, o := range q.Options {
			if q.MultiSelect && d.Selected[o.Label] || !q.MultiSelect && custom == "" && d.Single == o.Label {
				answer.Selected = append(answer.Selected, o.Label)
			}
		}
		answer.Custom = custom
		if len(answer.Selected) == 0 && custom == "" {
			return nil, fmt.Errorf("请回答：%s", q.Question)
		}
		answers = append(answers, answer)
	}
	return answers, nil
}

func (a *app) questionsView(c *ui.Context, p interaction) {
	ui.Scroll(c.Key(p.ID)).MaxHeight(260).Children(func() {
		ui.Column(c).Gap(12).Children(func() {
			for _, q := range p.Questions {
				q := q
				d := a.questionDraft(p.ID, q.ID)
				ui.Column(c.Key(q.ID)).Gap(7).Children(func() {
					if q.Header != "" {
						ui.Text(c, q.Header).FontSize(12).TextColor(a.theme.TextMuted)
					}
					ui.Text(c, q.Question).Wrap().Bold()
					if q.Detail != "" {
						markdown.View(c, q.Detail, &a.md)
					}
					for _, o := range q.Options {
						o := o
						ui.Column(c.Key(o.Label)).Gap(2).Children(func() {
							if q.MultiSelect {
								selected := d.Selected[o.Label]
								if ui.Checkbox(c, &selected, o.Label).Disabled(a.busy).Changed() {
									d.Selected[o.Label] = selected
								}
							} else {
								ui.Radio(c, &d.Single, o.Label, o.Label).Disabled(a.busy)
							}
							if o.Description != "" {
								ui.Text(c, o.Description).Wrap().FontSize(12).TextColor(a.theme.TextMuted).Padding(0, 24)
							}
						})
					}
					if q.Intent == nil || q.Intent.Kind != "approval" {
						ui.TextInput(c, &d.Custom).Label("补充回答：" + q.ID).Placeholder("或输入你的回答").Disabled(a.busy)
					}
				})
			}
		})
	})
	ui.Row(c).Gap(8).Children(func() {
		if ui.Button(c, "取消回答").Disabled(a.busy).Clicked() {
			a.request("answerQuestions", map[string]any{"requestId": p.ID, "cancelled": true}, nil)
		}
		if ui.PrimaryButton(c, "提交回答").Disabled(a.busy).Clicked() {
			answers, err := collectAnswers(p.Questions, a.answers[p.ID])
			if err != nil {
				a.error = err.Error()
			} else {
				a.request("answerQuestions", map[string]any{"requestId": p.ID, "answers": answers}, nil)
			}
		}
	})
}
