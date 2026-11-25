package main

import (
	"context"
	"encoding/json"
	"time"
)

type presentedFile struct {
	Path        string `json:"path"`
	Description string `json:"description"`
}

type presentedTurn struct {
	Turn  int             `json:"turn"`
	Call  string          `json:"callId"`
	Files []presentedFile `json:"files"`
}

// presentedByTurn keeps only well-formed delivery declarations. The Session
// log also carries every other event, so malformed rows are ignored rather
// than failing the whole page.
func presentedByTurn(raw json.RawMessage) map[int][]presentedFile {
	var page struct {
		Records []struct {
			Event struct {
				Type string          `json:"type"`
				Data json.RawMessage `json:"data"`
			} `json:"event"`
		} `json:"records"`
	}
	if json.Unmarshal(raw, &page) != nil {
		return nil
	}
	out := map[int][]presentedFile{}
	for _, record := range page.Records {
		if record.Event.Type != "deliverables/presented" {
			continue
		}
		var data presentedTurn
		if json.Unmarshal(record.Event.Data, &data) != nil || data.Turn < 1 || len(data.Files) == 0 {
			continue
		}
		for _, file := range data.Files {
			if file.Path == "" {
				continue
			}
			out[data.Turn] = append(out[data.Turn], file)
		}
	}
	return out
}

// fetchDeliverables reads the Session log's delivery declarations. They are
// not part of the chat presentation projection, so this page is the only way
// the native client can draw the reference's declared-file cards.
func (a *app) fetchDeliverables() {
	client := a.client
	if client == nil || !a.connected || a.demo || a.sessionID == "" {
		return
	}
	session, host, generation := a.sessionID, a.hostID, a.remoteGeneration
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "sessionEvents", map[string]any{"request": map[string]any{
			"address":     map[string]any{"kind": "session", "sessionId": session},
			"maxMessages": 800,
		}})
		if err != nil {
			return
		}
		presented := presentedByTurn(raw)
		a.update(func() {
			if a.client != client || a.sessionID != session || a.hostID != host || a.remoteGeneration != generation {
				return
			}
			a.presentedFiles = presented
		})
	}()
}
