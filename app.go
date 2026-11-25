package main

import (
	"context"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"native-dsh/desktop/internal/bridge"
	"time"
)

type app struct {
	markdownCopy                                             *sessionMarkdownCopy
	testMarkdownClipboard                                    func(string) error
	testChatPartBuild                                        func(string, string)
	messageImages                                            *historyImageCache
	imagePreviewAttachments                                  []imageAttachment
	imagePreviewIndex                                        int
	compatRouteCache                                         map[string]bool
	chatRowsCache                                            *chatRowsCache
	chatPresentationIndex                                    *chatPresentationIndex
	turnProcessChoices                                       map[string]bool
	chatStructureRevision                                    uint64
	composerDrafts                                           map[string]*composerDraftState
	composerBaselineKey                                      string
	sidebarLayoutWidth                                       float32
	revealedSession                                          string
	draftAttempted                                           bool
	scheduleCounts                                           map[string]int
	schedules                                                []scheduleRecord
	savedFiles                                               map[string]string
	presentedFiles                                           map[int][]presentedFile
	sessionPreviews                                          map[string]string
	sessionPreviewLoading                                    map[string]bool
	scheduleDetail                                           *scheduleRecord
	scheduleDetailOpen                                       bool
	modelMenuWidth, modelMenuHeight                          float32
	sendIntents                                              map[string]*sendIntent
	accountScope, authServer, restoreAttempted               string
	savedSelections                                          map[string]savedSelection
	restoreTarget                                            *savedSelection
	composer                                                 *composerState
	sidebarShown                                             float32
	modelPopoverOpen                                         bool
	compatPlacement                                          string
	fontCalibration                                          bool
	compatOwner, compatPendingOwner                          string
	mutationReview, mutationAcknowledge                      bool
	testDispatch                                             func(func())
	testDestroyCompat                                        func(*mygo.WebView)
	remoteGeneration                                         uint64
	compatGeneration                                         uint64
	qaListClip                                               bool
	renameHost                                               string
	renameScope                                              string
	mutations                                                map[string]*mutationIntent
	uiPrefs                                                  viewPreferences
	colors                                                   palette
	effectiveDark                                            bool
	settingsOpen                                             bool
	fontSettingsOpen                                         bool
	settingsSection                                          string
	settingsPageRequested                                    string
	searchOpen                                               bool
	viewMenu                                                 bool
	watermarks                                               map[string]int
	flowOpen                                                 map[string]*bool
	flowDefaults                                             map[string]bool
	currentTab                                               string
	copyNotice                                               string
	focusDraft                                               bool
	operationCaps                                            map[string]operationCapability
	contentFontSize                                          float32
	appearanceSignature                                      string
	connected                                                bool
	drafts                                                   map[string]string
	scrolls                                                  map[string]ui.ListState
	renameID, renameTitle                                    string
	trajectorySearch                                         string
	trajectoryList                                           ui.ListState
	rightPane                                                *rightPaneState
	rightPaneOpen                                            bool
	navigationGeneration                                     uint64
	messageIndex                                             map[string]int
	reasoningOpen                                            map[string]*bool
	win                                                      *mygo.Window
	client                                                   *bridge.Client
	ctx                                                      context.Context
	cancel                                                   context.CancelFunc
	theme                                                    *ui.Theme
	localRuntime                                             *localRuntime
	epoch                                                    time.Time
	runningSince                                             time.Time
	historyLoading                                           bool
	historyError                                             string
	feedbackOpen                                             bool
	feedbackRating, feedbackMessage, feedbackNote            string
	subagentTitles                                           map[string]string
	heroPresets                                              []heroPresetEntry
	heroPresetStaged                                         string
	heroPresetsHost                                          string
	heroPresetsGen                                           uint64
	heroPresetsAsked, heroPresetsLoading, heroPresetsLoaded  bool
	demo                                                     bool
	connectionOpen                                           bool
	status, detail, error                                    string
	busy                                                     bool
	devices                                                  []device
	workspaces                                               []workspace
	sessions                                                 []session
	current                                                  snapshot
	hostID, workspaceID, sessionID                           string
	sessionOpening                                           string
	draft, search, account, password, server, questionAnswer string
	list, sessionList                                        ui.ListState
	md                                                       markdown.Options
	mdCompact                                                markdown.Options
	mdCell                                                   markdown.Options
	web                                                      *mygo.WebView
	webPlacement, webTarget                                  string
	compat                                                   *mygo.WebView
	compatPage                                               string
	compatHost, compatSession                                string
	webURL                                                   string
	sidebar                                                  bool
	builds                                                   uint64
	metrics                                                  renderStats
	answers                                                  map[string]map[string]*questionDraft
	pendingRequests                                          int
	workspaceCreate                                          *workspaceCreateState
	scopeCache                                               *scopeAnswers
	configuredServer                                         string
	authorized                                               bool
	pendingSend                                              *sendIntent
	// searchPick is the session the search keyboard chose, by ID so it
	// survives the hits changing as the query is typed; searchRow is that
	// session's row in the sidebar list, -1 for none, which is also the
	// list's Selected while a search is open (see searchView).
	searchPick string
	searchRow  int

	// titleSeq fences the title projection per Session so a late read cannot
	// restore an older name over a newer one.
	titleSeq map[string]int64
}

