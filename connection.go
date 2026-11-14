package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"strings"
	"time"
)

func (a *app) request(method string, params any, accept func(json.RawMessage) error) {
	a.requestWithFailure(method, params, accept, nil)
}
func (a *app) requestWithFailure(method string, params any, accept func(json.RawMessage) error, failed func(error)) {
	if a.demo {
		a.error = "当前是本地界面回放。请以正常模式连接 Remote 后操作。"
		return
	}
	if a.client == nil {
		a.error = "Remote 通信模块尚未就绪。"
		return
	}
	a.pendingRequests++
	a.busy = true
	a.error = ""
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
		defer cancel()
		raw, err := a.client.Call(ctx, method, params)
		a.update(func() {
			a.pendingRequests--
			a.busy = a.pendingRequests > 0
			if err != nil {
				a.error = err.Error()
				if failed != nil {
					failed(err)
				}
				return
			}
			if accept != nil {
				if err = accept(raw); err != nil {
					a.error = err.Error()
				}
			}
		})
	}()
}

func (a *app) startBridge(command string, args []string) {
	client, err := bridge.Start(a.ctx, command, args...)
	if err != nil {
		a.error = "Remote 通信模块启动失败：" + err.Error()
		return
	}
	a.client = client
	a.configure(func() {
		if a.authorized {
			a.fetchDevices()
		} else {
			a.request("status", map[string]any{}, a.acceptStatus)
		}
	})
	go func() {
		for event := range client.Events {
			ev := event
			a.update(func() { a.notification(ev) })
		}
		if a.ctx.Err() == nil {
			a.update(func() {
				a.status = "Remote 通信已断开"
				a.error = "客户端通信模块已退出，请重新启动客户端。"
			})
		}
	}()
}

