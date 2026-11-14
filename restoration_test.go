package main

import "testing"

func TestRestoreRequiresAuthorizedMatchingAccountAndServer(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.authorized = true
	a.accountScope = "account-a"
	a.configuredServer = "https://fixture.invalid"
	a.savedSelections = map[string]savedSelection{"account-a": {ServerURL: a.configuredServer, HostID: "saved-host", WorkspaceID: "workspace", SessionID: "session"}}
	if _, ok := a.restorableSelection(); !ok {
		t.Fatal("matching private selection not restored")
	}
	a.accountScope = "account-b"
	if _, ok := a.restorableSelection(); ok {
		t.Fatal("selection crossed account boundary")
	}
	a.accountScope = "account-a"
	a.configuredServer = "https://other.invalid"
	if _, ok := a.restorableSelection(); ok {
		t.Fatal("selection crossed server boundary")
	}
	a.configuredServer = "https://fixture.invalid"
	a.authorized = false
	if _, ok := a.restorableSelection(); ok {
		t.Fatal("unauthorized restoration")
	}
}
func TestOfflineSavedHostDoesNotSelectAnotherOnlineHost(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.authorized = true
	a.accountScope = "account-a"
	a.configuredServer = "https://fixture.invalid"
	a.savedSelections = map[string]savedSelection{"account-a": {ServerURL: a.configuredServer, HostID: "offline-host"}}
	a.devices = []device{{ID: "offline-host", Online: false}, {ID: "different-host", Online: true}}
	a.maybeRestoreConnection()
	if a.hostID != "" || a.restoreTarget != nil || a.savedSelections["account-a"].HostID != "offline-host" {
		t.Fatal("offline restore changed target")
	}
}
func TestRestoredSessionMustBelongToSavedWorkspace(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.hostID = "host"
	a.workspaces = []workspace{{ID: "saved", SessionIDs: []string{"valid"}}, {ID: "other", SessionIDs: []string{"other-session"}}}
	a.sessions = []session{{ID: "valid", WorkspaceID: "saved"}, {ID: "other-session", WorkspaceID: "other"}}
	a.restoreTarget = &savedSelection{HostID: "host", WorkspaceID: "saved", SessionID: "other-session"}
	a.sessionID = ""
	a.finishRestore()
	if a.sessionID != "" {
		t.Fatal("restored foreign workspace session")
	}
	a.restoreTarget = &savedSelection{HostID: "host", WorkspaceID: "saved", SessionID: "valid"}
	a.finishRestore()
	if a.sessionID != "valid" {
		t.Fatal("valid saved session not selected")
	}
}
func TestChangingAccountStashesDraftUnderOriginalScope(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.accountScope = "original"
	a.hostID = "host"
	a.sessionID = "session"
	a.draft = "original private draft"
	key := a.viewKey(a.sessionID)
	a.adoptAccountScope("other")
	if a.drafts[key] != "original private draft" || a.draft != "" || a.hostID != "" {
		t.Fatal("account switch did not isolate old view")
	}
	a.hostID = "host"
	if a.drafts[a.viewKey("session")] != "" {
		t.Fatal("draft leaked to another account")
	}
}
