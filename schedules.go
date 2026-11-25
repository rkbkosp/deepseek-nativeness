package main

import (
	"context"
	"encoding/json"
	"time"
)

type scheduleRecord struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	Title     string `json:"title"`
}

// fetchSchedules reads the Host's schedule catalog so a Session row can show
// the clock badge the reference uses. The catalog is Host-scoped, not Session
// scoped, so one read serves every row.
func scheduleSessionCounts(list []scheduleRecord) map[string]int {
	counts := map[string]int{}
	for _, record := range list {
		if record.SessionID != "" {
			counts[record.SessionID]++
		}
	}
	return counts
}

func (a *app) fetchSchedules() {
	client := a.client
	if client == nil || !a.connected || a.demo || !a.can("scheduleCatalog") {
		return
	}
	host, generation := a.hostID, a.remoteGeneration
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "scheduleCatalog", nil)
		if err != nil {
			return
		}
		var list []scheduleRecord
		if json.Unmarshal(raw, &list) != nil {
			var wrapper struct {
				Schedules []scheduleRecord `json:"schedules"`
			}
			if json.Unmarshal(raw, &wrapper) != nil {
				return
			}
			list = wrapper.Schedules
		}
		counts := scheduleSessionCounts(list)
		a.update(func() {
			if a.client != client || a.hostID != host || a.remoteGeneration != generation {
				return
			}
			a.scheduleCounts = counts
			a.schedules = list
		})
	}()
}
