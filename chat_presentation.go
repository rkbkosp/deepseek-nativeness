package main

import (
	"encoding/json"
	"fmt"
	"math"
)

// Layout anchors may be synthetic fractions. They never substitute for durable
// event sequences or committed message IDs used by business actions.
type chatPresentation struct {
	BaselineSerial       uint64     `json:"baselineSerial"`
	PresentationEpoch    string     `json:"presentationEpoch"`
	SchemaVersion        int        `json:"schemaVersion"`
	PresentationRevision uint64     `json:"presentationRevision"`
	Turns                []chatTurn `json:"turns"`
	Steps                []chatStep `json:"steps"`
}
type chatTurn struct {
	StartTime           *float64         `json:"startTime,omitempty"`
	EndTime             *float64         `json:"endTime,omitempty"`
	FoldEligible        bool             `json:"foldEligible"`
	Turn                int              `json:"turn"`
	Status              string           `json:"status"`
	StartLoaded         bool             `json:"startLoaded"`
	LatestStep          *int             `json:"latestStep"`
	Spec                *chatProcessSpec `json:"spec"`
	HasInterleavedInput bool             `json:"hasInterleavedInput"`
	EndReasonKind       chatEndReason    `json:"endReasonKind"`
	AlwaysOpen          bool             `json:"alwaysOpen"`
}
type chatEndReason string

func (r chatEndReason) MarshalJSON() ([]byte, error) {
	if r == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(r))
}

type chatFrameHeader struct {
	SessionID            string  `json:"sessionId"`
	BaselineSerial       uint64  `json:"baselineSerial"`
	PresentationEpoch    string  `json:"presentationEpoch"`
	PresentationRevision *uint64 `json:"presentationRevision"`
}

func (a *app) admitChatFrame(header chatFrameHeader) (bool, error) {
	if header.SessionID != a.sessionID {
		return false, nil
	}
	p := a.current.ChatPresentation
	if p == nil {
		return true, nil
	}
	if header.BaselineSerial == 0 || header.PresentationEpoch == "" || header.PresentationRevision == nil {
		return false, fmt.Errorf("远程增量缺少对话结构版本，请重新打开会话")
	}
	if header.BaselineSerial < p.BaselineSerial {
		return false, nil
	}
	if header.BaselineSerial > p.BaselineSerial {
		return false, fmt.Errorf("远程对话结构缺少新基线，请重新打开会话")
	}
	if header.PresentationEpoch != p.PresentationEpoch || *header.PresentationRevision < p.PresentationRevision {
		return false, nil
	}
	if *header.PresentationRevision > p.PresentationRevision {
		return false, fmt.Errorf("远程对话结构增量不连续，请重新打开会话")
	}
	return true, nil
}

type chatProcessSpec struct {
	Turn             int      `json:"turn"`
	ControlAnchorSeq float64  `json:"controlAnchorSeq"`
	ProcessStartSeq  float64  `json:"processStartSeq"`
	AnswerAnchorSeq  *float64 `json:"answerAnchorSeq"`
	AnswerStep       *int     `json:"answerStep"`
	InlineReasoning  bool     `json:"inlineReasoning"`
	MessageCount     int      `json:"messageCount"`
	ToolCallCount    int      `json:"toolCallCount"`
	SubagentCount    int      `json:"subagentCount"`
}
type chatStep struct {
	NodeKey            string          `json:"nodeKey"`
	Turn               int             `json:"turn"`
	Step               int             `json:"step"`
	PayloadID          string          `json:"payloadId"`
	Status             string          `json:"status"`
	AnchorSeq          float64         `json:"anchorSeq"`
	FinalEventSeq      *int64          `json:"finalEventSeq"`
	CommittedMessageID json.RawMessage `json:"committedMessageId,omitempty"`
	HasReply           bool            `json:"hasReply"`
	HasReasoning       bool            `json:"hasReasoning"`
	HasToolCall        bool            `json:"hasToolCall"`
}
type chatPayloadUpsert struct {
	Message message `json:"message"`
	Index   int     `json:"index"`
}
type chatPresentationPatch struct {
	TimelineTurnUpserts  []json.RawMessage `json:"timelineTurnUpserts,omitempty"`
	BaselineSerial       uint64            `json:"baselineSerial"`
	PresentationEpoch    string            `json:"presentationEpoch"`
	SessionID            string            `json:"sessionId"`
	SchemaVersion        int               `json:"schemaVersion"`
	BaseRevision         uint64            `json:"baseRevision"`
	PresentationRevision uint64            `json:"presentationRevision"`
	TurnUpserts          []chatTurn        `json:"turnUpserts"`
	TurnRemoves          []int             `json:"turnRemoves"`
	StepUpserts          []chatStep        `json:"stepUpserts"`
	StepRemoves          []string          `json:"stepRemoves"`
	PayloadChanges       struct {
		Upserts []chatPayloadUpsert `json:"upserts"`
		Removes []string            `json:"removes"`
		Deltas  []chatMessageDelta  `json:"deltas"`
	} `json:"payloadChanges"`
}

