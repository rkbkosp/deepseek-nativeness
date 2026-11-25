package main

import (
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"strings"
	"time"
)

// markTailRows flags the last visible Assistant response of each Turn. Action
// chrome belongs there, once, rather than under every intermediate reply.
func markTailRows(rows []chatRow) {
	for i := range rows {
		rows[i].Tail = false
	}
	last := map[int]int{}
	for i := range rows {
		r := &rows[i]
		if r.Running || r.Process || r.Control || r.User || r.Turn == 0 {
			continue
		}
		last[r.Turn] = i
	}
	for _, i := range last {
		rows[i].Tail = true
	}
}

func latestTurn(rows []chatRow) int {
	latest := 0
	for _, r := range rows {
		if r.Running {
			continue
		}
		if r.Turn > latest {
			latest = r.Turn
		}
	}
	return latest
}

func (a *app) tailMessage(row chatRow) *message {
	if len(row.Parts) > 0 {
		return a.chatPartMessage(row.Parts[0])
	}
	if len(row.Messages) > 0 {
		return &row.Messages[0]
	}
	return nil
}

func assistantPlainText(m *message) string {
	if m == nil {
		return ""
	}
	if len(m.AssistantBlocks) == 0 {
		return m.Text
	}
	var b strings.Builder
	for _, block := range m.AssistantBlocks {
		if block.Kind == "text" {
			b.WriteString(block.Text)
		}
	}
	if b.Len() == 0 {
		return m.Text
	}
	return b.String()
}

func formatMessageClock(ms float64) string {
	return time.UnixMilli(int64(ms)).Format("15:04")
}

func (a *app) runningStartedAt() time.Time {
	if p := a.current.ChatPresentation; p != nil {
		var latest *float64
		turn := -1
		for i := range p.Turns {
			candidate := &p.Turns[i]
			if candidate.StartTime == nil || candidate.Turn < turn {
				continue
			}
			turn = candidate.Turn
			latest = candidate.StartTime
		}
		if latest != nil {
			return time.UnixMilli(int64(*latest))
		}
	}
	if !a.runningSince.IsZero() {
		return a.runningSince
	}
	return time.Now()
}

func (a *app) runningView(c *ui.Context) {
	start := a.runningStartedAt()
	elapsed := time.Since(start)
	if elapsed < 0 {
		elapsed = 0
	}
	if a.metrics.FixedTime == nil {
		if wait := time.Second - elapsed%time.Second; wait > 0 {
			c.After(wait)
		}
	}
	label := "深度求索中，用时 " + formatProcessDuration(float64(elapsed.Milliseconds())) + " ···"
	ui.Row(c).FillWidth().Height(32).Padding(0, 0, 8).Gap(6).AlignItems(ui.Center).
		BorderWidth(.5, 0, 0, 0).BorderColor(a.theme.Border).Children(func() {
		icon(c, "whale-outline", 14).TextColor(a.colors.Link)
		ui.Text(c, label).FontSize(12).FixedLineHeight(22).TextColor(a.colors.Link)
	})
}

func (a *app) actionButton(c *ui.Context, label, tooltip, glyph string, size float32, enabled bool, action func()) {
	b := ui.ButtonBase(c).Label(label).Tooltip(tooltip).Size(28, 28).Padding(5).Radius(8)
	if !enabled {
		b.Disabled(true)
	}
	b.Children(func() {
		icon(c, glyph, size).TextColor(a.colors.Tertiary)
	})
	if enabled && b.Clicked() && action != nil {
		action()
	}
}

// turnHasEnded reports whether the Turn's end is known. Copy, feedback and
// branch chrome belongs to a finished Turn: while the agent is thinking or
// running a command, the last settled reply is not yet the turn tail, so no
// footer may appear there only to vanish when the next step starts.
func (a *app) turnHasEnded(turn, latest int) bool {
	if turn <= 0 {
		return false
	}
	if p := a.current.ChatPresentation; p != nil {
		i, ok := a.presentationIndex().turns[turn]
		if !ok {
			return true
		}
		switch p.Turns[i].Status {
		case "open":
			return false
		case "partial":
			// A window cut before turn/start leaves the in-flight Turn partial.
			return !(a.current.Running && turn == latest)
		}
		return true
	}
	return !(a.current.Running && a.chatRowsCache != nil && turn == a.chatRowsCache.activeTurn)
}

