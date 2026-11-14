package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

type settingsOption struct{ value, label string }

type settingsHostNamespace struct {
	NS       string                     `json:"ns"`
	Revision int64                      `json:"revision"`
	Value    map[string]json.RawMessage `json:"value"`
}
type settingsPermissionOption struct {
	Value string `json:"value"`
	Name  string `json:"name"`
}
type settingsHostState struct {
	HostID                                             string
	RemoteGeneration                                   uint64
	Started, Loading, Ready, Writable, Saving, Unknown bool
	Error, Notice, DefaultPreset                       string
	Namespaces                                         map[string]settingsHostNamespace
	DefaultOptions                                     []settingsPermissionOption
	ConfirmFull, Acknowledged                          bool
}

func (a *app) settingsControlFill() ui.Color {
	// design-platform.css: --dsw-alias-bg-module-platform, neutral-bluish 800/60.
	if a.theme.Dark {
		return ui.RGB(53, 54, 56)
	}
	return ui.RGB(245, 246, 247)
}

// Presentation preferences are private to this client. Opening the panel only
// reads Host descriptors; Host writes require a deliberate control action.
func (a *app) settingsView(c *ui.Context) {
	width, height := c.Size()
	panelWidth := min(float32(800), width-48)
	panelHeight := min(float32(800), height-136)
	if a.settingsSection == "" {
		a.settingsSection = "general"
	}
	var hostSettings *settingsHostState
	ui.Modal(c, &a.settingsOpen, func() {
		panel := ui.Row(c).Width(panelWidth).Height(panelHeight).AlignItems(ui.Stretch).Gap(0).FontWeight(300).Clip()
		hostSettings = ui.Local(panel, fmt.Sprintf("settings-host:%s:%d", a.hostID, a.remoteGeneration), func() settingsHostState {
			return settingsHostState{HostID: a.hostID, RemoteGeneration: a.remoteGeneration, Namespaces: map[string]settingsHostNamespace{}}
		})
		if !hostSettings.Started && !a.demo && a.can("describeSettings") {
			a.loadHostGeneralSettings(hostSettings)
		}
		panel.Children(func() {
			ui.Column(c).Width(188).Height(panelHeight).MinHeight(0).Shrink(0).Justify(ui.Start).Children(func() {
				ui.Text(c, "设置").FontSize(16).FontWeight(500).Height(54).Shrink(0).Padding(22, 12, 8, 24)
				ui.Column(c).Padding(10, 12, 0).Gap(4).Children(func() {
					for _, section := range []struct{ id, title, glyph string }{
						{"general", "通用设置", "settings-outline"},
						{"models", "模型", "data-outline"},
						{"plugins", "内置插件", "personalization-outline"},
						{"agent-presets", "Agent 预设", "agent-preset-outline"},
					} {
						section := section
						button := ui.ButtonBase(c.Key(section.id)).Height(40).Padding(9, 12).Gap(8).Radius(12).Justify(ui.Start).Label(section.title)
						if a.settingsSection == section.id || a.settingsSection == "shortcuts" && section.id == "general" {
							button.Background(a.colors.Selected)
						} else if button.Hovered() {
							button.Background(a.colors.RowHover)
						}
						button.Children(func() {
							icon(c, section.glyph, 16)
							ui.Text(c, section.title).FontSize(14).FontWeight(300)
						})
						if button.Clicked() {
							a.settingsSection = section.id
						}
					}
				})
			})
			ui.Column(c).Grow(1).Height(panelHeight).MinHeight(0).MinWidth(0).Justify(ui.Start).Children(func() {
				ui.Row(c).Height(54).Shrink(0).Padding(16, 14, 8, 10).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Spacer(c)
					ui.Button(c, "打开配置文件").Disabled(true).Tooltip("当前 Remote 通道不支持打开主机配置文件")
					if ui.ButtonBase(c).Size(28, 28).Radius(6).Label("关闭设置").Children(func() { icon(c, "close-outline", 14) }).Clicked() {
						a.settingsOpen = false
					}
				})
				ui.Scroll(c.Key("settings-content-" + a.settingsSection)).Grow(1).Shrink(1).MinHeight(0).MinWidth(0).Clip().Children(func() {
					ui.Column(c).Shrink(0).Padding(0, 24, 24).FontWeight(300).Children(func() {
						switch a.settingsSection {
						case "general":
							a.generalSettings(c, hostSettings)
						case "shortcuts":
							a.settingsShortcuts(c)
						default:
							ui.Text(c, "此设置页尚未接入").FontSize(16).FontWeight(500).Padding(24, 0, 10)
							ui.Text(c, "主机上的模型、插件与 Agent 预设保持不变。").Wrap().TextColor(a.theme.TextMuted)
						}
					})
				})
			})
		})
	}).Padding(0).Gap(0).Radius(24).Background(a.colors.Popup).Width(panelWidth).Height(panelHeight).FontWeight(300).Clip().Label("设置")
	if hostSettings != nil && a.settingsOpen && hostSettings.ConfirmFull {
		s := hostSettings
		ui.Modal(c, &s.ConfirmFull, func() {
			ui.Text(c, "确认启用完全权限？").FontSize(16).FontWeight(500)
			ui.Text(c, "启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。").Wrap().FontWeight(300)
			ui.Checkbox(c, &s.Acknowledged, "我已了解风险，并愿意继续")
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					s.ConfirmFull = false
					s.Acknowledged = false
				}
				if ui.PrimaryButton(c, "启用完全权限").Disabled(!s.Acknowledged || !a.hostGeneralWritable(s)).Clicked() {
					s.ConfirmFull = false
					s.Acknowledged = false
					a.writeHostGeneralSetting(s, "permission", "defaultPreset", "danger-full-access")
				}
			})
		}).Width(480)
	}
}