func finiteAnchor(value float64) bool { return !math.IsInf(value, 0) && !math.IsNaN(value) }
func validateChatPresentation(p *chatPresentation, payloads map[string]bool) error {
	if p == nil {
		return nil
	}
	if p.SchemaVersion != 1 || p.PresentationEpoch == "" || p.BaselineSerial == 0 {
		return fmt.Errorf("远程对话结构版本无效，请重新打开会话")
	}
	turns := map[int]bool{}
	for _, turn := range p.Turns {
		if turns[turn.Turn] {
			return fmt.Errorf("远程对话轮次重复")
		}
		turns[turn.Turn] = true
		if turn.Status != "open" && turn.Status != "closed" && turn.Status != "partial" {
			return fmt.Errorf("远程对话轮次状态无效")
		}
		if s := turn.Spec; s != nil && (!finiteAnchor(s.ControlAnchorSeq) || !finiteAnchor(s.ProcessStartSeq) || (s.AnswerAnchorSeq != nil && !finiteAnchor(*s.AnswerAnchorSeq))) {
			return fmt.Errorf("远程对话布局锚点无效")
		}
	}
	keys := map[string]bool{}
	ids := map[string]bool{}
	for _, step := range p.Steps {
		if step.NodeKey == "" || step.PayloadID == "" || keys[step.NodeKey] || ids[step.PayloadID] || !turns[step.Turn] || !payloads[step.PayloadID] || !finiteAnchor(step.AnchorSeq) {
			return fmt.Errorf("远程对话内容引用无效，请重新打开会话")
		}
		keys[step.NodeKey] = true
		ids[step.PayloadID] = true
	}
	return nil
}

