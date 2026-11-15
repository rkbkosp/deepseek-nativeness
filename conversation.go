package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"strings"
	"time"
)

func (a *app) header(c *ui.Context) {
	left := float32(20)
	if !a.sidebar {
		left = 168
		if c.TitleBar().Left == 0 {
			left = 84
		}
	}
	if placeholder := a.conversationPlaceholder(); placeholder == conversationEmpty || placeholder == conversationNoSession {
		ui.Row(c).Height(40).Shrink(0).Padding(0, 28, 0, left).DragWindow().Children(func() {
			ui.Spacer(c)
			a.sessionMoreMenu(c)
			if ui.ButtonBase(c).Label("切换右侧栏").Padding(4).Children(func() { icon(c, "compare-split-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
				a.rightPaneOpen = !a.rightPaneOpen
				if !a.rightPaneOpen && a.compatPlacement == "right" {
					a.closeCompat()
				}
				if !a.rightPaneOpen && a.webPlacement == "right" {
					a.closeWeb()
				}
			}
		})
		return
	}
	ui.Column(c).Height(76).Shrink(0).BorderWidth(0, 0, .5, 0).BorderColor(a.theme.Border).Children(func() {
		ui.Row(c).Height(40).Padding(0, 28, 0, left).AlignItems(ui.End).DragWindow().Children(func() {
			inner := ui.Row(c).Grow(1).Height(30).MinWidth(0).Gap(10).AlignItems(ui.Center)
			inner.Children(func() {
				title := "Native DSH Remote"
				for _, s := range a.sessions {
					if s.ID == a.sessionID {
						title = s.Title
					}
				}
				ui.Row(c).Grow(1).MinWidth(0).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Text(c, title).FontWeight(500).SingleLine().Ellipsis("…").MaxWidth(220).MinWidth(0).Shrink(1).Label("会话标题")
					a.headerPresetView(c)
				})
				a.sessionMoreMenu(c)
				if ui.ButtonBase(c).Label("切换右侧栏").Padding(4).Children(func() { icon(c, "compare-split-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
					a.rightPaneOpen = !a.rightPaneOpen
					if !a.rightPaneOpen && a.compatPlacement == "right" {
						a.closeCompat()
					}
					if !a.rightPaneOpen && a.webPlacement == "right" {
						a.closeWeb()
					}
				}
			})
		})
		ui.Row(c).Height(36).Padding(0, 28, 0, 20).Gap(32).AlignItems(ui.End).Children(func() {
			for _, v := range []struct{ key, label string }{{"chat", "对话"}, {"trajectory", "轨迹"}} {
				b := ui.ButtonBase(c.Key(v.key)).Label(v.label).Height(35).Padding(10, 10, 9)
				if a.currentTab == v.key {
					b.TextColor(a.colors.Link).BorderWidth(0, 0, 2, 0).BorderColor(a.colors.Link)
				} else {
					b.TextColor(a.colors.Tertiary)
				}
				b.Children(func() { ui.Text(c, v.label).FontSize(13).FixedLineHeight(16).FontWeight(500) })
				if b.Clicked() {
					if v.key == "trajectory" && a.currentTab != "trajectory" {
						a.currentTab = v.key
						a.openCompatAt("trajectory", "trajectory")
					} else if v.key == "chat" {
						a.currentTab = v.key
						if a.compatPlacement == "trajectory" {
							a.closeCompat()
						}
					}
				}
			}
			ui.ButtonBase(c).Label("更多会话视图").Size(22, 22).Padding(0).Children(func() { icon(c, "ellipsis-outline", 14).TextColor(a.colors.Secondary) }).Menu(func(m *ui.Menu) {
				if m.Item("文件").Disabled(!a.can("listFiles")).Chosen() {
					a.rightPaneOpen = true
					s := a.currentRightPane()
					s.Tab = "files"
					if len(s.Directories) == 0 {
						a.loadPaneDirectory(s, "")
					}
				}
				if m.Item("终端").Disabled(!a.can("listTerminals")).Chosen() {
					a.rightPaneOpen = true
					a.openCompatAt("terminal", "right")
				}
			})
			ui.Spacer(c)
		})
	})
}

func (a *app) sessionMoreMenu(c *ui.Context) {
	ui.ButtonBase(c).Label("会话更多操作").Padding(4).Children(func() { icon(c, "ellipsis-outline", 15).TextColor(a.theme.TextMuted) }).Menu(func(m *ui.Menu) {
		if m.Item("复制会话为 Markdown").Disabled(a.demo || a.sessionID == "" || !a.can("exportSessionMarkdown") || a.markdownCopy != nil).Tooltip(a.operationCaps["exportSessionMarkdown"].Reason).Chosen() {
			a.copySessionMarkdown()
		}
		if m.Item("复制已加载消息为 Markdown").Disabled(len(a.current.Messages) == 0).Chosen() {
			c.WriteClipboard(a.loadedMarkdown())
		}
		m.Item("下载 Session 日志").Disabled(true).Tooltip("当前 Remote 未提供原始 Session 日志下载接口")
		m.Separator()
		m.Item("在应用中打开").Disabled(true)
		m.Item("反馈").Disabled(true)
	})
}

func (a *app) conversation(c *ui.Context) {
	placeholder := a.conversationPlaceholder()
	inlineComposer := false
	if a.currentTab == "trajectory" {
		if a.compat != nil && a.compatPlacement == "trajectory" {
			ui.WebView(c, a.compat).Grow(1).MinHeight(0)
		} else if a.compatPendingOwner != "" && a.compatPlacement == "trajectory" {
			ui.Column(c).Grow(1).Center().Children(func() { ui.Text(c, "正在加载轨迹…").TextColor(a.theme.TextMuted) })
		} else {
			a.trajectoryView(c)
		}
	} else if placeholder != conversationChat {
		switch placeholder {
		case conversationConnect:
			ui.Column(c).Grow(1).Center().Gap(12).Padding(30).Children(func() {
				ui.Text(c, "连接你的工作主机").FontSize(25).FontWeight(500)
				ui.Text(c, "工作留在 MacMini，界面在这里。").TextColor(a.theme.TextMuted)
				if ui.Button(c, "选择 Remote 主机").Clicked() {
					a.connectionOpen = true
					a.fetchDevices()
				}
			})
		case conversationNoSession:
			inlineComposer = true
			a.heroView(c)
		case conversationLoading:
			ui.Column(c).Grow(1).Center().Gap(10).Padding(30).Children(func() {
				stateIndicator(c, true, a.epoch, a.theme.TextMuted, &a.metrics)
				ui.Text(c, "正在载入会话…").TextColor(a.theme.TextMuted)
			})
		default:
			inlineComposer = true
			a.heroView(c)
		}
	} else {
		rows := a.chatRows()
		if a.chatRowsCache != nil && a.chatRowsCache.presented {
			rows = a.chatRowsCache.visible
		}
		rows = append([]chatRow(nil), rows...)
		if a.current.Running {
			rows = append(rows, chatRow{ID: "running", Running: true})
		}
		if a.composer != nil {
			for _, item := range a.composer.values.Inbox["next-step"] {
				text, _ := queueText(item)
				if text == "" {
					text = queueBlockLabel(item)
				}
				if text == "" {
					continue
				}
				rows = append(rows, chatRow{ID: "steering:" + item.ID, Steering: true, User: true, Messages: []message{{ID: "steering:" + item.ID, Role: "user", Text: text}}})
			}
		}
		if a.current.HasMore || a.historyLoading || a.historyError != "" {
			rows = append([]chatRow{{ID: "history", History: true}}, rows...)
		}
		markTailRows(rows)
		a.list.Key = func(i int) any { return rows[i].ID }
		ui.Column(c).Grow(1).MinHeight(0).Children(func() {
			list := ui.List(c, &a.list, len(rows), func(i int) {
				r := rows[i]
				var previous chatRow
				if i > 0 {
					previous = rows[i-1]
				}
				item := ui.Row(c).Justify(ui.Center).MinWidth(0).Margin(chatFlowGap(previous, r), 0, 0, 0)
				item.Children(func() {
					ui.Column(c).Width(a.chatContentWidth(c)).Shrink(1).MinWidth(0).Font(a.messageFontFamily()).FontWeight(a.messageNormalWeight()).Gap(chatRowColumnGap(r)).Children(func() {
						if r.History {
							a.historyRowView(c)
							return
						}
						if r.Running {
							a.runningView(c)
							return
						}
						if r.Control {
							a.turnControllerView(c, r)
						} else if r.Notice {
							a.turnNoticeView(c, r)
						} else if r.Group {
							a.groupView(c, r)
						} else if r.Process {
							a.processView(c, r)
						} else if len(r.Parts) > 0 {
							a.chatPartView(c, r.Parts[0])
						} else {
							a.messageView(c, r.Messages[0])
						}
						if r.Tail {
							a.tailActionsView(c, r, item.Hovered(), latestTurn(rows))
						}
					})
				})
			}).Grow(1).MinHeight(0).Padding(16, 32).Gap(0)
			if a.qaListClip {
				list.Clip()
			}
			ui.Box(c).Absolute().Left(0).Right(0).Bottom(0).Height(36).IgnoreInput(true).LinearGradient(ui.LinearGradient{
				Angle: 180,
				Stops: []ui.GradientStop{{Color: ui.Transparent}, {Color: a.theme.Background, At: 1}},
			})
			a.toBottomView(c)
			a.turnRailView(c, rows)
		})
	}
	if !inlineComposer {
		a.composerView(c)
	}
	a.feedbackView(c)
}

// conversationPlaceholder separates "no Remote connection", "no Session
// selected", "that Session is still loading" and "that Session is empty". The
// connect panel used to stand in for all four, so every switch and every blank
// Session looked like a lost connection.
type conversationPlaceholder int

const (
	conversationChat conversationPlaceholder = iota
	conversationConnect
	conversationNoSession
	conversationLoading
	conversationEmpty
)

func (a *app) conversationPlaceholder() conversationPlaceholder {
	if !a.demo && !a.connected {
		return conversationConnect
	}
	if a.sessionID == "" {
		return conversationNoSession
	}
	if len(a.current.Messages) > 0 {
		return conversationChat
	}
	if a.sessionOpening == a.sessionID {
		return conversationLoading
	}
	return conversationEmpty
}

type chatRow struct {
	ID                string
	Process           bool
	Group             bool
	Notice            bool
	NoticeKind        string
	NoticeText        string
	GroupParts        []chatPartRef
	Running           bool
	History           bool
	Steering          bool
	User              bool
	Response          bool
	Tail              bool
	Messages          []message
	Turn              int
	DefaultOpen       bool
	AlwaysOpen        bool
	FoldKey           string
	Parts             []chatPartRef
	ProcessSpec       *chatProcessSpec
	ProcessReason     string
	ProcessStatus     string
	ProcessDuration   *float64
	Control           bool
	CanCollapse       bool
	PositionPayloadID string
	PositionAfter     bool
	LayoutAnchor      float64
}

func (a *app) managedFold(id string, initial bool) *bool {
	if a.flowDefaults == nil {
		a.flowDefaults = map[string]bool{}
	}
	previous, exists := a.flowDefaults[id]
	p := a.foldState(id, initial)
	if !exists || previous != initial {
		*p = initial
		a.flowDefaults[id] = initial
	}
	return p
}
func (a *app) foldState(id string, initial bool) *bool {
	p := a.flowOpen[id]
	if p == nil {
		p = new(bool)
		*p = initial
		a.flowOpen[id] = p
	}
	return p
}
func (a *app) processView(c *ui.Context, row chatRow) {
	if row.ProcessSpec != nil {
		for _, part := range row.Parts {
			a.chatPartView(c, part)
		}
		return
	}
	tools, contexts := 0, 0
	for _, part := range row.Parts {
		if m := a.chatPartMessage(part); m != nil {
			if m.Tool != nil {
				tools++
			} else {
				contexts++
			}
		}
	}
	for _, m := range row.Messages {
		if m.Tool != nil {
			tools++
		} else {
			contexts++
		}
	}
	if row.ProcessSpec != nil {
		tools = row.ProcessSpec.ToolCallCount + row.ProcessSpec.SubagentCount
	}
	label := "执行过程"
	if tools > 0 && contexts > 0 {
		label = fmt.Sprintf("%d 次工具调用 · %d 条上下文", tools, contexts)
	} else if tools > 0 {
		label = fmt.Sprintf("%d 次工具调用", tools)
	} else {
		label = fmt.Sprintf("%d 条上下文", contexts)
	}
	if row.ProcessSpec != nil {
		label = "已完成"
		if row.ProcessDuration != nil {
			label = "已完成，用时 " + formatProcessDuration(*row.ProcessDuration)
		}
		if row.ProcessReason == "aborted" || row.ProcessReason == "interrupted" {
			label = "已停止"
		} else if row.ProcessReason == "error" {
			label = "处理失败"
		}
	}
	body := func() {
		ui.Column(c).Gap(10).Padding(8, 0, 0, 12).BorderWidth(0, 0, 0, 1).BorderColor(a.theme.Border).Children(func() {
			for _, part := range row.Parts {
				a.chatPartView(c, part)
			}
			for _, m := range row.Messages {
				a.messageView(c, m)
			}
		})
	}
	if row.ProcessSpec != nil && row.ProcessStatus != "closed" {
		body()
		return
	}
	if row.AlwaysOpen {
		ui.Text(c, label).FontSize(13).TextColor(a.theme.TextMuted)
		body()
		return
	}
	key := row.FoldKey
	if key == "" {
		key = row.ID
	}
	control := ui.Collapsible(c, label, a.managedFold(key, row.DefaultOpen), body)
	if row.ProcessSpec != nil {
		control.Tooltip(fmt.Sprintf("%d 条回复 · %d 次工具调用 · %d 次子任务", row.ProcessSpec.MessageCount, row.ProcessSpec.ToolCallCount, row.ProcessSpec.SubagentCount))
	}
}

func formatProcessDuration(ms float64) string {
	total := int(max(1000, ms) / 1000)
	hours, minutes, seconds := total/3600, total/60%60, total%60
	text := ""
	if hours > 0 {
		text += fmt.Sprintf("%d小时", hours)
	}
	if total >= 60 {
		text += fmt.Sprintf("%d分", minutes)
	}
	return text + fmt.Sprintf("%d秒", seconds)
}
func (a *app) messageView(c *ui.Context, m message) {
	a.messagePartView(c, m, "", m.ID)
}
func (a *app) messagePartView(c *ui.Context, m message, part, nodeKey string) {
	a.messagePartViewTerminal(c, m, part, nodeKey, nil)
}
func (a *app) messagePartViewTerminal(c *ui.Context, m message, part, nodeKey string, terminal *bool) {
	a.metrics.MessagePartBuilds++
	if a.testChatPartBuild != nil {
		a.testChatPartBuild(nodeKey, part)
	}
	m.ID = nodeKey
	switch {
	case m.Trigger != "":
		a.turnTriggerView(c, &m, nodeKey)
	case m.Context != nil || m.Kind == "context" || m.Kind == "compaction":
		a.contextView(c, m, m.ID)
	case m.Role == "command" || m.Kind == "command":
		a.commandView(c, &m, nodeKey)
	case m.Tool != nil:
		a.toolView(c, &m, nodeKey)
	case m.Role == "user":
		ui.Row(c).Children(func() {
			ui.Spacer(c)
			ui.Column(c).MaxWidth(a.chatContentWidth(c) * .702).Gap(6).Children(func() {
				ui.Column(c).Gap(8).Children(func() {
					a.messageImageGallery(c, m)
					if m.Text != "" {
						ui.Text(c, m.Text).FontSize(a.uiPrefs.FontSize).FixedLineHeight(22).Selectable().Wrap().Padding(10, 16).Radius(20).Background(a.colors.Bubble)
					}
				})
				a.actionStrip(c, m)
			})
		})
	default:
		reasoning := m.ReasoningDisplay
		if reasoning == "" {
			reasoning = m.Reasoning
		}
		hasReasoningBlock := false
		for _, block := range m.AssistantBlocks {
			if block.Kind == "reasoning" {
				hasReasoningBlock = true
				break
			}
		}
		if assistantNonblank(reasoning) && !hasReasoningBlock && part != "response" {
			key := "reasoning:" + m.ID
			a.reasoningView(c, key, reasoning, a.foldState(key, false), m.Streaming)
		}
		if len(m.AssistantBlocks) > 0 {
			for i := 0; i < len(m.AssistantBlocks); i++ {
				b := m.AssistantBlocks[i]
				if part == "reasoning" && b.Kind != "reasoning" || part == "response" && b.Kind == "reasoning" {
					continue
				}
				switch b.Kind {
				case "reasoning":
					if assistantNonblank(b.Text) {
						key := fmt.Sprintf("%s:reasoning:%d", m.ID, i)
						a.reasoningView(c, key, b.Text, a.foldState(key, false), m.Streaming)
					}
				case "text":
					if m.Streaming {
						markdown.Stream(c.Key(fmt.Sprintf("%s:block:%d", m.ID, i)), b.Text, &a.md)
					} else {
						markdown.View(c.Key(fmt.Sprintf("%s:block:%d", m.ID, i)), b.Text, &a.md)
					}
				case "image":
					start := i
					for i+1 < len(m.AssistantBlocks) && m.AssistantBlocks[i+1].Kind == "image" {
						i++
					}
					group := m
					// Like AssistantMarkdown, the first block keys the group so
					// appending an image preserves its existing occurrences.
					group.ID = fmt.Sprintf("%s:image:%d", m.ID, start)
					group.AssistantBlocks = m.AssistantBlocks[start : i+1]
					a.messageImageGallery(c, group)
				case "tool-call":
					// Reasoning and grouped tool rows are rendered separately.
				default:
					a.unknownAssistantBlock(c.Key(fmt.Sprintf("%s:unknown:%d", m.ID, i)), b.Block)
				}
			}
		} else if part == "reasoning" {
			// Legacy aggregate reasoning was rendered above, without duplicating text.
		} else if m.Streaming {
			markdown.Stream(c.Key(m.ID), m.Text, &a.md)
		} else {
			markdown.View(c.Key(m.ID), m.Text, &a.md)
		}
		// Deliberately distinct from nonblank reply qualification: the original
		// terminal marker tests raw block kinds, including blank/BOM text blocks.
		hasResponse := assistantHasRawResponseBlock(&m)
		showStopped := m.Interrupted && (part != "reasoning" || !hasResponse)
		if terminal != nil {
			showStopped = *terminal
		}
		if showStopped {
			// AssistantMarkdown's terminal tag belongs to the whole response,
			// after its blocks, including an otherwise empty aborted response.
			background := ui.RGBA(38, 49, 72, .06)
			foreground := ui.Hex("#81858c")
			if a.theme.Dark {
				background = ui.RGBA(255, 255, 255, .08)
				foreground = ui.Hex("#adb2b8")
			}
			ui.Row(c.Key("stopped:" + m.ID)).Shrink(0).Children(func() {
				ui.Text(c, "已停止").FontSize(11).FixedLineHeight(18).Height(18).Padding(0, 6).Radius(8).Background(background).TextColor(foreground)
			})
		}
	}
}
func (a *app) pendingView(c *ui.Context, p interaction) {
	ui.Column(c).Padding(12).Gap(8).Radius(12).Background(a.colors.Subtle).Border(1, a.theme.Border).Children(func() {
		ui.Text(c, p.Title).FontWeight(500)
		if p.SessionID != "" {
			ui.Text(c, "来源会话："+p.SessionID).FontSize(11).TextColor(a.theme.TextMuted)
		}
		if p.Reason != "" {
			ui.Text(c, p.Reason).Wrap().FontSize(13)
		}
		if p.Kind == "approval" {
			ui.Row(c).Gap(8).Children(func() {
				if ui.Button(c, "拒绝").Disabled(a.busy).Clicked() {
					a.request("answerApproval", map[string]any{"requestId": p.ID, "outcome": "rejected"}, nil)
				}
				if ui.PrimaryButton(c, "允许一次").Disabled(a.busy).Clicked() {
					a.request("answerApproval", map[string]any{"requestId": p.ID, "outcome": "allowed-once"}, nil)
				}
			})
		} else if p.Kind == "questions" {
			a.questionsView(c, p)
		}
	})
}
func (a *app) trajectoryView(c *ui.Context) {
	if len(a.current.Trajectory) == 0 {
		ui.Column(c).Grow(1).Center().Children(func() { ui.Text(c, "当前会话尚无已加载轨迹").TextColor(a.theme.TextMuted) })
		return
	}
	ui.Row(c).Padding(14, 28).Gap(16).Children(func() {
		ui.Text(c, fmt.Sprintf("%d 条事件", len(a.current.Trajectory))).FontSize(12).TextColor(a.theme.TextMuted)
		ui.Spacer(c)
		ui.TextInput(c, &a.trajectorySearch).Placeholder("搜索轨迹").Width(220).Label("搜索轨迹输入框")
	})
	rows := []trajectoryEvent{}
	for _, r := range a.current.Trajectory {
		if a.trajectorySearch == "" || strings.Contains(strings.ToLower(r.Summary+" "+r.Type), strings.ToLower(a.trajectorySearch)) {
			rows = append(rows, r)
		}
	}
	a.trajectoryList.Key = func(i int) any { return rows[i].ID }
	ui.List(c, &a.trajectoryList, len(rows), func(i int) {
		r := rows[i]
		color := a.theme.Accent
		switch r.Kind {
		case "user":
			color = ui.Hex("#4d93f8")
		case "developer", "context":
			color = ui.Hex("#4ed17e")
		case "assistant":
			color = ui.Hex("#b396f6")
		case "tool":
			color = ui.Hex("#f7ad31")
		}
		ui.Row(c.Key(r.ID)).Gap(12).Padding(8, 24).Children(func() {
			ui.Text(c, time.UnixMilli(int64(r.Time)).Format("15:04:05")).FontSize(11).TextColor(a.theme.TextMuted).Width(58)
			ui.Column(c).Grow(1).Padding(0, 0, 0, 12).BorderWidth(0, 0, 0, 2).BorderColor(color).Children(func() {
				label := r.Type
				if r.Summary != "" {
					label += "  " + r.Summary
				}
				ui.Collapsible(c, label, a.foldState("trajectory:"+r.ID, false), func() { ui.Text(c, string(r.Data)).Font("SF Mono, Menlo").FontSize(12).Wrap().Selectable() })
			})
		})
	}).Grow(1)
}
