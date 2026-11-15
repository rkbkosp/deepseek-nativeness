package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type settingsOption struct{ value, label string }

var settingsLayoutDebug = os.Getenv("NATIVE_DSH_DEBUG_LAYOUT") == "1"

// appVersionInfo is what scripts/build-app.sh wrote beside the executable. A
// launch that is not an .app bundle (go run, tests, a bare binary) has none,
// and then the settings row says so instead of inventing a version.
type appVersionInfo struct {
	AppVersion, BuildNumber, RuntimeVersion, BuiltAt string
	Bundled                                          bool
}

// settingsVersionSource is replaceable so tests need no bundle on disk. The
// real source reads once: the row is drawn every frame, and a bundle's manifest
// cannot change while the application runs.
var (
	appVersionOnce        sync.Once
	appVersionMemo        appVersionInfo
	settingsVersionSource = func() appVersionInfo {
		appVersionOnce.Do(func() { appVersionMemo = readAppVersionInfo() })
		return appVersionMemo
	}
)

func readAppVersionInfo() appVersionInfo {
	path := appVersionManifestPath()
	if path == "" {
		return appVersionInfo{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return appVersionInfo{}
	}
	var manifest struct {
		AppVersion     string `json:"appVersion"`
		BuildNumber    string `json:"buildNumber"`
		RuntimeVersion string `json:"runtimeVersion"`
		BuiltAt        string `json:"builtAt"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		return appVersionInfo{}
	}
	return appVersionInfo{
		AppVersion:     strings.TrimSpace(manifest.AppVersion),
		BuildNumber:    strings.TrimSpace(manifest.BuildNumber),
		RuntimeVersion: strings.TrimSpace(manifest.RuntimeVersion),
		BuiltAt:        strings.TrimSpace(manifest.BuiltAt),
		Bundled:        true,
	}
}

// summary is the version line: the shipped release, its build number, and the
// runtime the bundle embeds. Every part is optional; the fallback names the
// situation instead of showing a blank version.
func (v appVersionInfo) summary() string {
	if !v.Bundled {
		return "开发构建（未从打包应用运行）"
	}
	version := v.AppVersion
	if version == "" {
		version = "未知"
	}
	if v.BuildNumber != "" {
		version += "（构建 " + v.BuildNumber + "）"
	}
	line := "当前版本 " + version
	if v.RuntimeVersion != "" {
		line += " · 运行时 " + v.RuntimeVersion
	}
	return line
}

// settingsVersionDescription is the version row's line: this bundle's numbers
// and the updater's state, so both are readable without opening a menu.
func (a *app) settingsVersionDescription() string {
	snapshot := updates.snapshot()
	parts := []string{settingsVersionSource().summary()}
	if summary := snapshot.Summary(); summary != "" {
		parts = append(parts, summary)
	}
	if !snapshot.CheckedAt.IsZero() {
		parts = append(parts, "上次检查 "+snapshot.CheckedAt.Local().Format("2006-01-02 15:04"))
	}
	return strings.Join(parts, " · ")
}

// Shell hooks are replaceable so a test observes the path without opening
// Finder.
var (
	settingsConfigExists = func(path string) bool {
		_, err := os.Stat(path)
		return err == nil
	}
	settingsRevealConfigItem = mygo.Shell.ShowItemInFolder
	settingsOpenConfigFolder = mygo.Shell.OpenPath
)

// revealSettingsConfig shows the client preference file, or its directory
// while the file does not exist yet. It reports what happened, so the caller
// can say it and hide the control when this launch has no preference path.
func revealSettingsConfig() (bool, string) {
	path := preferencePath()
	if path == "" {
		return false, "无法定位本地配置目录"
	}
	if settingsConfigExists(path) {
		settingsRevealConfigItem(path)
		return true, "已在 Finder 中显示配置文件"
	}
	directory := filepath.Dir(path)
	if settingsConfigExists(directory) {
		if err := settingsOpenConfigFolder(directory); err != nil {
			return false, "无法打开配置目录：" + err.Error()
		}
		return true, "已打开配置目录（配置文件尚未创建）"
	}
	return false, "配置目录尚未创建"
}

func settingsCompatRoute(section string) string {
	switch section {
	case "models":
		return "model-settings"
	case "agent-presets":
		return "agent-presets"
	case "plugins":
		return "plugin-settings"
	}
	return ""
}

// Sidebar and the modal rail share one user-intent entry point. The requested
// section is recorded before asynchronous owner registration begins.
func (a *app) openSettingsSection(section string) {
	previous := a.settingsPageRequested
	a.settingsOpen = true
	a.settingsSection = section
	a.settingsPageRequested = section
	route := settingsCompatRoute(section)
	if route == "" {
		if a.compatPlacement != "" {
			a.closeCompat()
		}
		return
	}
	if a.compatPlacement == "settingsContent" && ((a.compat != nil && a.compatPage == route) || (a.compatPendingOwner != "" && previous == section)) {
		return
	}
	a.openCompatAt(route, "settingsContent")
}
func (a *app) closeSettings() {
	a.settingsOpen = false
	a.settingsPageRequested = ""
	if a.compatPlacement == "settingsContent" {
		a.closeCompat()
	}
}

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
	// Served names every Host settings namespace this session read, in Host
	// order. The reference sections report what the Host actually serves
	// instead of assuming a namespace exists.
	Served                    []string
	DefaultOptions            []settingsPermissionOption
	ConfirmFull, Acknowledged bool
	WKRect                    ui.Rect
	WKRectSeen                bool
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
	// A single compatibility page is resident. Opening Settings leaves the
	// previous global page; closing it returns to the native conversation.
	if a.compatPlacement != "" && a.compatPlacement != "settingsContent" {
		a.closeCompat()
	}
	if a.settingsPageRequested != a.settingsSection {
		a.openSettingsSection(a.settingsSection)
	}
	var hostSettings *settingsHostState
	ui.Modal(c, &a.settingsOpen, func() {
		panel := ui.Row(c).Width(panelWidth).Height(panelHeight).AlignItems(ui.Stretch).Gap(0).FontWeight(300).Clip()
		hostSettings = ui.Local(panel, fmt.Sprintf("settings-host:%s:%d", a.hostID, a.remoteGeneration), func() settingsHostState {
			return settingsHostState{HostID: a.hostID, RemoteGeneration: a.remoteGeneration, Namespaces: map[string]settingsHostNamespace{}}
		})
		if (a.settingsSection == "general" || a.settingsSection == "shortcuts") && !hostSettings.Started && !a.demo && a.can("describeSettings") {
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
							hostSettings.ConfirmFull = false
							a.openSettingsSection(section.id)
						}
					}
				})
			})
			contentWidth, contentHeight := panelWidth-188, panelHeight-54
			ui.Column(c).Width(contentWidth).Shrink(0).Height(panelHeight).MinHeight(0).MinWidth(0).Justify(ui.Start).Children(func() {
				ui.Row(c).Height(54).Shrink(0).Padding(16, 14, 8, 10).Gap(8).AlignItems(ui.Center).Children(func() {
					ui.Spacer(c)
					// A preference path this launch cannot locate is hidden, not
					// disabled: the control would be a promise it cannot keep.
					if path := preferencePath(); path != "" {
						if ui.Button(c, "打开配置文件").Tooltip("在 Finder 中显示本地配置文件：" + path).Clicked() {
							if _, notice := revealSettingsConfig(); notice != "" {
								a.copyNotice = notice
							}
						}
					}
					if ui.ButtonBase(c).Size(28, 28).Radius(6).Label("关闭设置").Children(func() { icon(c, "close-outline", 14) }).Clicked() {
						a.closeSettings()
					}
				})
				if route := settingsCompatRoute(a.settingsSection); route != "" {
					ui.Column(c.Key("settings-web-content")).Width(contentWidth).Height(contentHeight).Shrink(0).MinHeight(0).MinWidth(0).Clip().Children(func() {
						if a.compat != nil && a.compatPlacement == "settingsContent" && a.compatPage == route {
							ui.WebView(c.Key("settings-wk-"+a.compatOwner), a.compat).Size(contentWidth, contentHeight).Shrink(0).MinHeight(0).MinWidth(0).Clip().Draw(func(_ *ui.Painter, r ui.Rect) {
								if settingsLayoutDebug && (!hostSettings.WKRectSeen || hostSettings.WKRect != r) {
									hostSettings.WKRectSeen = true
									hostSettings.WKRect = r
									log.Printf("settings-wk route=%s rect=(%.2f,%.2f %.2fx%.2f) modal=%.2fx%.2f content=%.2fx%.2f", route, r.X, r.Y, r.W, r.H, panelWidth, panelHeight, contentWidth, contentHeight)
								}
							})
						} else {
							ui.Column(c).Grow(1).FillWidth().Center().Padding(24).Gap(12).Children(func() {
								label := "正在加载设置…"
								if a.compatPendingOwner == "" {
									label = "无法打开此设置页"
								}
								ui.Text(c, label).FontSize(14).TextColor(a.theme.TextMuted)
								if a.compatPendingOwner == "" {
									if ui.Button(c, "重新打开设置页").Disabled(!a.connected || a.busy).Clicked() {
										a.openSettingsSection(a.settingsSection)
									}
								}
							})
						}
					})
				} else {
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
				}
			})
		})
	}).Padding(0).Gap(0).Radius(24).Background(a.settingsPanelFill()).Width(panelWidth).Height(panelHeight).FontWeight(300).Clip().Label("设置")
	if !a.settingsOpen {
		a.closeSettings()
	}
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
	// The interface ships in Chinese only. A disabled selector would advertise a
	// choice that does not exist, so the row is absent until another locale is
	// actually packaged.
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
					a.selectAppearance(option.value)
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
	// Version and the last check live here as well as in the application menu,
	// so the state is readable without opening a menu.
	a.settingRow(c, "版本与更新", a.settingsVersionDescription(), func() {
		if !updateCheckConfigured() {
			ui.Text(c, "未配置更新源").FontSize(12).TextColor(a.theme.TextMuted)
			return
		}
		if ui.Button(c, "检查更新…").Disabled(updates.snapshot().State == updateStateChecking).Clicked() {
			a.checkForUpdates()
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
	a.securityPrivacySection(c, host)
	a.fileSearchSection(c)
	a.notificationsSection(c, host)
	a.shortcutsReferenceSection(c)
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
	a.settingRow(c, "更新渠道", productName, func() {
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
				s.Served = nil
				return
			}
			s.Namespaces = map[string]settingsHostNamespace{}
			s.Served = nil
			for _, ns := range describe.Namespaces {
				if ns.NS == "" {
					continue
				}
				s.Served = append(s.Served, ns.NS)
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

// settingsShortcutRows is the one read-only shortcut list both the reference
// section and the shortcuts page show. It is derived from shortcutBindings in
// shortcuts.go — the table the window dispatches — plus the keys this build
// installs in the composer, the pending cards and the application menu, which
// externalShortcuts names. Nothing here is written by hand, so a row cannot
// outlive the handler it describes, and a key with no handler has no row.
var settingsShortcutRows = shortcutReferenceRows()

// settingsReadOnlyBlock is the shape the reference sections share: a heading
// with an explanatory line, then values this launch read from the Host or from
// its own state. Nothing here writes anything.
func (a *app) settingsReadOnlyBlock(c *ui.Context, key, title, description string, rows [][2]string) {
	ui.Column(c.Key("settings-reference-"+key)).Padding(20, 0, 16).Gap(10).BorderWidth(0, 0, 1, 0).BorderColor(a.theme.Border).Children(func() {
		ui.Text(c, title).FontSize(14)
		if description != "" {
			ui.Text(c, description).FontSize(12).TextColor(a.theme.TextMuted).Wrap()
		}
		for _, row := range rows {
			ui.Row(c).Gap(12).AlignItems(ui.Start).Children(func() {
				ui.Text(c, row[0]).FontSize(12).TextColor(a.theme.TextMuted).Width(132).Shrink(0).Wrap()
				ui.Text(c, row[1]).FontSize(12).Grow(1).MinWidth(0).Wrap().Selectable()
			})
		}
	})
}

// settingsOperationState reads one operation's availability from the Host's
// own access snapshot. It deliberately does not use can(), whose busy flag
// would make a static reference line flicker during a running turn.
func (a *app) settingsOperationState(name string) string {
	if a.demo {
		return "不可用：演示数据没有主机连接"
	}
	capability, known := a.operationCaps[name]
	if known && capability.Supported {
		return "可用"
	}
	if known && capability.Reason != "" {
		return "不可用：" + capability.Reason
	}
	if known {
		return "不可用：主机未授权"
	}
	return "不可用：当前连接未开放此操作"
}

func (a *app) settingsSectionHostState(host *settingsHostState) string {
	switch {
	case a.demo:
		return "演示数据"
	case host == nil || !host.Started:
		return "尚未读取主机设置"
	case host.Loading:
		return "正在读取主机设置…"
	case host.Unknown:
		return "上次写入未确认，请刷新核对"
	case !host.Ready:
		return "读取失败"
	case !host.Writable:
		return "只读（主机未授予设置写入）"
	default:
		return "可写"
	}
}

func hostNamespaceBool(host *settingsHostState, namespace, key string) (bool, bool) {
	if host == nil {
		return false, false
	}
	ns, served := host.Namespaces[namespace]
	if !served {
		return false, false
	}
	var value bool
	if len(ns.Value[key]) == 0 || json.Unmarshal(ns.Value[key], &value) != nil {
		return false, false
	}
	return value, true
}

// securityPrivacySection reports the effective permission and privacy facts the
// Host serves, so the user can read them without changing anything.
func (a *app) securityPrivacySection(c *ui.Context, host *settingsHostState) {
	permission := "不可用"
	options := "不可用"
	if host != nil && host.Ready {
		current := host.DefaultPreset
		if ns, served := host.Namespaces["permission"]; served {
			_ = json.Unmarshal(ns.Value["defaultPreset"], &current)
		}
		for _, option := range host.DefaultOptions {
			if option.Value == current {
				permission = permissionSettingLabel(option.Value, option.Name)
				break
			}
		}
		var labels []string
		for _, option := range host.DefaultOptions {
			labels = append(labels, permissionSettingLabel(option.Value, option.Name))
		}
		if len(labels) > 0 {
			options = strings.Join(labels, "、")
		}
	}
	upload := "主机未提供"
	if enabled, served := hostNamespaceBool(host, "session-log-deepseek", "enabled"); served {
		upload = map[bool]string{true: "开启", false: "关闭"}[enabled]
	}
	configPath := preferencePath()
	if configPath == "" {
		configPath = "当前启动无法定位"
	}
	a.settingsReadOnlyBlock(c, "security", "安全与隐私",
		"以下状态读取自主机设置与本次连接，只作展示；修改请使用上方的权限与开关。", [][2]string{
			{"主机设置状态", a.settingsSectionHostState(host)},
			{"默认权限", permission},
			{"权限可选值", options},
			{"会话日志上传", upload},
			{"本地配置文件", configPath},
		})
}

// fileSearchSection reports the Host's file and search capability state with
// the Host's own refusal reason where a capability is unavailable.
func (a *app) fileSearchSection(c *ui.Context) {
	a.settingsReadOnlyBlock(c, "files", "文件与搜索",
		"这些能力由主机授予本次连接；不可用的项在右栏同样不会出现可点的入口。", [][2]string{
			{"工作区目录浏览", a.settingsOperationState("listFiles")},
			{"工作区文件读取", a.settingsOperationState("readFile")},
			{"主机文件搜索", a.settingsOperationState("searchWorkspaceFiles")},
			{"网页搜索提供方", a.settingsOperationState("listWebProviders")},
			{"上传到工作区", a.settingsOperationState("uploadWorkspaceFile")},
		})
}

// notificationsSection reports the notification facts this build can state
// truthfully: the Host's notification namespaces, which are read from the
// Host, and the absence of a system-notification sender in this client.
func (a *app) notificationsSection(c *ui.Context, host *settingsHostState) {
	var served []string
	if host != nil {
		for _, name := range host.Served {
			lower := strings.ToLower(name)
			if strings.Contains(lower, "notif") || strings.Contains(lower, "notify") {
				served = append(served, name)
			}
		}
	}
	hostNotifications := "主机未提供通知设置"
	if len(served) > 0 {
		hostNotifications = strings.Join(served, "、")
	} else if host != nil && !host.Ready && host.Started {
		hostNotifications = "尚未读取主机设置"
	}
	a.settingsReadOnlyBlock(c, "notifications", "通知",
		"通知内容由会话与主机产生；本构建不发送系统通知，状态在应用内显示。", [][2]string{
			{"主机通知设置", hostNotifications},
			{"系统通知", "未启用：本构建未接入系统通知"},
			{"应用内提示", "右下角提示条与会话头状态；关闭后不再重复"},
		})
}

// shortcutsReferenceSection is the read-only shortcut list inside General; the
// shortcuts page renders the same table with room for its own header.
func (a *app) shortcutsReferenceSection(c *ui.Context) {
	a.settingsReadOnlyBlock(c, "shortcuts", "快捷键",
		"只列当前构建真正生效的按键；完整列表见「快捷键」。", settingsShortcutRows)
}

func (a *app) settingsShortcuts(c *ui.Context) {
	ui.Column(c).Padding(20, 0).Gap(10).Children(func() {
		if ui.Button(c, "返回通用设置").Clicked() {
			a.settingsSection = "general"
		}
		ui.Text(c, "快捷键").FontSize(16).FontWeight(500)
		ui.Text(c, "只列出当前原生界面已经接线的按键；未接入的快捷键不会出现在这里。").TextColor(a.theme.TextMuted).Wrap()
		for _, row := range settingsShortcutRows {
			ui.Row(c).Gap(12).AlignItems(ui.Start).Children(func() {
				ui.Text(c, row[0]).FontSize(13).Width(168).Shrink(0).Selectable()
				ui.Text(c, row[1]).FontSize(13).Grow(1).MinWidth(0).Wrap().TextColor(a.theme.TextMuted)
			})
		}
	})
}
