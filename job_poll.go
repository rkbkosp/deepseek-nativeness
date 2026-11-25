package main

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// jobListStatus extracts one job's status from a job/list reply. The Host wraps
// the rows differently across versions, so accept both a bare array and a
// `jobs` field, and match either the tool id or the job id.
func jobListStatus(raw json.RawMessage, id string) (string, bool) {
	var rows []struct {
		ID     string `json:"id"`
		JobID  string `json:"jobId"`
		Status string `json:"status"`
	}
	if json.Unmarshal(raw, &rows) != nil {
		var wrapper struct {
			Jobs []struct {
				ID     string `json:"id"`
				JobID  string `json:"jobId"`
				Status string `json:"status"`
			} `json:"jobs"`
		}
		if json.Unmarshal(raw, &wrapper) != nil {
			return "", false
		}
		rows = wrapper.Jobs
	}
	for _, row := range rows {
		if row.ID == id || row.JobID == id {
			return row.Status, true
		}
	}
	return "", false
}

func (a *app) pollJobDetail(id string) {
	client := a.client
	sessionID := a.sessionID
	if client == nil || sessionID == "" || id == "" {
		return
	}
	for {
		a.update(func() {
			if a.jobDetail == nil || (a.jobDetail.JobID != id && a.jobDetail.ID != id) {
				return
			}
		})
		if a.jobDetail == nil || (a.jobDetail.JobID != id && a.jobDetail.ID != id) {
			return
		}
		ctx, cancel := context.WithTimeout(a.ctx, 10*time.Second)
		raw, err := client.Call(ctx, "watchJobs", map[string]any{"sessionId": sessionID})
		cancel()
		if err == nil {
			if status, ok := jobListStatus(raw, id); ok {
				a.update(func() {
					if a.jobDetail != nil && a.jobDetail.Status != "" && (a.jobDetail.JobID == id || a.jobDetail.ID == id) {
						a.jobDetail.Status = status
					}
				})
				if !strings.Contains(strings.ToLower(status), "run") && !strings.Contains(status, "运行") {
					return
				}
			}
		}
		time.Sleep(2 * time.Second)
	}
}
