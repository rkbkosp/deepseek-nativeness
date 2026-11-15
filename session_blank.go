package main

import "time"

// markSessionTurnStarted records the local effect of an accepted first message.
//
// The Host flips a Session's blank flag on turn/start, but this client's catalog
// is a list read (or a cached row carried by the helper), so it can still call
// the Session blank after the Turn began. A blank Session is listed only while
// it is the selected one, so without this flip the row would disappear from the
// sidebar as soon as the reader switched to another Session — the Host's own
// client keeps it, because its list state clears blank when the Turn starts.
func (a *app) markSessionTurnStarted(id string) {
	if id == "" {
		return
	}
	for i := range a.sessions {
		s := &a.sessions[i]
		if s.ID != id {
			continue
		}
		s.Blank = false
		if now := float64(time.Now().UnixMilli()); now > s.UpdatedAt {
			s.UpdatedAt = now
		}
		return
	}
}
