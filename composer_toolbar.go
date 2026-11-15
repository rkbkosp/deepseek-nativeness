package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"strings"
)

// InputBar.control-row-layout.ts measures the expanded controls first, then
// switches only the model seat to its glyph when they cannot share a line.
// The row still wraps entire leading/trailing groups if even glyphs cannot fit.
type composerControlLayout struct {
	available, gap                                float32
	permissionGlyph, permissionText, modelCompact bool
}

func composerHasPermissionGlyph(value string) bool {
	switch value {
	case "read-only", "workspace-write", "danger-full-access", "auto":
		return true
	}
	return false
}
func (a *app) composerControlsLayout(c *ui.Context, s *composerState, width float32) composerControlLayout {
	layout := composerControlLayout{available: max(0, width-16), gap: 12}
	if layout.available <= 560 {
		layout.gap = 8
	}
	permissionValue := ""
	if s.values.Permissions != nil {
		permissionValue = s.values.Permissions.CurrentValue
	}
	layout.permissionGlyph = composerHasPermissionGlyph(permissionValue)
	layout.permissionText = !(layout.available <= 460 && layout.permissionGlyph)
	measure := func(text string, weight int) float32 {
		w, _ := c.MeasureText(0, ui.Span{Text: text, Font: a.messageFontFamily(), Size: 13, Weight: weight})
		return w
	}
	permissionWidth := float32(12 + 12)
	if layout.permissionGlyph {
		permissionWidth += 14 + 4
	}
	if layout.permissionText {
		permissionWidth += measure(a.composerPermissionLabel(), 500) + 4
	}
	permissionWidth = min(permissionWidth, 220)
	leadingWidth := 28 + layout.gap + permissionWidth
	if composerPlanActive(s) {
		leadingWidth += layout.gap + max(float32(34), 16+14+4+measure("计划", 500))
	}
	modelName := s.modelName
	if modelName == "" {
		modelName = a.composerModelLabel()
	}
	modelWidth := 12 + 12 + measure(modelName, a.messageNormalWeight())
	if s.modelEffort != "" {
		modelWidth += 4 + measure(s.modelEffort, a.messageNormalWeight())
	}
	modelWidth = min(modelWidth, 360)
	layout.modelCompact = layout.available <= 0 || leadingWidth+12+modelWidth+layout.gap+34 > layout.available
	return layout
}
func composerPlanActive(s *composerState) bool {
	return s.values.Plan != nil && ((s.values.Plan.Pending && !s.values.Plan.Active) || (!s.values.Plan.Pending && s.values.Plan.Active))
}