func (a *app) settingRow(c *ui.Context, title, description string, control func()) {
	ui.Row(c).Padding(16, 0).Gap(18).BorderWidth(0, 0, 0.5, 0).BorderColor(a.theme.Border).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Gap(6).Children(func() {
			ui.Text(c, title).FontSize(14).FontWeight(300).Wrap()
			if description != "" {
				ui.Text(c, description).FontSize(12).TextColor(a.theme.TextMuted).Wrap()
			}
		})
		if control != nil {
			control()
		}
	})
}

func (a *app) settingsChoice(c *ui.Context, title, description string, value *string, options []settingsOption) {
	a.settingRow(c.Key(title), title, description, func() {
		label := ""
		for _, o := range options {
			if o.value == *value {
				label = o.label
			}
		}
		if label == "" && len(options) > 0 {
			label = options[0].label
		}
		sel := ui.SelectBase(c, value)
		sel.Trigger.MinWidth(104).Height(36).Padding(8, 14).Gap(10).Radius(10).FontWeight(300).Background(a.settingsControlFill()).Label(title).Children(func() {
			ui.Text(c, label).FontSize(14).FontWeight(300)
			icon(c, "chevron-down-outline", 12)
		})
		sel.Popup(func(panel ui.Element) {
			panel.Padding(4).Radius(10).Background(a.colors.Popup).Border(1, a.theme.Border)
			for _, option := range options {
				option := option
				item := sel.Item(option.value).Padding(8, 12).Radius(6)
				if item.Highlighted() {
					item.Background(a.colors.RowHover)
				}
				item.Children(func() {
					ui.Text(c, option.label).FontSize(14).Grow(1)
					if *value == option.value {
						icon(c, "check-outline", 14)
					}
				})
			}
		})
		if sel.Trigger.Changed() {
			a.savePreferences()
		}
	})
}