func newApp(demo bool) *app {
	ctx, cancel := context.WithCancel(context.Background())
	t := ui.LightTheme()
	t.Background = ui.Hex("#ffffff")
	t.Text = ui.Hex("#141518")
	t.TextMuted = ui.Hex("#878a90")
	t.Accent = ui.Hex("#477be2")
	t.AccentHover = ui.Hex("#386ed2")
	t.Radius = 10
	t.FontSize = 14
	t.Font = "system-ui, PingFang SC"
	a := &app{ctx: ctx, cancel: cancel, theme: t, epoch: time.Now(), demo: demo, status: "尚未连接", sidebar: true, server: "https://dsh.rkbkosp.cn", webURL: "https://dsh.rkbkosp.cn/app", uiPrefs: defaultViewPreferences(), watermarks: map[string]int{}, flowOpen: map[string]*bool{}, currentTab: "chat", settingsSection: "general", subagentTitles: map[string]string{}}
	a.loadPreferences()
	a.md.Reveal = &markdown.Reveal{Unit: markdown.AtOnce, Fade: -1}
	a.md.Block = a.markdownBlock
	a.md.OnLink = a.openMarkdownLink
	a.md.CodeBlock = a.markdownCodeBlock
	a.md.WrapCode = true
	a.list.FollowEnd = true
	if demo {
		a.workspaces, a.sessions, a.current = demoData()
		a.workspaceID = "demo-workspace"
		a.sessionID = "demo-current"
		a.status = "本地界面回放"
	}
	return a
}

func (a *app) update(fn func()) {
	if a.testDispatch != nil {
		a.testDispatch(fn)
		return
	}
	if a.win != nil {
		a.win.Update(fn)
	}
}

func (a *app) view(c *ui.Context) {
	a.markdownCopyLifecycle(c)
	a.builds++
	a.metrics.Builds++
	a.applyAppearance(c)
	// The local web workspace replaces the whole window; the native local mode
	// only owns the Host, so the normal native surfaces stay in place.
	if a.localRuntime != nil && !a.localRuntime.native {
		a.localView(c)
		return
	}
	if a.fontCalibration {
		a.fontCalibrationView(c)
		return
	}
	// Every window shortcut is one row of shortcuts.go: the dispatcher reads
	// the key and the command from the same table the settings reference shows.
	a.dispatchShortcuts(c)
	c.Root().FontWeight(300)
	if c.Vibrancy() {
		c.Root().Background(ui.Transparent)
	}
	root := ui.Row(c).Fill().FontWeight(300).AlignItems(ui.Stretch)
	target := float32(0)
	if a.sidebar {
		target = 1
	}
	a.sidebarShown = root.AnimateTo("sidebar", target, ui.Animation{Duration: 300 * time.Millisecond, Ease: ui.EaseInOut})
	root.Children(func() {
		if a.sidebarShown > 0 {
			a.sidebarFrame(c, a.sidebarShown)
		}
		ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Background(a.theme.Background).Children(func() {
			if a.compat == nil || a.compatPlacement != "main" {
				a.header(c)
			}
			if a.demo {
				ui.Text(c, "本地界面回放 · 未连接真实主机").FontSize(11).TextColor(ui.Hex("#9a6d1d")).Background(ui.Hex("#fff8e8")).Padding(5, 24).FillWidth()
			}
			if a.error != "" {
				ui.Row(c).Padding(8, 24).Background(a.colors.Subtle).Children(func() {
					ui.Text(c, a.error).Grow(1).Wrap().TextColor(a.theme.Danger)
					if ui.ButtonBase(c).Label("关闭错误").Padding(4).Children(func() { ui.Text(c, "×") }).Clicked() {
						a.error = ""
					}
				})
			}
			ui.Column(c).Grow(1).MinWidth(0).MinHeight(0).Children(func() {
				if a.compat != nil && a.compatPlacement == "main" {
					a.compatView(c)
				} else if a.web != nil && a.webPlacement != "right" {
					a.webView(c)
				} else if a.connectionOpen {
					a.connectionView(c)
				} else {
					a.conversation(c)
				}
			})
		})
		if a.rightPaneOpen && (a.web == nil || a.webPlacement == "right") && (a.compat == nil || a.compatPlacement != "main") {
			width, _ := c.Size()
			ui.Column(c).Width(min(576, width*.45)).Shrink(0).MinHeight(0).FillHeight().Background(a.theme.Background).BorderWidth(0, 0, 0, .5).BorderColor(a.theme.Border).Children(func() {
				if a.web != nil && a.webPlacement == "right" {
					a.browserPaneView(c)
				} else if a.compat != nil && a.compatPlacement == "right" {
					ui.Row(c).Height(48).Shrink(0).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
						if ui.ButtonBase(c).Label("右侧栏开始页").Children(func() { icon(c, "browse-outline", 16); ui.Text(c, "开始").FontSize(14) }).Clicked() {
							a.closeCompat()
						}
						ui.Text(c, "/ 终端").FontSize(13).TextColor(a.theme.TextMuted)
						ui.Spacer(c)
						if ui.ButtonBase(c).Size(24, 24).Label("收起右侧边栏").Children(func() { icon(c, "panel-left-outline", 16) }).Clicked() {
							a.closeCompat()
							a.rightPaneOpen = false
						}
					})
					ui.WebView(c.Key("right-compat-"+a.compatOwner), a.compat).Grow(1).MinHeight(0).MinWidth(0)
				} else {
					a.rightPaneView(c)
				}
			})
		}
	})
	if !a.sidebar {
		a.captionControls(c)
	}
	if a.settingsOpen {
		a.settingsView(c)
	}
	a.mutationReviewView(c)
	a.scheduleDetailView(c)
	a.workspaceCreateView(c)
	if a.compat != nil && a.compatPlacement == "imagePreview" {
		a.imagePreviewView(c)
	}
}
