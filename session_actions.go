package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"strings"
	"time"
)

func (a *app) fetchCapabilities() {
	host, sid, scope, generation := a.hostID, a.sessionID, a.accountScope, a.remoteGeneration
	a.scopedRead("capabilities", map[string]any{"sessionId": sid, "workspaceId": a.workspaceID}, func(raw json.RawMessage) error {
		if host != a.hostID || sid != a.sessionID || scope != a.accountScope || generation != a.remoteGeneration {
			return nil
		}
		var state struct {
			Operations map[string]bool `json:"operations"`
			Details    map[string]struct {
				Reason string `json:"reason"`
			} `json:"details"`
		}
		if err := json.Unmarshal(raw, &state); err != nil {
			return err
		}
		a.operationCaps = map[string]operationCapability{}
		for name, supported := range state.Operations {
			a.operationCaps[name] = operationCapability{Supported: supported, Reason: state.Details[name].Reason}
		}
		return nil
	})
}
func (a *app) can(name string) bool { return a.connected && !a.busy && a.operationCaps[name].Supported }

var errRemoteNotConnected = errors.New("Remote 未连接")

type mutationIntent struct {
	ID      string
	Unknown bool
}

func (a *app) mutate(method string, params map[string]any, accept func(json.RawMessage) error) {
	a.mutateWithFailure(method, params, accept, nil)
}

