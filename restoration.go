package main

import "strings"

type savedSelection struct {
	ServerURL   string `json:"serverUrl"`
	HostID      string `json:"hostId"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	SessionID   string `json:"sessionId,omitempty"`
}

func (a *app) adoptAccountScope(scope string) {
	if scope == "" {
		return
	}
	if a.accountScope != "" && a.accountScope != scope {
		a.rememberSelection()
		if a.drafts == nil {
			a.drafts = map[string]string{}
		}
		a.drafts[a.viewKey(a.sessionID)] = a.draft
		a.connected = false
		a.closeCompat()
		a.closeWeb()
		a.navigationGeneration++
		a.current = snapshot{}
		a.composer = nil
		a.hostID = ""
		a.workspaceID = ""
		a.sessionID = ""
		a.draft = ""
		a.sessions = nil
		a.workspaces = nil
		a.operationCaps = nil
		a.restoreTarget = nil
		a.restoreAttempted = ""
	}
	a.accountScope = scope
	a.authServer = a.configuredServer
}
func (a *app) rememberSelection() {
	if a.demo || !a.authorized || !a.connected || a.accountScope == "" || a.hostID == "" || a.restoreTarget != nil {
		return
	}
	if a.savedSelections == nil {
		a.savedSelections = map[string]savedSelection{}
	}
	a.savedSelections[a.accountScope] = savedSelection{ServerURL: a.authServer, HostID: a.hostID, WorkspaceID: a.workspaceID, SessionID: a.sessionID}
	a.savePreferences()
}
func (a *app) restorableSelection() (savedSelection, bool) {
	if !a.authorized || a.accountScope == "" {
		return savedSelection{}, false
	}
	saved, ok := a.savedSelections[a.accountScope]
	if !ok || saved.HostID == "" || strings.TrimRight(saved.ServerURL, "/") != strings.TrimRight(a.configuredServer, "/") {
		return savedSelection{}, false
	}
	return saved, true
}
func (a *app) maybeRestoreConnection() {
	if a.connected || a.busy || a.restoreAttempted == a.accountScope {
		return
	}
	saved, ok := a.restorableSelection()
	if !ok {
		return
	}
	for _, host := range a.devices {
		if host.ID != saved.HostID {
			continue
		}
		if !host.Online {
			a.detail = "上次的工作主机当前离线。已保留原选择，可稍后刷新或选择另一台主机。"
			return
		}
		a.restoreAttempted = a.accountScope
		a.connect(saved.HostID)
		a.restoreTarget = &saved
		return
	}
	a.detail = "上次的工作主机不在当前授权目录。已保留原选择，请重新选择主机。"
}
func (a *app) finishRestore() {
	saved := a.restoreTarget
	if saved == nil || saved.HostID != a.hostID {
		return
	}
	if saved.WorkspaceID == "" && saved.SessionID == "" {
		a.restoreTarget = nil
		a.connectionOpen = true
		return
	}
	if saved.WorkspaceID == "" && saved.SessionID != "" {
		for _, s := range a.sessions {
			if s.ID == saved.SessionID && s.WorkspaceID == "" {
				owned := false
				for _, w := range a.workspaces {
					if containsID(w.SessionIDs, s.ID) {
						owned = true
						break
					}
				}
				if !owned {
					a.restoreTarget = nil
					a.chooseSession(s)
					return
				}
			}
		}
		a.restoreTarget = nil
		a.detail = "上次未分组会话不在当前目录，请重新选择。"
		return
	}
	var group *workspace
	for i := range a.workspaces {
		if a.workspaces[i].ID == saved.WorkspaceID {
			group = &a.workspaces[i]
			break
		}
	}
	if group == nil {
		a.restoreTarget = nil
		a.detail = "上次的工作区不在当前目录，请重新选择。"
		return
	}
	if saved.SessionID == "" {
		a.restoreTarget = nil
		a.workspaceID = group.ID
		a.connectionOpen = false
		return
	}
	for _, s := range a.sessions {
		if s.ID == saved.SessionID && (containsID(group.SessionIDs, s.ID) || s.WorkspaceID == group.ID) {
			a.restoreTarget = nil
			a.chooseSession(s)
			return
		}
	}
	a.restoreTarget = nil
	a.detail = "上次的会话不在原工作区目录，请重新选择。"
}