func (a *app) generalSettings(c *ui.Context, host *settingsHostState) {
	a.hostPermissionSetting(c, host)
	a.settingRow(c, "语言", "", func() {
		ui.Button(c, "中文").Disabled(true).Tooltip("当前原生界面提供中文")
	})
	ui.Column(c).Padding(20, 0, 16).Gap(12).BorderWidth(0, 0, 1, 0).BorderColor(a.theme.Border).Children(func() {
		ui.Text(c, "外观").FontSize(14)
		ui.Row(c).Gap(8).Children(func() {
			for _, option := range []struct{ value, title, glyph string }{{"light", "浅色", "light-outline"}, {"dark", "深色", "dark-outline"}, {"system", "跟随系统", "followsystem-outline"}} {
				option := option
				card := ui.ButtonBase(c.Key(option.value)).Grow(1).Height(84).Radius(16).Border(1, a.theme.Border).Gap(8).Label(option.title)
				if a.uiPrefs.Theme == option.value {
					card.Background(a.settingsControlFill()).BorderColor(a.theme.TextMuted)
				} else if card.Hovered() {
					card.Background(a.colors.RowHover)
				}
				card.Children(func() {
					ui.Column(c).Gap(8).AlignItems(ui.Center).Children(func() {
						icon(c, option.glyph, 18)
						ui.Text(c, option.title).FontSize(14)
					})
				})
				if card.Clicked() {
					a.uiPrefs.Theme = option.value
					a.savePreferences()
				}
			}
		})
	})
	a.settingsFontSize(c, "字号大小", "仅影响会话内容的字号", &a.uiPrefs.FontSize, 10, 22, true)
	if a.fontSettingsOpen {
		a.settingsFontFamily(c, "正文字体", "用于界面与会话正文。多个字体用逗号分隔，留空使用默认字体", &a.uiPrefs.TextFontFamily)
		a.settingsFontFamily(c, "代码字体", "用于代码块、行内代码与工具输出。多个字体用逗号分隔，留空使用默认字体", &a.uiPrefs.CodeFontFamily)
		a.settingsFontSize(c, "代码字号", "用于代码块、行内代码与工具输出", &a.uiPrefs.CodeFontSize, 10, 16, false)
		a.settingsFontFamily(c, "终端字体", "用于侧栏终端。多个字体用逗号分隔，留空使用默认字体", &a.uiPrefs.TerminalFontFamily)
		a.settingsFontSize(c, "终端字号", "用于侧栏终端", &a.uiPrefs.TerminalFontSize, 10, 20, false)
	}
	a.settingsChoice(c, "工作步骤展示", "选择希望看到多少工具调用细节", &a.uiPrefs.StepsDetail, []settingsOption{{"compact", "简洁"}, {"standard", "标准"}, {"detailed", "详细"}, {"verbose", "完全展开"}})
	a.settingsChoice(c, "工作步骤收起时机", "选择何时自动收起工作步骤", &a.uiPrefs.StepsCollapse, []settingsOption{{"completion", "回答结束后"}, {"next-input", "下次有新消息时"}})
	if a.uiPrefs.StepsDetail != "verbose" {
		a.settingsChoice(c, "收起后显示的回复", "工作步骤收起后，保留哪些助手回复", &a.uiPrefs.FoldedReplies, []settingsOption{{"all", "全部回复"}, {"final", "仅最终回答"}})
	}
	a.settingRow(c, "显示代码工作视图", "开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换", func() {
		if ui.Switch(c, &a.uiPrefs.CodeWorkView).Label("显示代码工作视图").Changed() {
			a.savePreferences()
		}
	})
	a.settingRow(c, "快捷键", "查看当前可用的快捷键和输入操作", func() {
		if ui.Button(c, "查看快捷键").Clicked() {
			a.settingsSection = "shortcuts"
		}
	})
	a.settingsChoice(c, "网页链接默认打开方式", "对话中网页链接的打开位置", &a.uiPrefs.LinkOpen, []settingsOption{{"sidebar", "应用内侧边栏"}, {"new-tab", "默认浏览器"}})
	a.settingsChoice(c, "繁忙时的发送行为", "智能体运行时 Enter 键和发送按钮的行为；Cmd+Enter 使用另一行为", &a.uiPrefs.SendMode, []settingsOption{{"queue", "排队发送"}, {"steer", "立即发送"}})
	a.settingsChoice(c, "性能与用量", "选择性能与用量信息展示的详细程度", &a.uiPrefs.UsageDetail, []settingsOption{{"compact", "简洁"}, {"detailed", "详细"}})
	a.settingRow(c, "在使用官方模型 API 时上传 Session Log", "帮助改进 DeepSeek 模型与产品", func() {
		namespace, available := host.Namespaces["session-log-deepseek"]
		var enabled bool
		_ = json.Unmarshal(namespace.Value["enabled"], &enabled)
		if ui.Switch(c, &enabled).Label("在使用官方模型 API 时上传 Session Log").Disabled(!available || !a.hostGeneralWritable(host)).Changed() {
			a.writeHostGeneralSetting(host, "session-log-deepseek", "enabled", enabled)
		}
	})
	if host.Error != "" || host.Notice != "" {
		text := host.Notice
		if host.Error != "" {
			text = host.Error
		}
		ui.Text(c, text).FontSize(12).Wrap().TextColor(a.theme.TextMuted).Padding(10, 0)
	}
	if a.connected && !a.demo {
		if ui.Button(c, "刷新主机设置").Disabled(host.Loading || host.Saving || !a.can("describeSettings")).Clicked() {
			a.loadHostGeneralSettings(host)
		}
	}
	a.settingRow(c, "更新渠道", "Native DSH Remote", func() {
		ui.Text(c, "本地开发版本").FontSize(12).TextColor(a.theme.TextMuted)
	})
}

