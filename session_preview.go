package main

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// lastEventText walks a session page backward for the newest human-readable
// text, which is enough for the sidebar's hover preview. It never depends on
// one event schema: message bodies, tool output and notices all carry `text`.
func lastEventText(raw json.RawMessage) string {
	var page struct {
		Records []struct {
			Event struct {
				Type string          `json:"type"`
				Data json.RawMessage `json:"data"`
			} `json:"event"`
		} `json:"records"`
	}
	if json.Unmarshal(raw, &page) != nil {
		return ""
	}
	for i := len(page.Records) - 1; i >= 0; i-- {
		if text := lastStringInJSON(page.Records[i].Event.Data); strings.TrimSpace(text) != "" {
			text = strings.TrimSpace(text)
			if len(text) > 240 {
				text = text[:240] + "…"
			}
			return text
		}
	}
	return ""
}

func lastStringInJSON(raw json.RawMessage) string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	var found string
	var walk func(any)
	walk = func(v any) {
		switch node := v.(type) {
		case map[string]any:
			if text, ok := node["text"].(string); ok {
				found = text
			}
			for key, child := range node {
				if key == "text" {
					continue
				}
				walk(child)
			}
		case []any:
			for _, child := range node {
				walk(child)
			}
		}
	}
	walk(value)
	return found
}

func (a *app) fetchSessionPreview(id string) {
	if a.demo || a.client == nil || !a.connected || id == "" {
		return
	}
	if _, ok := a.sessionPreviews[id]; ok {
		return
	}
	if a.sessionPreviewLoading == nil {
		a.sessionPreviewLoading = map[string]bool{}
	}
	if a.sessionPreviewLoading[id] {
		return
	}
	a.sessionPreviewLoading[id] = true
	client := a.client
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "sessionEvents", map[string]any{"request": map[string]any{
			"address":     map[string]any{"kind": "session", "sessionId": id},
			"maxMessages": 20,
		}})
		text := ""
		if err == nil {
			text = lastEventText(raw)
		}
		a.update(func() {
			if a.client != client {
				return
			}
			delete(a.sessionPreviewLoading, id)
			if a.sessionPreviews == nil {
				a.sessionPreviews = map[string]string{}
			}
			a.sessionPreviews[id] = text
		})
	}()
}
