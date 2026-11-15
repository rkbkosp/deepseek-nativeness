package main

import (
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"strings"
)

func (a *app) composerQueueView(c *ui.Context, s *composerState) {
	rows := s.values.Inbox["next-turn"]
	if len(rows) == 0 {
		return
	}
	ui.Column(c).FillWidth().Margin(0, 8, -3).Padding(2, 0).Gap(0).Radius(16, 16, 0, 0).Background(a.colors.Popup).BorderWidth(.5, .5, 0, .5).BorderColor(a.theme.Border).Children(func() {
		if len(rows) > 1 {
			if ui.ButtonBase(c).Height(36).FillWidth().Padding(4, 12).Gap(10).Label("待发送队列").Children(func() {
				icon(c, "queue-outline", 16)
				ui.Text(c, fmt.Sprintf("%d 条待发送消息", len(rows))).FontSize(13).FontWeight(500).Grow(1)
				glyph := "chevron-down-outline"
				if s.queueExpanded {
					glyph = "chevron-up-outline"
				}
				icon(c, glyph, 12)
			}).Clicked() {
				s.queueExpanded = !s.queueExpanded
			}
		}
		if len(rows) == 1 || s.queueExpanded || s.editingID != "" {
			ui.Scroll(c).MaxHeight(180).Children(func() {
				ui.Column(c).FillWidth().Children(func() {
					for _, row := range rows {
						text, editable := queueText(row)
						label := text
						if !editable {
							label = queueBlockLabel(row)
						}
						ui.Column(c.Key(row.ID)).FillWidth().Padding(8, 12).Gap(6).Children(func() {
							if s.editingID == row.ID {
								ui.TextArea(c, &s.editingText).Label("编辑待发送消息").Lines(1, 5).FillWidth().FontSize(13)
								ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
									if ui.Button(c, "取消").Clicked() {
										s.editingID = ""
									}
									if ui.Button(c, "保存").Disabled(strings.TrimSpace(s.editingText) == "" || !a.can("updateQueue")).Clicked() {
										a.composerQueueAction(row.ID, map[string]any{"kind": "edit", "content": []any{map[string]any{"type": "text", "text": s.editingText}}})
									}
								})
							} else {
								ui.Row(c).AlignItems(ui.Center).Gap(8).Children(func() {
									if editable {
										// A queued message has not been sent yet: the preview masks
										// it, and opening the editor shows the original text.
										ui.Text(c, maskSecrets(text)).FontSize(13).MaxLines(2).Grow(1)
									} else {
										ui.Text(c, label).FontSize(13).Grow(1)
									}
									if ui.ButtonBase(c).Size(24, 24).Label("编辑待发送消息").Disabled(!editable || !a.can("updateQueue")).Children(func() { icon(c, "edit-outline", 14) }).Clicked() {
										s.editingID = row.ID
										s.editingText = text
									}
									if ui.ButtonBase(c).Size(24, 24).Label("立即发送此消息").Disabled(!a.current.Running || !a.can("updateQueue")).Children(func() { icon(c, "send-outline", 14) }).Clicked() {
										a.composerQueueAction(row.ID, map[string]any{"kind": "steer"})
									}
									if ui.ButtonBase(c).Size(24, 24).Label("移除待发送消息").Disabled(!a.can("updateQueue")).Children(func() { icon(c, "close-outline", 14) }).Clicked() {
										a.composerQueueAction(row.ID, map[string]any{"kind": "remove"})
									}
								})
							}
						})
					}
				})
			})
		}
	})
}
func (a *app) chooseComposerPermission(s *composerState, value string) {
	a.chooseComposerPermissionWithCommit(s, value, nil)
}
func (a *app) chooseComposerPermissionWithCommit(s *composerState, value string, done func()) {
	if !a.composerCurrent(s) || s.values.Permissions == nil || (s.values.Permissions.CurrentValue == value && done == nil) {
		return
	}
	valid := false
	for _, option := range s.permissions {
		if option.Value == value {
			valid = true
			break
		}
	}
	if !valid {
		return
	}
	if value == "danger-full-access" || value == "auto" {
		s.confirmPermission = value
		s.permissionAcknowledged = false
		s.permissionDone = done
		return
	}
	a.composerCommand("/permission "+value, done)
}
func (a *app) composerPermissionConfirmation(c *ui.Context, s *composerState) {
	if s.confirmPermission == "" {
		return
	}
	exists := false
	for _, option := range s.permissions {
		if option.Value == s.confirmPermission {
			exists = true
		}
	}
	if !a.composerCurrent(s) || !a.connected || !exists {
		s.confirmPermission = ""
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		title := "确认启用完全权限？"
		description := "启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。"
		button := "启用完全权限"
		if s.confirmPermission == "auto" {
			title = "确认启用自动审查（实验）？"
			description = "自动审查不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。"
			button = "启用自动审查"
		}
		ui.Column(c).Width(460).Padding(24).Gap(16).Children(func() {
			ui.Text(c, title).FontSize(18).FontWeight(500)
			ui.Text(c, description).FontSize(14).Wrap()
			ui.Checkbox(c, &s.permissionAcknowledged, "我已了解风险，并愿意继续")
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.Button(c, button).Disabled(!s.permissionAcknowledged || !a.can("executeCommand")).Clicked() {
					value := s.confirmPermission
					s.confirmPermission = ""
					done := s.permissionDone
					s.permissionDone = nil
					a.composerCommand("/permission "+value, done)
				}
			})
		})
	})
	if !open {
		s.confirmPermission = ""
		s.permissionAcknowledged = false
		s.permissionDone = nil
	}
}
func (a *app) composerPickPermission(s *composerState, item composerCompletion, before string) {
	if !a.composerCurrent(s) || item.Value == "" {
		return
	}
	r := []rune(before)
	if s.completionStart < 0 || s.completionEnd > len(r) || string(r[s.completionStart:s.completionEnd]) != s.completionToken {
		return
	}
	after := string(r[:s.completionStart]) + string(r[s.completionEnd:])
	host, sid, account, key := a.hostID, a.sessionID, a.accountScope, a.viewKey(a.sessionID)
	done := func() {
		if a.drafts[key] == before {
			a.drafts[key] = after
		}
		if a.hostID == host && a.sessionID == sid && a.accountScope == account && a.draft == before {
			a.draft = after
		}
	}
	s.completions = nil
	s.dismissedToken = s.completionToken
	a.chooseComposerPermissionWithCommit(s, item.Value, done)
}

// A queue is steered one acknowledged item at a time. A rejection or unknown
// receipt stops the chain; no unconfirmed item is replayed under a fresh key.
func (a *app) composerSteerQueue(s *composerState, ids []string) {
	if !a.composerCurrent(s) || !a.current.Running || len(ids) == 0 || !a.can("updateQueue") {
		return
	}
	id := ids[0]
	a.mutate("updateQueue", map[string]any{"sessionId": s.sessionID, "itemId": id, "action": map[string]any{"kind": "steer"}}, func(json.RawMessage) error {
		if a.composerCurrent(s) {
			a.composerSteerQueue(s, ids[1:])
			if len(ids) == 1 {
				a.composerRead(s, "sessionProjections", nil, a.acceptComposerProjections)
			}
		}
		return nil
	})
}
