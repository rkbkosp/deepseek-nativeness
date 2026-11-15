package main

import (
	"encoding/json"
	"testing"

	"native-dsh/desktop/internal/bridge"
)

func TestScopeAnswersDoNotLeakAcrossScopes(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.hostID, a.accountScope, a.workspaceID, a.sessionID = "host", "account", "workspace", "session-a"
	a.rememberCapabilities(a.sessionScope(), map[string]operationCapability{"createSession": {Supported: true}})
	if !a.applyCachedCapabilities() {
		t.Fatal("same scope missed its own answer")
	}
	a.sessionID = "session-b"
	if a.applyCachedCapabilities() {
		t.Fatal("another Session reused the answer")
	}
	a.sessionID, a.remoteGeneration = "session-a", 1
	if a.applyCachedCapabilities() {
		t.Fatal("another connection epoch reused the answer")
	}
	a.remoteGeneration = 0
	if !a.applyCachedCapabilities() {
		t.Fatal("the original scope stopped matching")
	}
	a.invalidateScopeAnswers()
	if a.applyCachedCapabilities() {
		t.Fatal("an invalidation did not drop the answer")
	}
}

// Reopening a Session must not re-read Host answers that only change through an
// invalidation row: the capability stream and the composer catalogs are reused,
// while the Session's own projections stay a live read.
func TestSessionReopenReusesHostAnswers(t *testing.T) {
	f := startFixtureApp(t)
	first := f.read(func() any { return f.a.sessions[0] }).(session)

	f.do(func() { f.a.chooseSession(first) })
	f.wait(t, "first Session open", func() bool {
		return f.a.sessionID == first.ID && len(f.a.current.Messages) > 0 && !f.a.busy
	})
	f.wait(t, "composer catalogs", func() bool {
		return f.a.composer != nil && len(f.a.composer.commands) > 0 && len(f.a.composer.permissions) > 0
	})

	before := f.hostReads(t)
	for _, key := range []string{"open:remoteAccess/follow", "session/modelCatalog", "permissionPresets/catalog", "commands/list", "session/projections"} {
		if before[key] == 0 {
			t.Fatalf("first open did not read %s: %v", key, before)
		}
	}

	f.do(func() { f.a.openSession(first.ID) })
	f.wait(t, "reopened Session", func() bool {
		return f.a.sessionID == first.ID && f.a.sessionOpening == "" && len(f.a.current.Messages) > 0
	})
	f.waitReads(t, "session/projections", before["session/projections"]+1)

	after := f.hostReads(t)
	for _, key := range []string{"open:remoteAccess/follow", "session/modelCatalog", "permissionPresets/catalog", "commands/list"} {
		if after[key] != before[key] {
			t.Fatalf("reopen re-read %s: %d -> %d", key, before[key], after[key])
		}
	}
	if after["session/projections"] != before["session/projections"]+1 {
		t.Fatalf("reopen projections reads = %d, want %d", after["session/projections"], before["session/projections"]+1)
	}
	if caps := f.read(func() any { return len(f.a.operationCaps) }); caps == 0 {
		t.Fatal("cached capabilities were not applied to the window")
	}
}

// A Host invalidation row is the documented refresh signal for these answers.
func TestHostInvalidationDropsReusedAnswers(t *testing.T) {
	f := startFixtureApp(t)
	first := f.read(func() any { return f.a.sessions[0] }).(session)

	f.do(func() { f.a.chooseSession(first) })
	f.wait(t, "first Session open", func() bool {
		return f.a.sessionID == first.ID && len(f.a.current.Messages) > 0 && !f.a.busy
	})
	f.wait(t, "composer catalogs", func() bool {
		return f.a.composer != nil && len(f.a.composer.commands) > 0
	})
	before := f.hostReads(t)

	f.do(func() {
		a := f.a
		params, _ := json.Marshal(map[string]any{
			"event":                "llm/adapters-updated",
			"hostId":               a.hostID,
			"connectionGeneration": a.remoteGeneration,
		})
		a.notification(bridge.Notification{
			Method: "remoteInvalidation",
			Params: params,
			Scope: &bridge.NotificationScope{
				HostID:       a.hostID,
				Generation:   a.remoteGeneration,
				AccountScope: a.accountScope,
			},
		})
	})
	if f.read(func() any { return f.a.scopeCache == nil }) != true {
		t.Fatal("invalidation event did not drop the answers")
	}

	f.do(func() { f.a.openSession(first.ID) })
	f.waitReads(t, "open:remoteAccess/follow", before["open:remoteAccess/follow"]+1)
	f.waitReads(t, "session/modelCatalog", before["session/modelCatalog"]+1)
	f.waitReads(t, "permissionPresets/catalog", before["permissionPresets/catalog"]+1)
	f.waitReads(t, "commands/list", before["commands/list"]+1)
}