// mutateWithFailure reports a rejected or uncertain write to its caller so a
// transient form (for example the new Workspace sheet) can release its own
// "submitting" state instead of staying disabled.
func (a *app) mutateWithFailure(method string, params map[string]any, accept func(json.RawMessage) error, failed func(error)) {
	if a.client == nil || !a.connected {
		a.error = "Remote 未连接，操作未发送。"
		if failed != nil {
			failed(errRemoteNotConnected)
		}
		return
	}
	host, generation, account := a.hostID, a.remoteGeneration, a.accountScope
	serialized, err := json.Marshal(params)
	if err != nil {
		a.error = err.Error()
		if failed != nil {
			failed(err)
		}
		return
	}
	// Own the complete JSON value before any asynchronous write. UseNumber
	// preserves revision/sequence integers beyond JavaScript's safe range.
	var captured map[string]any
	decoder := json.NewDecoder(bytes.NewReader(serialized))
	decoder.UseNumber()
	if err := decoder.Decode(&captured); err != nil {
		a.error = err.Error()
		if failed != nil {
			failed(err)
		}
		return
	}
	params = captured
	key := a.viewKey("") + method + "\x00" + string(serialized)
	if a.mutations == nil {
		a.mutations = map[string]*mutationIntent{}
	}
	if previous := a.mutations[key]; previous != nil && previous.Unknown {
		a.error = "上一操作结果未确认，请先核对远程状态，勿重复操作。请求：" + previous.ID
		if failed != nil {
			failed(errors.New("上一操作结果未确认"))
		}
		return
	}
	id := rand.Text()
	intent := &mutationIntent{ID: id, Unknown: true}
	a.mutations[key] = intent
	params["requestId"] = id
	params["clientScope"] = a.operationScope()
	a.requestWithFailure(method, params, func(raw json.RawMessage) error {
		var receipt struct {
			Status, RequestID, Detail string
			HostID                    string `json:"hostId"`
			Generation                uint64 `json:"connectionGeneration"`
			Value                     json.RawMessage
		}
		if err := json.Unmarshal(raw, &receipt); err != nil {
			return err
		}
		if receipt.Status == "rejected" && receipt.RequestID == id {
			delete(a.mutations, key)
			return fmt.Errorf("操作未执行：%s", receipt.Detail)
		}
		if receipt.Status != "accepted" || receipt.RequestID != id || receipt.HostID != host || receipt.Generation != generation {
			return fmt.Errorf("操作结果未确认，请核对远程状态，勿重复操作。请求：%s。%s", id, receipt.Detail)
		}
		intent.Unknown = false
		delete(a.mutations, key)
		if a.hostID != host || a.remoteGeneration != generation || a.accountScope != account {
			return nil
		}
		if accept != nil {
			return accept(receipt.Value)
		}
		return nil
	}, func(err error) {
		var remote *bridge.RemoteError
		if errors.As(err, &remote) && remote.Rejected() {
			delete(a.mutations, key)
		}
		if failed != nil {
			failed(err)
		}
	})
}
func (a *app) operationScope() map[string]any {
	scope := map[string]any{"hostId": a.hostID, "generation": a.remoteGeneration}
	if a.sessionID != "" {
		scope["sessionId"] = a.sessionID
	}
	return scope
}
func (a *app) sessionMenu(c *ui.Context, m *ui.Menu, s session) {
	pin, method := "置顶会话", "pinSession"
	if s.Pinned {
		pin, method = "取消置顶", "unpinSession"
	}
	if m.Item(pin).Disabled(!a.can(method)).Chosen() {
		a.mutate(method, map[string]any{"sessionId": s.ID}, func(json.RawMessage) error { a.fetchSessions(); return nil })
	}
	if m.Item("重命名").Disabled(!a.can("renameSession")).Chosen() {
		a.renameID = s.ID
		a.renameHost = a.hostID
		a.renameScope = a.accountScope
		a.renameTitle = s.Title
	}
	if m.Item("分叉会话").Disabled(!a.can("forkSession")).Chosen() {
		a.mutate("forkSession", map[string]any{"sessionId": s.ID}, func(json.RawMessage) error { a.fetchWorkspaces(); return nil })
	}
	m.Separator()
	if m.Item("复制 Session ID").Chosen() {
		c.WriteClipboard(s.ID)
	}
	m.Item("在应用中打开").Disabled(true)
	m.Separator()
	label, archive := "归档会话", "archiveSession"
	if s.Archived {
		label, archive = "取消归档", "unarchiveSession"
	}
	if m.Item(label).Disabled(!a.can(archive)).Chosen() {
		a.mutate(archive, map[string]any{"sessionId": s.ID, "stopActivity": false}, func(json.RawMessage) error { a.fetchSessions(); return nil })
	}
}
func (a *app) renameView(c *ui.Context) {
	open := a.renameID != ""
	ui.Modal(c, &open, func() {
		ui.Text(c, "重命名会话").FontSize(18).FontWeight(500)
		ui.TextInput(c, &a.renameTitle).Label("会话名称").Width(400).AutoFocus()
		ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
			if ui.Button(c, "取消").Clicked() {
				a.renameID = ""
			}
			if ui.PrimaryButton(c, "保存").Disabled(!a.can("renameSession") || a.renameHost != a.hostID || a.renameScope != a.accountScope || strings.TrimSpace(a.renameTitle) == "").Clicked() {
				id, title := a.renameID, strings.TrimSpace(a.renameTitle)
				a.mutate("renameSession", map[string]any{"sessionId": id, "title": title}, func(json.RawMessage) error { a.renameID = ""; a.fetchSessions(); return nil })
			}
		})
	})
	if !open {
		a.renameID = ""
	}
}
func (a *app) createSession() { a.createSessionIn("") }
func (a *app) createSessionIn(workspaceID string) {
	target, reuse := a.newSessionTarget(workspaceID)
	if target == "" {
		a.clearMain()
		return
	}
	a.navigationGeneration++
	navigation := a.navigationGeneration
	params := map[string]any{"workspaceId": target}
	if reuse != "" {
		params["sessionId"] = reuse
	}
	a.mutate("createSession", params, func(raw json.RawMessage) error {
		var result struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			return err
		}
		if result.SessionID == "" {
			return errors.New("主机未返回新会话标识，请刷新核对")
		}
		if a.navigationGeneration != navigation {
			return nil
		}
		a.refreshCatalog(func() {
			if a.navigationGeneration != navigation {
				return
			}
			for _, s := range a.sessions {
				if s.ID == result.SessionID {
					a.chooseSession(s)
					a.focusDraft = true
					return
				}
			}
			a.error = "新会话尚未出现在目录中，请刷新核对。"
		})
		return nil
	})
}

