package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
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
	a.requestGuarded(method, params, accept, failed, nil)
}
func (a *app) scopedRead(method string, params map[string]any, accept func(json.RawMessage) error) {
	a.scopedRequest(method, params, accept, nil)
}
func (a *app) scopedRequest(method string, params map[string]any, accept func(json.RawMessage) error, failed func(error)) {
	host, account, generation, client := a.hostID, a.accountScope, a.remoteGeneration, a.client
	owned := make(map[string]any, len(params)+1)
	for k, v := range params {
		owned[k] = v
	}
	owned["clientScope"] = map[string]any{"hostId": host, "generation": generation}
	a.requestGuarded(method, owned, accept, failed, func() bool {
		return a.hostID == host && a.accountScope == account && a.remoteGeneration == generation && a.client == client
	})
}
func (a *app) requestGuarded(method string, params any, accept func(json.RawMessage) error, failed func(error), current func() bool) {
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
	client := a.client
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, method, params)
		a.update(func() {
			a.pendingRequests--
			a.busy = a.pendingRequests > 0
			if current != nil && !current() {
				return
			}
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
		if a.localRuntime != nil && a.localRuntime.native {
			// The local Host is the only host: connect immediately instead of
			// offering a Remote device list that does not exist.
			a.authorized = true
			a.connect(localHostID)
			return
		}
		if a.authorized {
			a.fetchDevices()
		} else {
			a.request("status", map[string]any{}, a.acceptStatus)
		}
	})
	go func() {
		for event := range client.Events {
			ev := event
			a.update(func() {
				if a.client == client {
					a.notification(ev)
				}
			})
		}
		if a.ctx.Err() == nil {
			a.update(func() {
				if a.client != client {
					return
				}
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
	if s.ConnectionGeneration < a.remoteGeneration {
		return nil
	}
	// RPC and event status share the same monotonic identity/connection
	// epoch. Advance it in this callback before adopting the new account.
	a.remoteGeneration = s.ConnectionGeneration
	a.detail = s.Detail
	scope := s.IdentityScope
	if scope == "" {
		scope = s.AccountScope
	}
	a.adoptAccountScope(scope)
	if a.compat != nil && (!s.Connected || s.HostID != a.compatHost || s.ConnectionGeneration != a.compatGeneration) {
		// Closing an old model page must not schedule a read on stale scope.
		a.connected = false
		a.closeCompat()
	}
	a.connected = s.Connected
	a.authorized = s.Authorized
	if s.Connected {
		a.status = a.connectedLabel()
		a.hostID = s.HostID
	} else if s.Authorized {
		a.status = "已登录，选择工作主机"
	} else {
		a.status = "尚未登录"
	}
	return nil
}

func (a *app) notification(ev bridge.Notification) {
	if !a.notificationScopeCurrent(ev) {
		return
	}
	if a.compat != nil && ev.Method == "remoteInvalidation" {
		var scope struct {
			HostID     string `json:"hostId"`
			Generation uint64 `json:"connectionGeneration"`
		}
		if json.Unmarshal(ev.Params, &scope) == nil && scope.HostID == a.compatHost && scope.Generation == a.compatGeneration {
			_ = compatNotifications.EmitPage(a.compat.Page(), ev)
		}
	}
	if ev.Method == "remoteInvalidation" {
		// Adapters, settings and credential rows can change catalogs, grants and
		// the command list; the original client refreshes its stores here too.
		a.invalidateScopeAnswers()
	}
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
		if err := json.Unmarshal(ev.Params, &p); err != nil {
			a.error = err.Error()
			return
		}
		// The name is log-backed and its own sequence fences it, so it applies
		// whatever the presentation baseline says, and for a Session a cached
		// passive follow publishes after the reader left.
		a.applySessionTitle(p.SessionID, p.Projections)
		if p.SessionID != a.sessionID {
			return
		}
		var header chatFrameHeader
		if err := json.Unmarshal(ev.Params, &header); err != nil {
			a.error = err.Error()
			return
		}
		if accepted, err := a.admitChatFrame(header); err != nil || !accepted {
			if err != nil {
				a.error = err.Error()
			}
			return
		}
		a.current.Projections = p.Projections
		_ = a.acceptComposerProjections(p.Projections)
	case "status":
		_ = a.acceptStatus(ev.Params)
	case "sessions":
		if rows, err := decodeRows[session](ev.Params, "sessions", "items"); err == nil {
			a.sessions = rows
			a.notifyCompatCatalog("sessions", rows)
		}
	case "workspaces":
		if rows, err := decodeRows[workspace](ev.Params, "workspaces", "items"); err == nil {
			a.workspaces = rows
			a.notifyCompatCatalog("workspaces", rows)
		}
	case "snapshot":
		var s snapshot
		if err := json.Unmarshal(ev.Params, &s); err != nil {
			a.error = "远程会话数据无效，请重新打开会话。"
		} else if a.sessionID == "" || s.SessionID == a.sessionID {
			adopted := a.replaceSnapshot(s)
			if adopted && a.connected && s.SessionID != "" && a.composerBaselineKey != a.currentComposerBaselineKey() {
				a.composerBaselineKey = a.currentComposerBaselineKey()
				a.reloadComposer()
			}
		}
	case "chatPresentationPatch", "messageUpsert", "messageRemove", "messageDelta", "sessionState", "pending", "trajectoryUpsert", "trajectoryRemove":
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
	account, server, client := a.accountScope, a.configuredServer, a.client
	a.requestGuarded("devices", map[string]any{}, func(raw json.RawMessage) error {
		rows, err := decodeRows[device](raw, "devices", "items")
		a.devices = rows
		if err == nil {
			a.maybeRestoreConnection()
		}
		return err
	}, nil, func() bool { return a.accountScope == account && a.configuredServer == server && a.client == client })
}

func (a *app) connect(id string) {
	a.invalidateScopeAnswers()
	a.releaseComposerImages()
	a.resetMessageImages()
	a.invalidateChatRows()
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
	a.sessionOpening = ""
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
		a.status = a.connectedLabel()
		if a.restoreTarget == nil {
			a.rememberSelection()
		}
		a.fetchCapabilities()
		a.fetchWorkspaces()
		return nil
	})
}

// refreshWorkspaces re-reads the Host registry. The helper answers
// selectWorkspace from the rows it saw in this call, so a registry change (a
// new Workspace, for example) must be read again before it can be selected.
func (a *app) refreshWorkspaces(after func()) {
	host, scope, generation := a.hostID, a.accountScope, a.remoteGeneration
	a.scopedRead("workspaces", map[string]any{"hostId": a.hostID}, func(raw json.RawMessage) error {
		if host != a.hostID || scope != a.accountScope || generation != a.remoteGeneration {
			return nil
		}
		rows, err := decodeRows[workspace](raw, "workspaces", "items")
		if err != nil {
			return err
		}
		a.workspaces = rows
		if after != nil {
			after()
		}
		return nil
	})
}

func (a *app) fetchWorkspaces() {
	a.refreshWorkspaces(func() { a.fetchSessions() })
}

func (a *app) selectWorkspace(id string) {
	a.workspaceID = id
	a.scopedRead("selectWorkspace", map[string]any{"workspaceId": id}, func(raw json.RawMessage) error {
		a.fetchSessions()
		return nil
	})
}
func (a *app) fetchSessions() {
	host, scope, generation := a.hostID, a.accountScope, a.remoteGeneration
	a.scopedRead("sessions", map[string]any{"all": true}, func(raw json.RawMessage) error {
		if host != a.hostID || scope != a.accountScope || generation != a.remoteGeneration {
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

// sessionNavigation is the state a switch replaces. A rejected switch restores
// it, so a failed select/pick cannot leave the window on an empty transcript
// that looks like a lost Remote connection.
type sessionNavigation struct {
	sessionID, workspaceID, draft, opening string
	list                                   ui.ListState
	current                                snapshot
	composer                               *composerState
	focusDraft                             bool
}

func (a *app) chooseSession(s session) {
	a.releaseComposerImages()
	a.resetMessageImages()
	a.invalidateChatRows()
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
	previous := sessionNavigation{sessionID: a.sessionID, workspaceID: a.workspaceID, draft: a.draft, opening: a.sessionOpening, list: a.list, current: a.current, composer: a.composer, focusDraft: a.focusDraft}
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
	a.sessionOpening = s.ID
	a.composer = nil
	a.connectionOpen = false
	failed := func(err error) {
		if generation != a.navigationGeneration {
			return
		}
		a.navigationGeneration++
		a.sessionOpening = ""
		a.sessionID = previous.sessionID
		a.workspaceID = previous.workspaceID
		a.current = previous.current
		a.composer = previous.composer
		a.draft = previous.draft
		a.list = previous.list
		a.focusDraft = previous.focusDraft
		if previous.opening != "" && previous.opening == previous.sessionID {
			// The superseded switch was itself still loading, so its reply is
			// retired with its navigation epoch. Ask again instead of leaving an
			// opened Session on the empty placeholder.
			a.openSession(previous.sessionID)
		}
		// The retry above starts its own request, which clears the shared error
		// slot, so report the rejected switch last.
		a.error = "切换会话失败：" + err.Error()
	}
	if s.WorkspaceID != "" && s.WorkspaceID != a.workspaceID {
		a.scopedRequest("selectWorkspace", map[string]any{"workspaceId": s.WorkspaceID}, func(raw json.RawMessage) error {
			if generation != a.navigationGeneration {
				return nil
			}
			a.workspaceID = s.WorkspaceID
			a.openSessionWith(s.ID, failed)
			return nil
		}, failed)
	} else {
		if s.WorkspaceID == "" {
			a.workspaceID = ""
		}
		a.openSessionWith(s.ID, failed)
	}
}
func (a *app) viewKey(id string) string {
	if a.accountScope != "" {
		return a.accountScope + "\x00" + a.hostID + "\x00" + id
	}
	return a.hostID + "\x00" + id
}

func (a *app) openSession(id string) {
	a.openSessionWith(id, nil)
}

func (a *app) openSessionWith(id string, failed func(error)) {
	a.resetMessageImages()
	a.invalidateChatRows()
	generation, host := a.navigationGeneration, a.hostID
	a.sessionID = id
	a.current = snapshot{SessionID: id}
	a.sessionOpening = id
	a.historyLoading = false
	a.historyError = ""
	a.scopedRequest("openSession", map[string]any{"workspaceId": a.workspaceID, "sessionId": id}, func(raw json.RawMessage) error {
		if a.sessionID != id || generation != a.navigationGeneration || host != a.hostID {
			return nil
		}
		var s snapshot
		if err := json.Unmarshal(raw, &s); err != nil {
			return err
		}
		a.replaceSnapshot(s)
		if !a.applyCachedCapabilities() {
			a.fetchCapabilities()
		}
		a.reloadComposer()
		a.composerBaselineKey = a.currentComposerBaselineKey()
		a.rememberSelection()
		return nil
	}, failed)
}
func (a *app) currentComposerBaselineKey() string {
	return fmt.Sprintf("%s\x00%d\x00%s", a.hostID, a.remoteGeneration, a.sessionID)
}

func (a *app) send() {
	a.sendWithMode(a.uiPrefs.SendMode)
}
func (a *app) sendWithMode(mode string) {
	text := strings.TrimSpace(a.draft)
	if text == "" {
		return
	}
	a.sendPayload(mode, text, nil, nil)
}

func (a *app) sendComposerPayload(mode string, content []composerContentPart, attachmentIDs []string) {
	if len(content) == 0 {
		return
	}
	a.sendPayload(mode, "", append([]composerContentPart(nil), content...), append([]string(nil), attachmentIDs...))
}

func (a *app) sendPayload(mode, text string, content []composerContentPart, attachmentIDs []string) {
	if mode != "queue" && mode != "steer" {
		a.error = "发送模式无效"
		return
	}
	if !a.connected {
		a.error = "Remote 未连接，无法发送。"
		return
	}
	if a.sessionID == "" {
		return
	}
	storeKey := a.viewKey(a.sessionID)
	key := storeKey + "\x00" + text
	if content != nil {
		raw, err := json.Marshal(content)
		if err != nil {
			a.error = "图片消息格式无效"
			return
		}
		key = storeKey + "\x00content:" + fmt.Sprintf("%x", sha256.Sum256(raw))
	}
	if previous := a.sendIntents[key]; previous != nil && previous.Unknown {
		a.error = "上一条发送结果未确认，请先核对远程会话。请求：" + previous.ID
		return
	}
	intent := &sendIntent{ID: rand.Text(), SessionID: a.sessionID, HostID: a.hostID, AccountScope: a.accountScope, Text: text, Draft: a.draft, Unknown: true, Content: content, AttachmentIDs: attachmentIDs, StoreKey: storeKey, IntentKey: key}
	if a.sendIntents == nil {
		a.sendIntents = map[string]*sendIntent{}
	}
	a.sendIntents[key] = intent
	a.pendingSend = intent
	params := map[string]any{"sessionId": intent.SessionID, "requestId": intent.ID, "mode": mode, "clientScope": a.operationScope()}
	if content != nil {
		params["content"] = content
	} else {
		params["text"] = text
	}
	a.requestWithFailure("sendMessage", params, func(raw json.RawMessage) error { return a.acceptSend(raw, intent) }, func(err error) {
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
