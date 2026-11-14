package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

var compatNotifications = mygo.NewEvent[bridge.Notification]("notification")

// The bundled presentation page receives only this allowlisted low-frequency
// surface. The untrusted Remote Web view never receives these methods.
type CompatAPI struct{ a *app }

func (api *CompatAPI) ResizeModelMenu(ctx context.Context, width, height float32) error {
	if err := api.caller(ctx); err != nil {
		return err
	}
	page := mygo.CallerPage(ctx)
	mygo.RunOnMain(func() {
		a := api.a
		if a.compat == nil || a.compat.Page() != page || a.compatPlacement != "modelPopover" {
			return
		}
		a.modelMenuWidth = min(max(width, 240), 420)
		a.modelMenuHeight = min(max(height, 40), 360)
		a.win.Invalidate()
	})
	return nil
}

func (api *CompatAPI) Close(ctx context.Context) error         { return api.finishPage(ctx, false) }
func (api *CompatAPI) ReportFailure(ctx context.Context) error { return api.finishPage(ctx, true) }
func (api *CompatAPI) finishPage(ctx context.Context, failed bool) error {
	if err := api.caller(ctx); err != nil {
		return err
	}
	page := mygo.CallerPage(ctx)
	owner := ""
	mygo.RunOnMain(func() {
		if api.a.compat != nil && api.a.compat.Page() == page {
			owner = api.a.compatOwner
		}
	})
	mygo.RunOnMain(func() {
		a := api.a
		if owner == "" || a.compatOwner != owner || a.compat == nil || a.compat.Page() != page {
			return
		}
		if failed {
			a.error = "兼容页面出现错误，请重新打开。"
		}
		if !failed && a.compatPlacement == "settingsContent" {
			a.closeSettings()
		} else {
			a.closeCompat()
		}
		a.win.Invalidate()
	})
	return nil
}

var compatMethods = map[string]bool{
	"capabilities": true, "modelCatalog": true, "selectModel": true, "sessionProjections": true,
	"describeSettings": true, "updateSettings": true, "replaceSettings": true, "mutateSettings": true,
	"listPlugins": true, "listBundles": true, "listPluginVersions": true, "readBundleDetail": true,
	"pluginInventory":  true,
	"setPluginEnabled": true, "setBundleEnabled": true, "updateBundle": true,
	"describeCredentials": true, "setCredential": true,
	"unsetCredential":  true,
	"listAgentPresets": true, "readAgentPreset": true, "selectAgentPreset": true,
	"listProviders": true, "listConfigurableProviders": true, "discoverModels": true,
	"scheduleCatalog": true, "scheduleDeliveryLimits": true, "listSchedules": true, "scheduleHistory": true,
	"editSchedule": true, "runSchedule": true, "deleteInactiveSchedules": true,
	"presentation": true, "history": true, "watchToolResult": true, "closeStream": true, "readAttachment": true,
	"watchSession": true, "sessionPage": true,
	"listTerminals": true, "terminalEnvironment": true, "terminalShells": true, "createTerminal": true, "renameTerminal": true, "closeTerminal": true, "writeTerminal": true, "resizeTerminal": true, "watchTerminals": true, "retainTerminal": true, "watchTerminal": true,
}