// Global main panels supersede pending session navigation. Modal settings,
// model popovers and right-pane views leave the main navigation alive, matching
// LayoutService.selectPanel versus SettingsRoot's local open state.
func (a *app) beginMainNavigation() {
	a.resetMessageImages()
	a.navigationGeneration++
	a.restoreTarget = nil
}
func (a *app) clearMain() {
	a.releaseComposerImages()
	a.resetMessageImages()
	a.invalidateChatRows()
	if a.drafts == nil {
		a.drafts = map[string]string{}
	}
	a.drafts[a.viewKey(a.sessionID)] = a.draft
	a.navigationGeneration++
	a.closeCompat()
	a.closeWeb()
	a.sessionID = ""
	a.workspaceID = ""
	a.sessionOpening = ""
	a.current = snapshot{}
	a.composer = nil
	a.draft = ""
	if a.connected && a.client != nil && !a.demo {
		a.request("clearSession", map[string]any{}, nil)
	}
}
func (a *app) newSessionTarget(explicit string) (string, string) {
	target := explicit
	if target == "" && a.sessionID != "" {
		for _, s := range a.sessions {
			if s.ID == a.sessionID && s.WorkspaceID != "" {
				for _, w := range a.workspaces {
					if w.ID == s.WorkspaceID {
						target = w.ID
						break
					}
				}
				break
			}
		}
		for _, w := range a.workspaces {
			if target != "" {
				break
			}
			if containsID(w.SessionIDs, a.sessionID) {
				target = w.ID
				break
			}
		}
	}
	if target == "" && a.workspaceID != "" {
		for _, w := range a.workspaces {
			if w.ID == a.workspaceID {
				target = w.ID
				break
			}
		}
	}
	if target == "" {
		latest := float64(-1)
		for _, w := range a.workspaces {
			updated := float64(0)
			for _, s := range a.sessions {
				if containsID(w.SessionIDs, s.ID) || s.WorkspaceID == w.ID {
					updated = max(updated, s.UpdatedAt)
				}
			}
			if updated == 0 {
				if at, err := time.Parse(time.RFC3339, w.CreatedAt); err == nil {
					updated = float64(at.UnixMilli())
				}
			}
			if target == "" || updated > latest {
				target = w.ID
				latest = updated
			}
		}
	}
	for _, w := range a.workspaces {
		if w.ID != target {
			continue
		}
		for _, s := range a.sessions {
			if s.Blank && !s.Archived && s.Cwd == w.Path && (containsID(w.SessionIDs, s.ID) || s.WorkspaceID == w.ID) {
				return target, s.ID
			}
		}
		return target, ""
	}
	return "", ""
}
func (a *app) refreshCatalog(after func()) {
	host, scope, generation := a.hostID, a.accountScope, a.remoteGeneration
	a.scopedRead("workspaces", map[string]any{}, func(raw json.RawMessage) error {
		if a.hostID != host || a.accountScope != scope || a.remoteGeneration != generation {
			return nil
		}
		rows, err := decodeRows[workspace](raw, "workspaces", "items")
		if err != nil {
			return err
		}
		a.workspaces = rows
		a.scopedRead("sessions", map[string]any{"all": true}, func(raw json.RawMessage) error {
			if host != a.hostID || scope != a.accountScope || generation != a.remoteGeneration {
				return nil
			}
			rows, err := decodeRows[session](raw, "sessions", "items")
			if err != nil {
				return err
			}
			a.sessions = rows
			if after != nil {
				after()
			}
			return nil
		})
		return nil
	})
}
func (a *app) loadedMarkdown() string {
	var b strings.Builder
	for _, m := range a.current.Messages {
		if m.Kind == "context" || m.Kind == "tool" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		if m.Role == "user" {
			b.WriteString("## 用户\n\n")
		}
		b.WriteString(m.Text)
	}
	return b.String()
}

func (a *app) mutationReviewView(c *ui.Context) {
	if !a.mutationReview {
		return
	}
	ui.Modal(c, &a.mutationReview, func() {
		ui.Text(c, "操作结果未确认").FontSize(18).FontWeight(500)
		ui.Text(c, "请先检查远程状态。会话名称、置顶和归档可刷新列表核对；其它操作请重新打开对应页面。客户端不会自动重新发送。").Width(460).Wrap()
		for key, intent := range a.mutations {
			if strings.HasPrefix(key, a.viewKey("")) {
				ui.Text(c, "请求："+intent.ID).FontSize(11).Selectable()
			}
		}
		if ui.Button(c, "刷新会话列表").Disabled(!a.connected || a.busy).Clicked() {
			a.fetchWorkspaces()
		}
		ui.Checkbox(c, &a.mutationAcknowledge, "我已核对远程状态，接下来要发起新的操作")
		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			if ui.Button(c, "继续等待").Clicked() {
				a.mutationReview = false
			}
			if ui.PrimaryButton(c, "允许新的操作").Disabled(!a.mutationAcknowledge).Clicked() {
				for key := range a.mutations {
					if strings.HasPrefix(key, a.viewKey("")) {
						delete(a.mutations, key)
					}
				}
				a.mutationReview = false
				a.error = ""
			}
		})
	})
}
