package main

import (
	"encoding/json"
	"fmt"
)

func (a *app) replaceSnapshot(s snapshot) bool {
	if before := a.current.ChatPresentation; before != nil && a.current.SessionID == s.SessionID {
		if s.ChatPresentation == nil {
			a.error = "远程对话结构缺少基线版本，请重新打开会话"
			return false
		}
		if s.ChatPresentation.BaselineSerial <= before.BaselineSerial {
			return false
		}
	}
	if s.ChatPresentation != nil {
		payloads := map[string]bool{}
		for _, m := range s.Messages {
			payloads[m.ID] = true
		}
		if err := validateChatPresentation(s.ChatPresentation, payloads); err != nil {
			a.error = err.Error()
			return false
		}
	}
	a.invalidateChatRows()
	a.current = s
	a.sessionID = s.SessionID
	if a.sessionOpening == s.SessionID {
		a.sessionOpening = ""
	}
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
	return true
}
func (a *app) reindexMessages() {
	a.messageIndex = make(map[string]int, len(a.current.Messages))
	for i, m := range a.current.Messages {
		a.messageIndex[m.ID] = i
	}
}

func (a *app) applyIncremental(method string, raw json.RawMessage) error {
	var target chatFrameHeader
	if err := json.Unmarshal(raw, &target); err != nil {
		return err
	}
	if target.SessionID != a.sessionID {
		return nil
	}
	if method != "chatPresentationPatch" {
		if accepted, err := a.admitChatFrame(target); err != nil || !accepted {
			return err
		}
	}
	if a.current.ChatPresentation != nil && (method == "messageUpsert" || method == "messageRemove") {
		return fmt.Errorf("远程对话内容更新缺少原子结构事务，请重新打开会话")
	}
	if a.messageIndex == nil {
		a.reindexMessages()
	}
	switch method {
	case "chatPresentationPatch":
		return a.applyChatPresentationPatch(raw)
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
		if a.current.ChatPresentation == nil && a.chatRowsCache != nil && p.Event.Turn > a.chatRowsCache.activeTurn {
			a.invalidateChatRows()
		}
		for i, v := range a.current.Trajectory {
			if v.ID == p.Event.ID {
				if a.current.ChatPresentation == nil && a.chatRowsCache != nil && v.Turn == a.chatRowsCache.activeTurn && p.Event.Turn < v.Turn {
					a.invalidateChatRows()
				}
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
			if a.current.ChatPresentation == nil && a.chatRowsCache != nil && v.Turn == a.chatRowsCache.activeTurn && containsID(p.IDs, v.ID) {
				a.invalidateChatRows()
			}
			if !containsID(p.IDs, v.ID) {
				kept = append(kept, v)
			}
		}
		clear(a.current.Trajectory[len(kept):])
		a.current.Trajectory = kept
	case "messageUpsert":
		a.invalidateChatRows()
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
			target := max(0, min(p.Index, len(a.current.Messages)-1))
			if target < index {
				copy(a.current.Messages[target+1:index+1], a.current.Messages[target:index])
			} else if target > index {
				copy(a.current.Messages[index:target], a.current.Messages[index+1:target+1])
			}
			a.current.Messages[target] = p.Message
			if index != target {
				a.reindexMessages()
			}
		} else {
			index := max(0, min(p.Index, len(a.current.Messages)))
			a.current.Messages = append(a.current.Messages, message{})
			copy(a.current.Messages[index+1:], a.current.Messages[index:])
			a.current.Messages[index] = p.Message
			a.reindexMessages()
		}
	case "messageRemove":
		a.invalidateChatRows()
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
		var p chatMessageDelta
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}

		index, ok := a.messageIndex[p.MessageID]
		if !ok {
			return fmt.Errorf("远程增量缺少消息基线，请重新打开会话")
		}
		m := &a.current.Messages[index]
		if err := validateChatMessageDelta(m, p); err != nil {
			return err
		}
		wasVisible, hadText := assistantHasVisibleContent(m), m.Text != ""
		appendChatMessageDelta(m, p)
		if a.current.ChatPresentation == nil && (wasVisible != assistantHasVisibleContent(m) || hadText != (m.Text != "")) {
			a.invalidateChatRows()
		}
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
