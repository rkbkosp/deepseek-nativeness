package main

import (
	"encoding/json"
	"strings"
)

// applySessionTitle keeps a sidebar row's name in step with the Host's title
// projection. The Host generates the title after the first prompt and publishes
// it on the Session's projection stream; without this, the row kept the
// provisional "新会话" label until the next full catalog read (which only the
// New Session button and other catalog actions triggered).
func (a *app) applySessionTitle(sessionID string, projections json.RawMessage) {
	if sessionID == "" || len(projections) == 0 {
		return
	}
	var envelope struct {
		Values  json.RawMessage `json:"values"`
		AsOfSeq int64           `json:"asOfSeq"`
	}
	if err := json.Unmarshal(projections, &envelope); err != nil {
		return
	}
	values := envelope.Values
	if len(values) == 0 {
		// A bare value map is the same payload without the sequence envelope.
		values = projections
	}
	var projected map[string]json.RawMessage
	if err := json.Unmarshal(values, &projected); err != nil {
		return
	}
	raw, ok := projected["title"]
	if !ok {
		return
	}
	var title string
	if err := json.Unmarshal(raw, &title); err != nil {
		return
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return
	}
	// Older reads can answer after a newer stream frame; the projection's own
	// sequence keeps the newer name.
	if seq := envelope.AsOfSeq; seq > 0 {
		if stored := a.titleSeq[sessionID]; stored > seq {
			return
		}
		if a.titleSeq == nil {
			a.titleSeq = map[string]int64{}
		}
		a.titleSeq[sessionID] = seq
	}
	for i := range a.sessions {
		if a.sessions[i].ID == sessionID {
			a.sessions[i].Title = title
			return
		}
	}
}