func (a *app) tailActionsView(c *ui.Context, row chatRow, hovered bool, latest int) {
	m := a.tailMessage(row)
	if m == nil || m.Role != "assistant" || m.Streaming || !a.turnHasEnded(row.Turn, latest) {
		return
	}
	// A Turn the restart recovery closed (interrupted/error) ends with the
	// terminal failure row, not with a reply's hover actions. The reference
	// draws no invisible 28px action rail there; leaving it in the flow pushed
	// the failure row up and added a gap before the composer.
	if row.ProcessReason == "interrupted" || row.ProcessReason == "error" {
		return
	}
	visible := hovered || row.Turn == latest
	opacity := float32(.0)
	if visible {
		opacity = 1
	}
	text := assistantPlainText(m)
	ui.Row(c).Key("tail-actions:" + m.ID).Height(28).Gap(8).AlignItems(ui.Center).Opacity(opacity).Children(func() {
		a.actionButton(c, "复制消息 "+m.ID, "复制", "copy-outline", 17, true, func() { c.WriteClipboard(text) })
		feedbackID := feedbackMessageID(*m)
		a.actionButton(c, "有帮助 "+m.ID, "喜欢这条回复", "like-outline", 17, feedbackID != "", func() {
			a.openFeedback("positive", feedbackID)
		})
		a.actionButton(c, "无帮助 "+m.ID, "不喜欢这条回复", "dislike-outline", 17, feedbackID != "", func() {
			a.openFeedback("negative", feedbackID)
		})
		if quote := quoteMessageText(*m); quote != "" {
			a.actionButton(c, "引用消息 "+m.ID, "引用到输入框", "new-chat-outline", 17, true, func() {
				a.quoteMessage(quote)
			})
		}
		forkEnabled := a.can("forkSession") && m.Seq > 0
		a.actionButton(c, "分叉消息 "+m.ID, "在新对话中分支", "branch-outline", 17, forkEnabled, func() {
			a.forkAtMessage(*m)
		})
		if a.uiPrefs.UsageDetail == "detailed" {
			if usage, ok := parseMessageUsage(m.Usage); ok {
				open := a.foldState("usage:"+m.ID, false)
				anchor := ui.ButtonBase(c).Padding(0).Gap(4).Label("单轮用量").Children(func() {
					icon(c, "data-outline", 14).TextColor(a.colors.Tertiary)
					ui.Text(c, "用量 "+formatTokenCount(usage.total())+" tok").FontSize(12).TextColor(a.colors.Tertiary)
				})
				ui.PopoverBase(c, anchor, open, func(panel ui.Element) {
					panel.Padding(12).Radius(12).Background(a.colors.Popup).Border(1, a.theme.Border).Gap(6)
					ui.Text(c, "本轮用量").FontSize(12).FontWeight(500)
					for _, row := range []struct {
						label string
						value int64
					}{
						{"输入", usage.InputTokens},
						{"输出", usage.OutputTokens},
						{"缓存读取", usage.CacheReadTokens},
						{"缓存写入", usage.CacheWriteTokens},
						{"推理", usage.ReasoningTokens},
						{"总计", usage.total()},
					} {
						if row.value == 0 && row.label != "总计" {
							continue
						}
						ui.Row(c).Gap(18).Children(func() {
							ui.Text(c, row.label).FontSize(12).TextColor(a.colors.Tertiary).Grow(1)
							value := formatTokenCount(row.value) + " tok"
							if total := usage.total(); total > 0 && row.label != "总计" {
								value += fmt.Sprintf(" · %.0f%%", float64(row.value)*100/float64(total))
							}
							ui.Text(c, value).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary)
						})
					}
				})
			}
		}
		if m.Time > 0 {
			ui.Text(c, formatMessageClock(m.Time)).FontSize(12).TextColor(a.colors.Tertiary)
		}
	})
}

// quoteMessageText is the text a quote-to-composer action can quote: the
// message's own text, or its assistant blocks when the prose lives there.
func quoteMessageText(m message) string {
	text := strings.TrimSpace(m.Text)
	if text == "" {
		var parts []string
		for _, block := range m.AssistantBlocks {
			if block.Kind == "text" && strings.TrimSpace(block.Text) != "" {
				parts = append(parts, strings.TrimSpace(block.Text))
			}
		}
		text = strings.Join(parts, "\n\n")
	}
	if len(text) > 2000 {
		text = text[:2000] + "…"
	}
	return text
}

func (a *app) quoteMessage(text string) {
	quoted := "> " + strings.ReplaceAll(text, "\n", "\n> ") + "\n\n"
	a.draft = quoted
}

func (a *app) forkAtMessage(m message) {
	if m.Seq <= 0 || !a.can("forkSession") {
		return
	}
	a.mutate("forkSession", map[string]any{"sessionId": a.sessionID, "atSeq": m.Seq}, func(json.RawMessage) error {
		a.fetchWorkspaces()
		a.fetchSessions()
		return nil
	})
}

// actionStrip is the user message's compact time/copy chrome.
func (a *app) steeringView(c *ui.Context, row chatRow) {
	if len(row.Messages) == 0 {
		return
	}
	m := row.Messages[0]
	ui.Row(c).Children(func() {
		ui.Spacer(c)
		ui.Column(c).MaxWidth(a.chatContentWidth(c) * .702).Gap(6).Children(func() {
			// The steering echo is a sent user message, so it masks the same way.
			ui.Text(c, maskSecrets(m.Text)).FontSize(a.uiPrefs.FontSize).FixedLineHeight(22).Wrap().Padding(10, 16).Radius(20).Background(a.colors.Bubble).Opacity(.92)
		})
	})
}

func (a *app) actionStrip(c *ui.Context, m message) {
	ui.Row(c).Key("user-actions:" + m.ID).Height(28).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Spacer(c)
		if m.Time > 0 {
			ui.Text(c, formatMessageClock(m.Time)).FontSize(13).TextColor(a.colors.Tertiary)
		}
		a.actionButton(c, "复制消息 "+m.ID, "复制", "copy-outline", 15, true, func() { c.WriteClipboard(m.Text) })
	})
}
