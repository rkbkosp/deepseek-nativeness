package main

import (
	"encoding/json"
	"strings"

	"github.com/egoist/mygo/ui"
)

func feedbackMessageID(m message) string {
	if len(m.SourceMessageID) == 0 || string(m.SourceMessageID) == "null" {
		return ""
	}
	var id string
	if json.Unmarshal(m.SourceMessageID, &id) == nil {
		return id
	}
	var value struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(m.SourceMessageID, &value) == nil {
		return value.ID
	}
	return ""
}

func (a *app) openFeedback(rating, messageID string) {
	if messageID == "" {
		return
	}
	a.feedbackOpen = true
	a.feedbackRating = rating
	a.feedbackMessage = messageID
	a.feedbackNote = ""
}

func (a *app) feedbackView(c *ui.Context) {
	if !a.feedbackOpen {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(460).Padding(24).Gap(16).Children(func() {
			title := "喜欢这条回复"
			if a.feedbackRating == "negative" {
				title = "不喜欢这条回复"
			}
			ui.Text(c, title).FontSize(18).FontWeight(500)
			ui.Text(c, "反馈会记录到当前会话；可以补充一句说明。").FontSize(13).TextColor(a.colors.Secondary).Wrap()
			ui.TextArea(c, &a.feedbackNote).Label("反馈说明").Placeholder("可选，补充原因").Lines(3, 5).FillWidth().FontSize(13)
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, "提交").Disabled(!a.connected || a.busy || a.sessionID == "").Clicked() {
					note := strings.TrimSpace(a.feedbackNote)
					params := map[string]any{
						"sessionId": a.sessionID,
						"messageId": a.feedbackMessage,
						"rating":    a.feedbackRating,
						"ifVersion": nil,
					}
					if note != "" {
						params["note"] = note
					}
					a.mutate("putFeedback", params, func(json.RawMessage) error {
						open = false
						return nil
					})
				}
			})
		})
	})
	if !open {
		a.feedbackOpen = false
		a.feedbackMessage = ""
		a.feedbackNote = ""
	}
}