// A metadata transaction first validates against a virtual arena; no message
// bodies or historical block arrays are copied just to reject a stale frame.
func (a *app) applyChatPresentationPatch(raw json.RawMessage) error {
	var patch chatPresentationPatch
	if err := json.Unmarshal(raw, &patch); err != nil {
		return err
	}
	if patch.SessionID != a.sessionID {
		return nil
	}
	before := a.current.ChatPresentation
	if before == nil {
		return fmt.Errorf("远程对话结构缺少基线，请重新打开会话")
	}
	if patch.BaselineSerial == 0 || patch.PresentationEpoch == "" {
		return fmt.Errorf("远程对话结构增量缺少基线版本，请重新打开会话")
	}
	if patch.BaselineSerial < before.BaselineSerial {
		return nil
	}
	if patch.BaselineSerial > before.BaselineSerial {
		return fmt.Errorf("远程对话结构缺少新基线，请重新打开会话")
	}
	if patch.PresentationEpoch != before.PresentationEpoch {
		return nil
	}
	if patch.PresentationRevision <= before.PresentationRevision {
		return nil
	}
	if patch.SchemaVersion != 1 || patch.BaseRevision != before.PresentationRevision || patch.PresentationRevision != patch.BaseRevision+1 {
		return fmt.Errorf("远程对话结构增量不连续，请重新打开会话")
	}
	if a.messageIndex == nil {
		a.reindexMessages()
	}
	index := a.presentationIndex()
	turnUpserts := map[int]chatTurn{}
	turnRemoves := map[int]bool{}
	stepUpserts := map[string]chatStep{}
	stepRemoves := map[string]bool{}
	payloadUpserts := map[string]*message{}
	payloadRemoves := map[string]bool{}
	dirty := map[int]bool{}
	timelineIDs := make([]int, len(patch.TimelineTurnUpserts))
	timelineSeen := map[int]bool{}
	for i, raw := range patch.TimelineTurnUpserts {
		var row struct {
			Turn *int `json:"turn"`
		}
		if json.Unmarshal(raw, &row) != nil || row.Turn == nil || timelineSeen[*row.Turn] {
			return fmt.Errorf("远程时间线轮次数据无效")
		}
		timelineIDs[i] = *row.Turn
		timelineSeen[*row.Turn] = true
	}
	for _, id := range patch.TurnRemoves {
		turnRemoves[id] = true
		dirty[id] = true
	}
	for _, id := range patch.StepRemoves {
		stepRemoves[id] = true
		if i, ok := index.steps[id]; ok {
			dirty[before.Steps[i].Turn] = true
		}
	}
	for _, id := range patch.PayloadChanges.Removes {
		payloadRemoves[id] = true
		if i, ok := a.messageIndex[id]; ok {
			dirty[a.current.Messages[i].Turn] = true
		}
	}
	for i := range patch.PayloadChanges.Upserts {
		u := &patch.PayloadChanges.Upserts[i]
		if u.Message.ID == "" || payloadUpserts[u.Message.ID] != nil {
			return fmt.Errorf("远程消息标识无效或重复")
		}
		payloadUpserts[u.Message.ID] = &u.Message
		dirty[u.Message.Turn] = true
		if i, ok := a.messageIndex[u.Message.ID]; ok {
			dirty[a.current.Messages[i].Turn] = true
		}
	}
	turnExists := func(id int) bool {
		if _, ok := turnUpserts[id]; ok {
			return true
		}
		if turnRemoves[id] {
			return false
		}
		_, ok := index.turns[id]
		return ok
	}
	payloadExists := func(id string) bool {
		if payloadUpserts[id] != nil {
			return true
		}
		if payloadRemoves[id] {
			return false
		}
		_, ok := a.messageIndex[id]
		return ok
	}
	for _, t := range patch.TurnUpserts {
		if _, duplicate := turnUpserts[t.Turn]; duplicate {
			return fmt.Errorf("远程对话轮次重复")
		}
		if t.Status != "open" && t.Status != "closed" && t.Status != "partial" {
			return fmt.Errorf("远程对话轮次状态无效")
		}
		if p := t.Spec; p != nil && (!finiteAnchor(p.ControlAnchorSeq) || !finiteAnchor(p.ProcessStartSeq) || (p.AnswerAnchorSeq != nil && !finiteAnchor(*p.AnswerAnchorSeq))) {
			return fmt.Errorf("远程对话布局锚点无效")
		}
		turnUpserts[t.Turn] = t
		dirty[t.Turn] = true
	}
	for _, step := range patch.StepUpserts {
		if step.NodeKey == "" || step.PayloadID == "" || !finiteAnchor(step.AnchorSeq) || !turnExists(step.Turn) || !payloadExists(step.PayloadID) {
			return fmt.Errorf("远程对话内容引用无效，请重新打开会话")
		}
		if _, duplicate := stepUpserts[step.NodeKey]; duplicate {
			return fmt.Errorf("远程对话内容引用重复")
		}
		stepUpserts[step.NodeKey] = step
		dirty[step.Turn] = true
		if i, ok := index.steps[step.NodeKey]; ok {
			dirty[before.Steps[i].Turn] = true
		}
	}
	for _, step := range patch.StepUpserts {
		if key, ok := index.payloads[step.PayloadID]; ok && key != step.NodeKey && !stepRemoves[key] {
			if replacement, changed := stepUpserts[key]; !changed || replacement.PayloadID == step.PayloadID {
				return fmt.Errorf("远程对话内容引用重复")
			}
		}
		for _, other := range patch.StepUpserts {
			if other.NodeKey != step.NodeKey && other.PayloadID == step.PayloadID {
				return fmt.Errorf("远程对话内容引用重复")
			}
		}
	}
	for id := range payloadRemoves {
		if payloadExists(id) {
			continue
		}
		if key, ok := index.payloads[id]; ok && !stepRemoves[key] {
			if replacement, changed := stepUpserts[key]; !changed || replacement.PayloadID == id {
				return fmt.Errorf("远程消息仍被对话结构引用，请重新打开会话")
			}
		}
	}
	for turn := range turnRemoves {
		if turnExists(turn) {
			continue
		}
		for key := range index.turnSteps[turn] {
			if !stepRemoves[key] {
				if replacement, changed := stepUpserts[key]; !changed || replacement.Turn == turn {
					return fmt.Errorf("远程对话轮次仍被内容引用")
				}
			}
		}
	}
	for _, delta := range patch.PayloadChanges.Deltas {
		m := payloadUpserts[delta.MessageID]
		if m == nil {
			if i, ok := a.messageIndex[delta.MessageID]; ok && payloadExists(delta.MessageID) {
				m = &a.current.Messages[i]
			}
		}
		if m == nil {
			return fmt.Errorf("远程增量缺少消息基线，请重新打开会话")
		}
		if err := validateChatMessageDelta(m, delta); err != nil {
			return err
		}
	}
	// Admission is complete. The following in-place operations cannot fail and
	// remain invisible until the containing main-thread UI update finishes.
	for i, raw := range patch.TimelineTurnUpserts {
		turn := timelineIDs[i]
		if slot, ok := index.timeline[turn]; ok {
			a.current.Turns[slot] = raw
		} else {
			index.timeline[turn] = len(a.current.Turns)
			a.current.Turns = append(a.current.Turns, raw)
		}
	}
	if len(payloadRemoves) > 0 {
		kept := a.current.Messages[:0]
		for _, m := range a.current.Messages {
			if !payloadRemoves[m.ID] {
				kept = append(kept, m)
			}
		}
		clear(a.current.Messages[len(kept):])
		a.current.Messages = kept
		a.reindexMessages()
	}
	for _, u := range patch.PayloadChanges.Upserts {
		a.upsertMessage(u.Message, u.Index)
	}
	for _, delta := range patch.PayloadChanges.Deltas {
		appendChatMessageDelta(&a.current.Messages[a.messageIndex[delta.MessageID]], delta)
	}
	next := *before
	if len(turnRemoves) > 0 {
		kept := next.Turns[:0]
		for _, t := range next.Turns {
			if !turnRemoves[t.Turn] {
				kept = append(kept, t)
			}
		}
		clear(next.Turns[len(kept):])
		next.Turns = kept
		clear(index.turns)
		for i, t := range next.Turns {
			index.turns[t.Turn] = i
		}
	}
	for _, t := range patch.TurnUpserts {
		if i, ok := index.turns[t.Turn]; ok {
			next.Turns[i] = t
		} else {
			index.turns[t.Turn] = len(next.Turns)
			next.Turns = append(next.Turns, t)
		}
	}
	for key := range stepRemoves {
		if i, ok := index.steps[key]; ok {
			index.removeStep(before.Steps[i])
			delete(index.partKeys, chatPartKey{key, "reasoning"})
			delete(index.partKeys, chatPartKey{key, "response"})
		}
	}
	for key := range stepUpserts {
		if i, ok := index.steps[key]; ok && !stepRemoves[key] {
			index.removeStep(before.Steps[i])
		}
	}
	if len(stepRemoves) > 0 {
		kept := next.Steps[:0]
		for _, s := range next.Steps {
			if !stepRemoves[s.NodeKey] {
				kept = append(kept, s)
			}
		}
		clear(next.Steps[len(kept):])
		next.Steps = kept
		clear(index.steps)
		for i, s := range next.Steps {
			index.steps[s.NodeKey] = i
		}
	}
	for _, step := range patch.StepUpserts {
		if i, ok := index.steps[step.NodeKey]; ok {
			next.Steps[i] = step
		} else {
			index.steps[step.NodeKey] = len(next.Steps)
			next.Steps = append(next.Steps, step)
		}
		index.addStep(step)
	}
	next.PresentationRevision = patch.PresentationRevision
	a.current.ChatPresentation = &next
	index.owner = &next
	a.invalidateChatTurns(dirty, len(patch.PayloadChanges.Upserts) > 0 || len(patch.PayloadChanges.Removes) > 0 || len(patch.StepUpserts) > 0 || len(patch.StepRemoves) > 0)
	return nil
}

func (a *app) upsertMessage(m message, position int) {
	if a.messageIndex == nil {
		a.reindexMessages()
	}
	if index, ok := a.messageIndex[m.ID]; ok {
		target := max(0, min(position, len(a.current.Messages)-1))
		if target < index {
			copy(a.current.Messages[target+1:index+1], a.current.Messages[target:index])
		} else if target > index {
			copy(a.current.Messages[index:target], a.current.Messages[index+1:target+1])
		}
		a.current.Messages[target] = m
		if target == index {
			return
		}
	} else {
		index := max(0, min(position, len(a.current.Messages)))
		a.current.Messages = append(a.current.Messages, message{})
		copy(a.current.Messages[index+1:], a.current.Messages[index:])
		a.current.Messages[index] = m
		if index == len(a.current.Messages)-1 {
			a.messageIndex[m.ID] = index
			return
		}
	}
	a.reindexMessages()
}
