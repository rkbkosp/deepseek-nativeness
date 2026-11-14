package main

import (
	"encoding/json"
	"fmt"
)

func (a *app) replaceSnapshot(s snapshot) {
	a.current = s
	a.sessionID = s.SessionID
	a.reindexMessages()
	if len(s.Projections) > 0 {
		_ = a.acceptComposerProjections(s.Projections)
	}
	valid := make(map[string]bool, len(s.Pending))
	for _, p := range s.Pending {
		valid[p.ID] = true
	}
	for id := range a.answers {
		if !valid[id] {
			delete(a.answers, id)
		}
	}
}
func (a *app) reindexMessages() {
	a.messageIndex = make(map[string]int, len(a.current.Messages))
	for i, m := range a.current.Messages {
		a.messageIndex[m.ID] = i
	}
}

func (a *app) applyIncremental(method string, raw json.RawMessage) error {
	var target struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &target); err != nil {
		return err
	}
	if target.SessionID != a.sessionID {
		return nil
	}
	if a.messageIndex == nil {
		a.reindexMessages()
	}
	switch method {
	case "trajectoryUpsert":
		var p struct {
			Event trajectoryEvent `json:"event"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		if p.Event.ID == "" {
			return fmt.Errorf("轨迹事件缺少标识")
		}
		for i, v := range a.current.Trajectory {
			if v.ID == p.Event.ID {
				a.current.Trajectory[i] = p.Event
				return nil
			}
		}
		index := len(a.current.Trajectory)
		for i, v := range a.current.Trajectory {
			if v.Seq > p.Event.Seq {
				index = i
				break
			}
		}
		a.current.Trajectory = append(a.current.Trajectory, trajectoryEvent{})
		copy(a.current.Trajectory[index+1:], a.current.Trajectory[index:])
		a.current.Trajectory[index] = p.Event
	case "trajectoryRemove":
		var p struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		kept := a.current.Trajectory[:0]
		for _, v := range a.current.Trajectory {
			if !containsID(p.IDs, v.ID) {
				kept = append(kept, v)
			}
		}
		clear(a.current.Trajectory[len(kept):])
		a.current.Trajectory = kept
	case "messageUpsert":
		var p struct {
			Message message `json:"message"`
			Index   int     `json:"index"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		if p.Message.ID == "" {
			return fmt.Errorf("远程消息缺少标识，请重新打开会话")
		}
		if index, ok := a.messageIndex[p.Message.ID]; ok {
			a.current.Messages[index] = p.Message
		} else {
			index := max(0, min(p.Index, len(a.current.Messages)))
			a.current.Messages = append(a.current.Messages, message{})
			copy(a.current.Messages[index+1:], a.current.Messages[index:])
			a.current.Messages[index] = p.Message
			a.reindexMessages()
		}
	case "messageRemove":
		var p struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		removed := make(map[string]bool, len(p.IDs))
		for _, id := range p.IDs {
			removed[id] = true
		}
		kept := a.current.Messages[:0]
		for _, m := range a.current.Messages {
			if !removed[m.ID] {
				kept = append(kept, m)
			}
		}
		clear(a.current.Messages[len(kept):])
		a.current.Messages = kept
		a.reindexMessages()
	case "messageDelta":
		var p struct {
			MessageID              string  `json:"messageId"`
			TextAppend             string  `json:"textAppend"`
			ReasoningAppend        string  `json:"reasoningAppend"`
			Streaming              bool    `json:"streaming"`
			ReasoningDisplay       *string `json:"reasoningDisplay"`
			ReasoningDisplayAppend string  `json:"reasoningDisplayAppend"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		index, ok := a.messageIndex[p.MessageID]
		if !ok {
			return fmt.Errorf("远程增量缺少消息基线，请重新打开会话")
		}
		m := &a.current.Messages[index]
		m.Text += p.TextAppend
		m.Reasoning += p.ReasoningAppend
		if p.ReasoningDisplay != nil {
			m.ReasoningDisplay = *p.ReasoningDisplay
		}
		m.ReasoningDisplay += p.ReasoningDisplayAppend
		m.Streaming = p.Streaming
	case "sessionState":
		var p struct {
			Running bool  `json:"running"`
			Cursor  int64 `json:"cursor"`
			HasMore bool  `json:"hasMore"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		a.current.Running = p.Running
		a.current.Cursor = p.Cursor
		a.current.HasMore = p.HasMore
		for i := range a.sessions {
			if a.sessions[i].ID == target.SessionID {
				a.sessions[i].Running = p.Running
			}
		}
	case "pending":
		var p struct {
			Items []interaction `json:"items"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
		a.current.Pending = p.Items
		valid := map[string]bool{}
		for _, p := range p.Items {
			valid[p.ID] = true
		}
		for id := range a.answers {
			if !valid[id] {
				delete(a.answers, id)
			}
		}
	}
	return nil
}