func (a *app) composerToolbar(c *ui.Context, s *composerState, input ui.Element, caret int) {
	artifacts := a.composerArtifacts()
	hasInput := strings.TrimSpace(a.draft) != "" || len(artifacts.Images) > 0
	row := ui.Row(c.Key("composer-controls")).FillWidth().MinWidth(0).Wrap().AlignItems(ui.Center).Padding(2, 8, 6).Gap(12)
	width, height := c.Size()
	signature := fmt.Sprintf("%g/%g/%g/%t", width, height, a.sidebarShown, a.rightPaneOpen)
	if signature != s.controlsGeometrySignature {
		s.controlsGeometrySignature = signature
		c.Invalidate()
	}
	layout := a.composerControlsLayout(c, s, row.LayoutBounds().W)
	s.modelCompact = layout.modelCompact
	row.Children(func() {
		leading := ui.Row(c.Key("composer-leading")).MinWidth(0).Shrink(1).Gap(layout.gap).AlignItems(ui.Center)
		if layout.available > 0 {
			leading.MaxWidth(layout.available)
		}
		leading.Children(func() {
			if ui.ButtonBase(c).Size(28, 28).Shrink(0).Radius(14).Background(a.settingsControlFill()).Label("指令").Disabled(!a.connected || a.busy).Tooltip("指令").Children(func() { icon(c, "plus-outline", 14).TextColor(a.theme.TextMuted) }).Clicked() {
				if strings.TrimSpace(a.draft) == "" {
					input.ReplaceText(0, len([]rune(a.draft)), "/")
					input.SetTextSelection(1, 1)
					input.Focus()
					a.updateComposerCompletions(s, 1)
				} else {
					s.dismissedToken = ""
					s.completionToken = ""
					a.updateComposerCompletions(s, caret)
				}
			}
			ui.Row(c).MinWidth(0).Shrink(1).Gap(layout.gap).AlignItems(ui.Center).Children(func() {
				permission := ui.ButtonBase(c).Label("权限模式").Height(28).MinWidth(0).MaxWidth(220).Shrink(1).Padding(0, 4, 0, 8).Radius(8).Gap(4).Tooltip(a.composerPermissionLabel()).Disabled(!a.can("executeCommand") || s.values.Permissions == nil).Children(func() {
					if layout.permissionGlyph {
						icon(c, "shield-outline", 14).Shrink(0).TextColor(a.theme.TextMuted)
					}
					if layout.permissionText {
						ui.Text(c, a.composerPermissionLabel()).FontSize(13).FontWeight(500).MinWidth(0).Shrink(1).Ellipsis("…").TextColor(a.theme.TextMuted)
					}
					icon(c, "chevron-down-outline", 12).Shrink(0).TextColor(a.theme.TextMuted)
				})
				permission.Menu(func(m *ui.Menu) {
					for _, p := range s.permissions {
						if m.Item(permissionDisplay(p)).Radio(s.values.Permissions != nil && s.values.Permissions.CurrentValue == p.Value).Chosen() {
							a.chooseComposerPermission(s, p.Value)
						}
					}
				})
				if composerPlanActive(s) {
					if ui.ButtonBase(c).Height(28).MinWidth(34).Shrink(0).Padding(0, 8).Radius(8).Gap(4).Label("退出计划模式").Disabled(!a.can("executeCommand")).Children(func() {
						glyph := "plan-outline"
						icon(c, glyph, 14).TextColor(a.theme.Accent)
						ui.Text(c, "计划").FontSize(13).FontWeight(500).TextColor(a.theme.Accent)
					}).Clicked() {
						a.composerCommand("/plan off", nil)
					}
				}
			})
		})
		ui.Row(c.Key("composer-trailing")).MinWidth(0).Shrink(0).MarginStart(ui.Auto).Gap(layout.gap).AlignItems(ui.Center).Children(func() {
			model := ui.ButtonBase(c).Label("选择模型").Height(28).MinWidth(0).MaxWidth(360).Shrink(0).Padding(0, 4, 0, 8).Radius(8).Gap(4).Tooltip(a.composerModelLabel()).Disabled(!a.can("modelCatalog")).Children(func() {
				if layout.modelCompact {
					icon(c, "data-outline", 14).Shrink(0).TextColor(a.theme.TextMuted)
				} else {
					name := s.modelName
					if name == "" {
						name = a.composerModelLabel()
					}
					ui.Text(c, name).FontSize(13).MinWidth(0).Shrink(1).Ellipsis("…").TextColor(a.theme.TextMuted)
					if s.modelEffort != "" {
						ui.Text(c, s.modelEffort).FontSize(13).MinWidth(0).Shrink(1000).Ellipsis("…").TextColor(a.theme.TextMuted)
					}
				}
				icon(c, "chevron-down-outline", 12).Shrink(0).TextColor(a.theme.TextMuted)
			})
			if model.Clicked() {
				a.openCompatAt("model-menu", "modelPopover")
			}
			a.composerModelPopover(c, model)
			if a.current.Running && !hasInput {
				if ui.ButtonBase(c).Size(34, 34).Translate(0, -2).Shrink(0).Radius(17).Background(a.colors.SendFill).Label("停止").Disabled(a.busy || !a.connected).Children(func() { icon(c, "stop-fill", 14).TextColor(ui.RGB(255, 255, 255)) }).Clicked() {
					a.mutate("cancel", map[string]any{"sessionId": a.sessionID}, nil)
				}
			} else {
				label := "发送消息"
				if a.current.Running {
					if composerSubmitMode(a.uiPrefs.SendMode, true, false) == "steer" {
						label = "立即发送"
					} else {
						label = "加入队列"
					}
				}
				if ui.ButtonBase(c).Size(34, 34).Translate(0, -2).Shrink(0).Radius(17).Background(a.colors.SendFill).Label(label).Tooltip(label).Disabled(a.busy || !a.connected || !hasInput || artifacts.Loading || a.sessionID == "").Children(func() { icon(c, "send-outline", 16).TextColor(ui.RGB(255, 255, 255)) }).Clicked() {
					a.composerSubmit(false)
				}
			}
		})
	})
}