func permissionSettingLabel(value, name string) string {
	defaults := map[string]string{"read-only": "Read Only", "workspace-write": "Workspace Write", "danger-full-access": "Full Access"}
	labels := map[string]string{"read-only": "仅可查看", "workspace-write": "工作区内修改", "danger-full-access": "完全权限"}
	if name == "" || name == value || name == defaults[value] {
		if label := labels[value]; label != "" {
			return label
		}
	}
	return name
}
func (a *app) hostGeneralWritable(s *settingsHostState) bool {
	return s.Ready && s.Writable && !s.Loading && !s.Saving && !s.Unknown && s.HostID == a.hostID && s.RemoteGeneration == a.remoteGeneration && a.can("mutateSettings")
}
func (a *app) hostPermissionSetting(c *ui.Context, s *settingsHostState) {
	current := s.DefaultPreset
	ns, namespaceAvailable := s.Namespaces["permission"]
	if namespaceAvailable {
		_ = json.Unmarshal(ns.Value["defaultPreset"], &current)
	}
	label := "不可用"
	currentAdvertised := false
	if s.Loading {
		label = "加载中"
	}
	for _, o := range s.DefaultOptions {
		if o.Value == current {
			currentAdvertised = true
			label = permissionSettingLabel(o.Value, o.Name)
		}
	}
	a.settingRow(c, "权限", "选择新会话的默认权限模式", func() {
		selected := current
		sel := ui.SelectBase(c, &selected)
		sel.Trigger.Height(36).Padding(8, 14).Gap(12).Radius(10).Background(a.settingsControlFill()).Label("新会话默认权限").Disabled(!namespaceAvailable || !currentAdvertised || !a.hostGeneralWritable(s) || len(s.DefaultOptions) == 0).Children(func() { ui.Text(c, label).FontSize(14).FontWeight(300); icon(c, "chevron-down-outline", 12) })
		sel.Popup(func(panel ui.Element) {
			panel.Padding(4).Radius(10).Background(a.colors.Popup).Border(1, a.theme.Border)
			for _, o := range s.DefaultOptions {
				o := o
				item := sel.Item(o.Value).Padding(8, 12).Radius(6)
				if item.Highlighted() {
					item.Background(a.colors.RowHover)
				}
				item.Children(func() { ui.Text(c, permissionSettingLabel(o.Value, o.Name)).FontSize(14) })
			}
		})
		if sel.Trigger.Changed() && selected != current {
			if selected == "danger-full-access" {
				s.ConfirmFull = true
				s.Acknowledged = false
			} else {
				a.writeHostGeneralSetting(s, "permission", "defaultPreset", selected)
			}
		}
	})
}
func (a *app) loadHostGeneralSettings(s *settingsHostState) {
	if s.Loading || s.Saving || a.demo || a.client == nil || !a.connected {
		return
	}
	s.Started = true
	s.Loading = true
	s.Error = ""
	s.Notice = ""
	client, host, generation := a.client, s.HostID, s.RemoteGeneration
	scope := map[string]any{"hostId": host, "generation": generation}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "describeSettings", map[string]any{"clientScope": scope})
		var describe struct {
			Writable   bool                    `json:"writable"`
			Namespaces []settingsHostNamespace `json:"namespaces"`
		}
		if err == nil {
			err = json.Unmarshal(raw, &describe)
		}
		var catalog struct {
			DefaultPreset  string                     `json:"defaultPreset"`
			DefaultOptions []settingsPermissionOption `json:"defaultOptions"`
		}
		var catalogErr error
		if err == nil {
			raw, catalogErr = client.Call(ctx, "permissionCatalog", map[string]any{"clientScope": scope})
			if catalogErr == nil {
				catalogErr = json.Unmarshal(raw, &catalog)
			}
		}
		a.update(func() {
			s.Loading = false
			if host != a.hostID || generation != a.remoteGeneration || client != a.client {
				s.Started = false
				s.Ready = false
				return
			}
			if err != nil {
				s.Error = "无法读取主机设置：" + err.Error()
				return
			}
			s.Namespaces = map[string]settingsHostNamespace{}
			for _, ns := range describe.Namespaces {
				if ns.NS == "permission" || ns.NS == "session-log-deepseek" {
					s.Namespaces[ns.NS] = ns
				}
			}
			s.DefaultPreset = catalog.DefaultPreset
			s.DefaultOptions = catalog.DefaultOptions
			s.Writable = describe.Writable
			s.Ready = true
			s.Unknown = false
			if catalogErr != nil {
				s.Error = "无法读取权限列表：" + catalogErr.Error()
			}
		})
	}()
}
func (a *app) writeHostGeneralSetting(s *settingsHostState, namespace, key string, value any) {
	if !a.hostGeneralWritable(s) || a.demo || a.client == nil {
		return
	}
	ns, ok := s.Namespaces[namespace]
	if !ok {
		return
	}
	if namespace != "permission" || key != "defaultPreset" {
		if namespace != "session-log-deepseek" || key != "enabled" {
			return
		}
	}
	if namespace == "permission" {
		preset, valid := value.(string)
		advertised := false
		for _, option := range s.DefaultOptions {
			if option.Value == preset {
				advertised = true
				break
			}
		}
		if !valid || !advertised {
			return
		}
	} else if _, valid := value.(bool); !valid {
		return
	}
	s.Saving = true
	s.Error = ""
	s.Notice = ""
	requestID := rand.Text()
	client, host, generation := a.client, s.HostID, s.RemoteGeneration
	params := map[string]any{"ns": namespace, "ops": []any{map[string]any{"op": "set", "path": []string{key}, "value": value}}, "expectedRevision": ns.Revision, "requestId": requestID, "clientScope": map[string]any{"hostId": host, "generation": generation}}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "mutateSettings", params)
		var accepted settingsHostNamespace
		if err == nil {
			accepted, err = acceptedHostSetting(raw, requestID, namespace, key, value)
		}
		a.update(func() {
			s.Saving = false
			if host != a.hostID || generation != a.remoteGeneration || client != a.client {
				s.Unknown = true
				s.Error = "连接目标已改变，请刷新主机设置核对结果。"
				return
			}
			if err != nil {
				s.Error = "设置结果未确认，请刷新核对后再操作。"
				s.Unknown = true
				return
			}
			s.Namespaces[namespace] = accepted
			s.Notice = "设置已保存"
		})
	}()
}

