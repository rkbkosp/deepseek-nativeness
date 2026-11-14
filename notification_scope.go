package main

import (
	"encoding/json"
	"native-dsh/desktop/internal/bridge"
)

func (a *app) statusResponseStale(raw json.RawMessage) bool {
	var s struct {
		Generation uint64 `json:"connectionGeneration"`
	}
	return json.Unmarshal(raw, &s) == nil && s.Generation < a.remoteGeneration
}

// The local helper annotates a notification when it is produced, so a frame
// already queued on the Go UI thread cannot be relabeled after navigation.
func (a *app) notificationScopeCurrent(ev bridge.Notification) bool {
	s := ev.Scope
	if s == nil {
		// Direct local unit fixtures predate the scoped helper. A running
		// normal client may not accept unscoped presentation state.
		return a.demo || a.client == nil || ev.Method == "error"
	}
	if ev.Method == "status" {
		if s.Generation < a.remoteGeneration {
			return false
		}
		// The UI selects a Host synchronously before its connect RPC. An old
		// connected status may not undo that intended target, even if still queued.
		if s.HostID != "" && a.hostID != "" && s.HostID != a.hostID {
			return false
		}
		return true
	}
	return s.HostID == a.hostID && s.Generation == a.remoteGeneration && s.AccountScope == a.accountScope
}