func (a *app) acceptStatus(raw json.RawMessage) error {
	var s struct {
		Connected            bool   `json:"connected"`
		Detail               string `json:"detail"`
		HostID               string `json:"hostId"`
		State                string `json:"state"`
		Authorized           bool   `json:"authorized"`
		ConnectionGeneration uint64 `json:"connectionGeneration"`
		IdentityScope        string `json:"identityScope"`
		AccountScope         string `json:"accountScope"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return err
	}
	a.detail = s.Detail
	scope := s.IdentityScope
	if scope == "" {
		scope = s.AccountScope
	}
	a.adoptAccountScope(scope)
	a.connected = s.Connected
	a.remoteGeneration = s.ConnectionGeneration
	a.authorized = s.Authorized
	if s.Connected {
		a.status = "Remote 已连接"
		a.hostID = s.HostID
	} else if s.Authorized {
		a.status = "已登录，选择工作主机"
	} else {
		a.status = "尚未登录"
	}
	return nil
}

func (a *app) notification(ev bridge.Notification) {
	if a.compat != nil && ev.Method == "status" {
		_ = compatNotifications.EmitPage(a.compat.Page(), ev)
	}
	if a.compat != nil && (ev.Method == "remoteStream" || ev.Method == "remoteStreamEnd") {
		var owner struct {
			OwnerID string `json:"ownerId"`
		}
		if json.Unmarshal(ev.Params, &owner) == nil && owner.OwnerID == a.compatOwner {
			_ = compatNotifications.EmitPage(a.compat.Page(), ev)
		}
	}
	switch ev.Method {
	case "sessionProjections":
		var p struct {
			SessionID   string          `json:"sessionId"`
			Projections json.RawMessage `json:"projections"`
		}
		if json.Unmarshal(ev.Params, &p) == nil && p.SessionID == a.sessionID {
			a.current.Projections = p.Projections
			_ = a.acceptComposerProjections(p.Projections)
		}
	case "status":
		_ = a.acceptStatus(ev.Params)
	case "sessions":
		if rows, err := decodeRows[session](ev.Params, "sessions", "items"); err == nil {
			a.sessions = rows
		}
	case "snapshot":
		var s snapshot
		if err := json.Unmarshal(ev.Params, &s); err != nil {
			a.error = "远程会话数据无效，请重新打开会话。"
		} else if a.sessionID == "" || s.SessionID == a.sessionID {
			a.replaceSnapshot(s)
			if a.connected && s.SessionID != "" && a.composerBaselineKey != a.currentComposerBaselineKey() {
				a.composerBaselineKey = a.currentComposerBaselineKey()
				a.reloadComposer()
			}
		}
	case "messageUpsert", "messageRemove", "messageDelta", "sessionState", "pending", "trajectoryUpsert", "trajectoryRemove":
		if err := a.applyIncremental(ev.Method, ev.Params); err != nil {
			a.error = err.Error()
		}
	case "error":
		var e struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(ev.Params, &e) == nil {
			a.error = e.Message
		}
	}
}

func (a *app) fetchDevices() {
	if !a.authorized {
		a.connectionOpen = true
		a.status = "尚未登录"
		a.detail = "请先登录 Remote，再选择工作主机。"
		a.error = ""
		return
	}
	a.request("devices", map[string]any{}, func(raw json.RawMessage) error {
		rows, err := decodeRows[device](raw, "devices", "items")
		a.devices = rows
		if err == nil {
			a.maybeRestoreConnection()
		}
		return err
	})
}

func (a *app) connect(id string) {
	a.restoreTarget = nil
	a.closeCompat()
	a.closeWeb()
	if a.drafts == nil {
		a.drafts = map[string]string{}
	}
	if a.scrolls == nil {
		a.scrolls = map[string]ui.ListState{}
	}
	a.drafts[a.viewKey(a.sessionID)] = a.draft
	a.scrolls[a.viewKey(a.sessionID)] = a.list
	a.navigationGeneration++
	generation := a.navigationGeneration
	a.hostID = id
	a.sessionID = ""
	a.workspaceID = ""
	a.draft = ""
	a.current = snapshot{}
	a.composer = nil
	a.sessions = nil
	a.workspaces = nil
	a.operationCaps = nil
	a.renameID = ""
	a.renameHost = ""
	a.connected = false
	a.request("connect", map[string]any{"hostId": id}, func(raw json.RawMessage) error {
		if generation != a.navigationGeneration || a.hostID != id {
			return nil
		}
		if err := a.acceptStatus(raw); err != nil {
			return err
		}
		a.connected = true
		a.status = "Remote 已连接"
		if a.restoreTarget == nil {
			a.rememberSelection()
		}
		a.fetchCapabilities()
		a.fetchWorkspaces()
		return nil
	})
}

func (a *app) fetchWorkspaces() {
	host := a.hostID
	a.request("workspaces", map[string]any{"hostId": a.hostID}, func(raw json.RawMessage) error {
		if host != a.hostID {
			return nil
		}
		rows, err := decodeRows[workspace](raw, "workspaces", "items")
		a.workspaces = rows
		if err == nil {
			a.fetchSessions()
		}
		return err
	})
}

func (a *app) selectWorkspace(id string) {
	a.workspaceID = id
	a.request("selectWorkspace", map[string]any{"workspaceId": id}, func(raw json.RawMessage) error {
		a.fetchSessions()
		return nil
	})
}
func (a *app) fetchSessions() {
	host := a.hostID
	a.request("sessions", map[string]any{"all": true}, func(raw json.RawMessage) error {
		if host != a.hostID {
			return nil
		}
		rows, err := decodeRows[session](raw, "sessions", "items")
		if err == nil {
			a.sessions = rows
			a.finishRestore()
		}
		return err
	})
}
func (a *app) chooseSession(s session) {
	a.closeCompat()
	a.closeWeb()
	if a.demo {
		a.sessionID = s.ID
		return
	}
	if a.drafts == nil {
		a.drafts = map[string]string{}
	}
	if a.scrolls == nil {
		a.scrolls = map[string]ui.ListState{}
	}
	a.drafts[a.viewKey(a.sessionID)] = a.draft
	a.scrolls[a.viewKey(a.sessionID)] = a.list
	a.draft = a.drafts[a.viewKey(s.ID)]
	if state, ok := a.scrolls[a.viewKey(s.ID)]; ok {
		a.list = state
	} else {
		a.list = ui.ListState{FollowEnd: true}
	}
	a.navigationGeneration++
	generation := a.navigationGeneration
	a.sessionID = s.ID
	a.current = snapshot{SessionID: s.ID}
	a.composer = nil
	a.connectionOpen = false
	if s.WorkspaceID != "" && s.WorkspaceID != a.workspaceID {
		a.request("selectWorkspace", map[string]any{"workspaceId": s.WorkspaceID}, func(raw json.RawMessage) error {
			if generation != a.navigationGeneration {
				return nil
			}
			a.workspaceID = s.WorkspaceID
			a.openSession(s.ID)
			return nil
		})
	} else {
		if s.WorkspaceID == "" {
			a.workspaceID = ""
		}
		a.openSession(s.ID)
	}
}
func (a *app) viewKey(id string) string {
	if a.accountScope != "" {
		return a.accountScope + "\x00" + a.hostID + "\x00" + id
	}
	return a.hostID + "\x00" + id
}

func (a *app) openSession(id string) {
	generation, host := a.navigationGeneration, a.hostID
	a.sessionID = id
	a.current = snapshot{SessionID: id}
	a.request("openSession", map[string]any{"workspaceId": a.workspaceID, "sessionId": id}, func(raw json.RawMessage) error {
		if a.sessionID != id || generation != a.navigationGeneration || host != a.hostID {
			return nil
		}
		var s snapshot
		if err := json.Unmarshal(raw, &s); err != nil {
			return err
		}
		a.replaceSnapshot(s)
		a.fetchCapabilities()
		a.reloadComposer()
		a.composerBaselineKey = a.currentComposerBaselineKey()
		a.rememberSelection()
		return nil
	})
}
func (a *app) currentComposerBaselineKey() string {
	return fmt.Sprintf("%s\x00%d\x00%s", a.hostID, a.remoteGeneration, a.sessionID)
}

func (a *app) send() {
	a.sendWithMode(a.uiPrefs.SendMode)
}
func (a *app) sendWithMode(mode string) {
	if mode != "queue" && mode != "steer" {
		a.error = "发送模式无效"
		return
	}
	if !a.connected {
		a.error = "Remote 未连接，无法发送。"
		return
	}
	text := strings.TrimSpace(a.draft)
	if text == "" || a.sessionID == "" {
		return
	}
	key := a.viewKey(a.sessionID) + "\x00" + text
	if previous := a.sendIntents[key]; previous != nil && previous.Unknown {
		a.error = "上一条发送结果未确认，请先核对远程会话。请求：" + previous.ID
		return
	}
	intent := &sendIntent{ID: rand.Text(), SessionID: a.sessionID, HostID: a.hostID, AccountScope: a.accountScope, Text: text, Draft: a.draft, Unknown: true}
	if a.sendIntents == nil {
		a.sendIntents = map[string]*sendIntent{}
	}
	a.sendIntents[key] = intent
	a.pendingSend = intent
	a.requestWithFailure("sendMessage", map[string]any{"sessionId": intent.SessionID, "text": text, "requestId": intent.ID, "mode": mode, "clientScope": a.operationScope()}, func(raw json.RawMessage) error { return a.acceptSend(raw, intent) }, func(err error) {
		var rejected *bridge.RemoteError
		if errors.As(err, &rejected) && rejected.Rejected() {
			intent.Unknown = false
			delete(a.sendIntents, key)
			if a.pendingSend == intent {
				a.pendingSend = nil
			}
			return
		}
		intent.Unknown = true
		if a.hostID == intent.HostID && a.accountScope == intent.AccountScope {
			a.error = fmt.Sprintf("发送结果未确认，请核对会话，勿重复发送。请求：%s。%v", intent.ID, err)
		}
	})
}