func acceptedHostSetting(raw json.RawMessage, requestID, namespace, key string, desired any) (settingsHostNamespace, error) {
	var receipt struct {
		Status    string                `json:"status"`
		RequestID string                `json:"requestId"`
		Value     settingsHostNamespace `json:"value"`
	}
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return settingsHostNamespace{}, err
	}
	if receipt.Status != "accepted" || receipt.RequestID != requestID || receipt.Value.NS != namespace {
		return settingsHostNamespace{}, fmt.Errorf("unconfirmed settings receipt")
	}
	actual := receipt.Value.Value[key]
	if len(actual) == 0 {
		return settingsHostNamespace{}, fmt.Errorf("missing accepted settings value")
	}
	var decoded any
	if err := json.Unmarshal(actual, &decoded); err != nil {
		return settingsHostNamespace{}, err
	}
	if decoded != desired {
		return settingsHostNamespace{}, fmt.Errorf("accepted settings value differs from requested value")
	}
	return receipt.Value, nil
}

func (a *app) settingsFontSize(c *ui.Context, title, description string, value *float32, lo, hi float32, expander bool) {
	a.settingRow(c.Key(title), title, description, func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			pill := ui.Row(c).Width(72).Height(36).Radius(10).Background(a.settingsControlFill()).AlignItems(ui.Center)
			pill.Children(func() {
				ui.Text(c, fmt.Sprintf("%.0f", *value)).Grow(1).TextAlign(ui.Center).FontSize(14).Padding(0, 10)
				ui.Column(c).Width(17).Margin(0, 4, 0, 0).Gap(1).Children(func() {
					for _, step := range []struct {
						delta        float32
						label, glyph string
					}{{1, "增大", "chevron-up-outline"}, {-1, "减小", "chevron-down-outline"}} {
						step := step
						arrow := ui.ButtonBase(c).Size(17, 14).Radius(3).Label(step.label + title).Disabled(step.delta > 0 && *value >= hi || step.delta < 0 && *value <= lo)
						if pill.Hovered() || arrow.Focused() {
							arrow.Children(func() { icon(c, step.glyph, 9) })
						}
						if arrow.Clicked() {
							*value = min(hi, max(lo, *value+step.delta))
							a.savePreferences()
						}
					}
				})
			})
			ui.Text(c, "px").FontSize(14).TextColor(a.theme.TextMuted)
			if expander {
				if ui.ButtonBase(c).Size(24, 24).Label("更多字体设置").Tooltip("更多字体设置").Children(func() {
					glyph := "chevron-down-outline"
					if a.fontSettingsOpen {
						glyph = "chevron-up-outline"
					}
					icon(c, glyph, 12)
				}).Clicked() {
					a.fontSettingsOpen = !a.fontSettingsOpen
				}
			}
		})
	})
}