func (api *CompatAPI) caller(ctx context.Context) error {
	var allowed bool
	mygo.RunOnMain(func() { allowed = api.a.compat != nil && mygo.CallerPage(ctx) == api.a.compat.Page() })
	if !allowed {
		return compatRejectedError("此接口仅供本地兼容页面使用")
	}
	p := mygo.CallerPage(ctx)
	u, err := url.Parse(p.URL())
	if err != nil || u.Scheme != "mygo" || u.Host != "localhost" {
		return compatRejectedError("外部网页无法访问客户端连接")
	}
	return nil
}
func (api *CompatAPI) GetContext(ctx context.Context) (map[string]any, error) {
	if err := api.caller(ctx); err != nil {
		return nil, err
	}
	var result map[string]any
	page := mygo.CallerPage(ctx)
	mygo.RunOnMain(func() {
		a := api.a
		if a.compat == nil || a.compat.Page() != page || a.compatHost != a.hostID || a.compatGeneration != a.remoteGeneration {
			return
		}
		ops := map[string]bool{}
		for name, value := range a.operationCaps {
			ops[name] = value.Supported
		}
		ops["clientOpenSession"] = a.connected
		// The original creator starts/reuses a blank session. Until that
		// client navigation flow is connected, do not append to active work.
		ops["clientStartDraft"] = false
		ops["clientStartCreatorDraft"] = false
		theme := "light"
		if a.theme.Dark {
			theme = "dark"
		}
		result = map[string]any{"hostId": a.hostID, "workspaceId": a.workspaceID, "sessionId": a.sessionID, "connectionGeneration": a.compatGeneration, "ownerId": a.compatOwner, "theme": theme, "language": "zh", "fontSize": a.uiPrefs.FontSize, "terminalFontSize": a.uiPrefs.TerminalFontSize, "terminalFontFamily": a.uiPrefs.TerminalFontFamily, "operations": ops}
		width := float32(a.win.ContentBounds().Width)
		result["windowWidth"] = width
		result["globalPageInset"] = min(float32(48), max(float32(24), width*.04))
		result["fontFamily"] = a.uiPrefs.TextFontFamily
		result["codeFontSize"] = a.uiPrefs.CodeFontSize
		result["codeFontFamily"] = a.uiPrefs.CodeFontFamily
		result["rpcVersion"] = 2
		result["placement"] = a.compatPlacement
		result["sessions"] = append([]session(nil), a.sessions...)
		result["workspaces"] = append([]workspace(nil), a.workspaces...)
		if a.compatPlacement == "imagePreview" {
			result["imagePreview"] = map[string]any{"attachments": a.imagePreviewAttachments, "selectedIndex": a.imagePreviewIndex}
		}
	})
	if result == nil {
		return nil, compatRejectedError("主机或页面已切换，请重新打开页面")
	}
	return result, nil
}
func (api *CompatAPI) Request(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error) {
	if err := api.caller(ctx); err != nil {
		return nil, err
	}
	if !compatMethods[method] {
		return nil, compatRejectedError(fmt.Sprintf("本地兼容页面未开放此操作：%s", method))
	}
	var p map[string]any
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	if err := json.Unmarshal(params, &p); err != nil || p == nil {
		return nil, compatRejectedError("操作参数必须为对象")
	}
	if method == "readAttachment" {
		raw, _ := json.Marshal(p["attachment"])
		var ref imageAttachment
		if json.Unmarshal(raw, &ref) != nil || !validImageReference(ref) {
			return nil, compatRejectedError("图片引用无效")
		}
		if ref.Bytes > 8*1024*1024 {
			return nil, compatRejectedError("图片超过当前客户端读取上限，分块读取尚未接入。")
		}
	}
	var client *bridge.Client
	var scope map[string]any
	var validation error
	page := mygo.CallerPage(ctx)
	mygo.RunOnMain(func() {
		a := api.a
		if a.compat == nil || a.compat.Page() != page {
			validation = compatRejectedError("页面已关闭，请重新打开页面")
			return
		}
		client = a.client
		scope = map[string]any{"hostId": a.compatHost, "generation": a.compatGeneration, "ownerId": a.compatOwner}
		if a.compatSession != "" {
			scope["sessionId"] = a.compatSession
		}
		if a.compatHost != a.hostID || a.compatSession != a.sessionID {
			validation = compatRejectedError("主机或会话已切换，请重新打开页面")
			return
		}
		if !a.connected || client == nil {
			validation = compatRejectedError("Remote 未连接")
			return
		}
		if sid, ok := p["sessionId"].(string); ok && sid != a.sessionID {
			validation = compatRejectedError("会话已切换，请重新打开页面")
			return
		}
		if wid, ok := p["workspaceId"].(string); ok && wid != a.workspaceID {
			validation = compatRejectedError("工作区已切换，请重新打开页面")
			return
		}
		if method != "capabilities" && method != "presentation" && method != "history" && method != "closeStream" && !a.operationCaps[method].Supported {
			validation = compatRejectedError("当前主机未授权此操作")
		}
	})
	if validation != nil {
		return nil, validation
	}
	p["clientScope"] = scope
	bounded, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	raw, err := client.Call(bounded, method, p)
	if err != nil {
		return nil, err
	}
	switch method {
	case "selectModel", "selectAgentPreset", "updateSettings", "replaceSettings", "mutateSettings", "setPluginEnabled", "setBundleEnabled", "updateBundle", "setCredential", "unsetCredential", "editSchedule", "runSchedule", "deleteInactiveSchedules", "createTerminal", "renameTerminal", "closeTerminal", "writeTerminal", "resizeTerminal":
		var receipt struct {
			Status     string
			HostID     string `json:"hostId"`
			Generation uint64 `json:"connectionGeneration"`
		}
		if json.Unmarshal(raw, &receipt) != nil || receipt.Status == "accepted" && (receipt.HostID != scope["hostId"] || receipt.Generation != scope["generation"]) {
			return nil, errors.New("保存结果未确认，请刷新核对；不会自动重发")
		}
	}
	return raw, nil
}
func compatPath() string {
	if bin, err := os.Executable(); err == nil {
		for _, path := range []string{filepath.Join(filepath.Dir(bin), "..", "Resources", "compat"), filepath.Join(filepath.Dir(bin), "..", "compat", "dist")} {
			if _, err := os.Stat(filepath.Join(path, "index.html")); err == nil {
				return filepath.Clean(path)
			}
		}
	}
	path, _ := filepath.Abs("compat/dist")
	return path
}
func newPageOwner() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func (a *app) releaseCompatOwner(owner string) {
	releaseRemoteOwner(a.client, owner)
}
func releaseRemoteOwner(client *bridge.Client, owner string) {
	if owner == "" || client == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = client.Call(ctx, "closeOwnerStreams", map[string]any{"ownerId": owner})
	}()
}
func (a *app) openCompat(page string) {
	a.openCompatAt(page, "main")
}
func (a *app) openCompatAt(page, placement string) {
	a.closeWeb()
	if !a.connected {
		a.connectionOpen = true
		a.error = "请先连接远程主机。"
		return
	}
	switch page {
	case "plugins", "plugin-settings", "models", "model-menu", "trajectory", "terminal", "automation", "agent-presets", "model-settings", "image-preview":
	default:
		return
	}
	path := compatPath()
	if _, err := os.Stat(filepath.Join(path, "index.html")); err != nil {
		a.error = "本地兼容页面未打包，请重新构建客户端。"
		return
	}
	if placement == "main" {
		a.beginMainNavigation()
	}
	a.closeCompat()
	a.compatPlacement = placement
	if placement == "modelPopover" {
		a.modelPopoverOpen = true
	}
	owner := newPageOwner()
	host, session, generation := a.hostID, a.sessionID, a.remoteGeneration
	scope := a.operationScope()
	a.compatPendingOwner = owner
	a.requestWithFailure("registerOwner", map[string]any{"ownerId": owner, "clientScope": scope}, func(raw json.RawMessage) error {
		if a.compatPendingOwner != owner || a.hostID != host || a.sessionID != session || a.remoteGeneration != generation {
			a.releaseCompatOwner(owner)
			return nil
		}
		var receipt struct {
			Registered bool
			OwnerID    string
		}
		if json.Unmarshal(raw, &receipt) != nil || !receipt.Registered || receipt.OwnerID != owner {
			a.compatPendingOwner = ""
			a.releaseCompatOwner(owner)
			return errors.New("本地兼容页面登记失败")
		}
		mygo.SetFrontend(os.DirFS(path))
		v, err := a.win.NewWebView(mygo.WebViewOptions{URL: "/?page=" + page, Page: mygo.PageOptions{TrustedOrigins: []string{"mygo://localhost"}}, BackgroundColor: "#151517"})
		if err != nil {
			a.compatPendingOwner = ""
			a.releaseCompatOwner(owner)
			return err
		}
		a.compat = v
		a.compatPlacement = placement
		a.compatPage = page
		a.compatOwner = owner
		a.compatPendingOwner = ""
		a.compatHost = host
		a.compatSession = session
		a.compatGeneration = generation
		v.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			u, err := url.Parse(e.URL)
			if err != nil || u.Scheme != "mygo" || u.Host != "localhost" {
				e.PreventDefault()
			}
		})
		v.Page().OnDidFailLoad(func(e *mygo.LoadError) {
			if a.compatOwner == owner {
				a.error = "兼容页面加载失败，请重新打开。"
				a.closeCompat()
				a.win.Invalidate()
			}
		})
		v.Page().OnRenderProcessGone(func(reason string) {
			if a.compatOwner == owner {
				a.error = "兼容页面已停止，请重新打开。"
				a.closeCompat()
				a.win.Invalidate()
			}
		})
		return nil
	}, func(err error) {
		if a.compatPendingOwner == owner {
			a.compatPendingOwner = ""
		}
		a.releaseCompatOwner(owner)
	})
}
func (a *app) compatView(c *ui.Context) {
	if a.compatPlacement == "main" {
		ui.Box(c).Height(48).Shrink(0).DragWindow()
	}
	if a.compatPlacement != "main" {
		ui.Row(c).Shrink(0).Padding(8, 20).Gap(10).Children(func() {
			title := "插件"
			if a.compatPage == "models" {
				title = "模型"
			}
			ui.Text(c, title).FontSize(13).Grow(1)
			if ui.Button(c, "关闭").Clicked() {
				a.closeCompat()
			}
		})
	}
	if a.compat != nil {
		ui.WebView(c, a.compat).Grow(1).MinHeight(0)
	}
}
func (a *app) closeCompat() {
	reload := a.compatPage == "models" || a.compatPage == "model-menu"
	owner, pending := a.compatOwner, a.compatPendingOwner
	a.compatOwner = ""
	a.compatPendingOwner = ""
	a.compatPage = ""
	a.compatPlacement = ""
	a.modelPopoverOpen = false
	a.imagePreviewAttachments = nil
	a.releaseCompatOwner(owner)
	if pending != "" && pending != owner {
		a.releaseCompatOwner(pending)
	}
	if a.compat != nil {
		v := a.compat
		a.compat = nil
		if a.testDestroyCompat != nil {
			a.testDestroyCompat(v)
		} else {
			v.Destroy()
		}
	}
	if reload && a.connected && a.sessionID != "" {
		a.reloadComposer()
	}
}