func normalizeNativeFontFamily(value string) string {
	var result []string
	generic := map[string]bool{"serif": true, "sans-serif": true, "monospace": true, "cursive": true, "fantasy": true, "system-ui": true, "ui-serif": true, "ui-sans-serif": true, "ui-monospace": true, "ui-rounded": true, "emoji": true, "math": true, "fangsong": true, "-apple-system": true, "blinkmacsystemfont": true}
	for _, name := range strings.Split(value, ",") {
		name = strings.Map(func(r rune) rune {
			if r < 32 || r == 127 || strings.ContainsRune("\"'\\<>", r) {
				return -1
			}
			return r
		}, name)
		name = strings.Join(strings.Fields(name), " ")
		if name == "" {
			continue
		}
		if !generic[strings.ToLower(name)] {
			name = "\"" + name + "\""
		}
		result = append(result, name)
	}
	return strings.Join(result, ", ")
}

func (a *app) settingsFontFamily(c *ui.Context, title, description string, value *string) {
	row := ui.Column(c.Key(title)).Padding(16, 0).Gap(6).BorderWidth(0, 0, 1, 0).BorderColor(a.theme.Border)
	row.Children(func() {
		ui.Text(c, title).FontSize(14)
		ui.Text(c, description).FontSize(12).Wrap().TextColor(a.theme.TextMuted)
		draft := ui.Local(row, "font-family-draft", func() string { return *value })
		input := ui.TextInput(c, draft).Label(title).Placeholder("默认").Margin(6, 0, 0)
		if input.Submitted() || input.FocusLeft() {
			if len([]rune(*draft)) > 200 {
				*draft = string([]rune(*draft)[:200])
			}
			*value = normalizeNativeFontFamily(*draft)
			*draft = *value
			a.savePreferences()
		}
	})
}

func (a *app) settingsShortcuts(c *ui.Context) {
	ui.Column(c).Padding(20, 0).Gap(12).Children(func() {
		if ui.Button(c, "返回通用设置").Clicked() {
			a.settingsSection = "general"
		}
		ui.Text(c, "快捷键").FontSize(16).FontWeight(500)
		ui.Text(c, "快捷键由当前原生界面的操作提供。").TextColor(a.theme.TextMuted).Wrap()
		ui.Text(c, "⌘B  收起或展开侧边栏\n⌘K  搜索会话\n⌘,  打开设置\nEsc  关闭弹层\n⌘C  复制选中的文字").FontSize(14).Wrap().Selectable()
	})
}
