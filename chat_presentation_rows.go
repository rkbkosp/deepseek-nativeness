package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
)

// These small references are the only objects duplicated for split reasoning /
// response rows. Strings, rich blocks and attachments remain in the arena.
type chatPartRef struct {
	NodeKey   string
	PayloadID string
	Part      string
	AnchorSeq float64
	Turn      int
	Step      int
	cachedKey string
	Terminal  bool
}

func (p chatPartRef) key() string {
	if p.cachedKey != "" {
		return p.cachedKey
	}
	return fmt.Sprintf("%q:%s", p.NodeKey, p.Part)
}
func (a *app) chatPartMessage(p chatPartRef) *message {
	if a.messageIndex == nil {
		a.reindexMessages()
	}
	i, ok := a.messageIndex[p.PayloadID]
	if !ok || i < 0 || i >= len(a.current.Messages) {
		return nil
	}
	return &a.current.Messages[i]
}
func (a *app) chatPartView(c *ui.Context, p chatPartRef) {
	if m := a.chatPartMessage(p); m != nil {
		a.messagePartViewTerminal(c.Key(p.key()), *m, p.Part, p.NodeKey, &p.Terminal)
	}
}
func (a *app) presentedChatRows() []chatRow {
	messages := a.current.Messages
	if len(messages) == 0 {
		a.chatRowsCache = nil
		return nil
	}
	cache := a.chatRowsCache
	samePolicy := cache != nil && cache.presented && cache.collapse == a.uiPrefs.StepsCollapse && cache.detail == a.uiPrefs.StepsDetail && cache.replies == a.uiPrefs.FoldedReplies
	if samePolicy && cache.revision == a.chatStructureRevision && cache.running == a.current.Running {
		return cache.rows
	}
	if !samePolicy {
		cache = &chatRowsCache{presented: true, turnRows: map[int][]chatRow{}, idsByTurn: map[int][]string{}, dirtyTurns: map[int]bool{}, indexDirty: true, rowStarts: map[string][]chatRow{}, rowEnds: map[string][]chatRow{}, segments: map[string]int{}, layoutPositions: map[string]int{}}
	}
	cache.collapse = a.uiPrefs.StepsCollapse
	cache.detail = a.uiPrefs.StepsDetail
	cache.replies = a.uiPrefs.FoldedReplies
	index := a.presentationIndex()
	if cache.indexDirty {
		for turn, ids := range cache.idsByTurn {
			cache.idsByTurn[turn] = ids[:0]
		}
		cache.turnOrder = cache.turnOrder[:0]
		cache.lastUser = -1
		cache.layoutIDs = a.presentationLayoutIDs(index, cache.layoutIDs)
		clear(cache.layoutPositions)
		segment, previousTurn := 0, -1
		for i, id := range cache.layoutIDs {
			m := &messages[a.messageIndex[id]]
			cache.layoutPositions[id] = i
			turn := m.Turn
			if key, ok := index.payloads[m.ID]; ok {
				turn = a.current.ChatPresentation.Steps[index.steps[key]].Turn
			}
			if i > 0 && turn != previousTurn {
				segment++
			}
			if old, ok := cache.segments[m.ID]; !ok || old != segment {
				cache.dirtyTurns[turn] = true
			}
			cache.segments[m.ID] = segment
			previousTurn = turn
			if len(cache.idsByTurn[turn]) == 0 {
				cache.turnOrder = append(cache.turnOrder, turn)
			}
			cache.idsByTurn[turn] = append(cache.idsByTurn[turn], m.ID)
			if m.Role == "user" && m.Kind != "context" {
				cache.lastUser = i
			}
		}
		for id := range cache.segments {
			if _, ok := cache.layoutPositions[id]; !ok {
				delete(cache.segments, id)
				delete(cache.rowStarts, id)
				delete(cache.rowEnds, id)
			}
		}
		// Structural payload transitions can move or insert ordinary nodes. Their
		// ID-only index is rebuilt once; unchanged Turn rows remain reusable.
		for turn := range cache.idsByTurn {
			if !samePolicy || cache.collapse == "next-input" {
				cache.dirtyTurns[turn] = true
			}
		}
	}
	if !samePolicy || cache.running != a.current.Running {
		for turn := range cache.idsByTurn {
			cache.dirtyTurns[turn] = true
		}
	}
	for turn := range cache.dirtyTurns {
		for _, row := range cache.turnRows[turn] {
			id := row.PositionPayloadID
			if len(row.Parts) > 0 {
				id = row.Parts[0].PayloadID
			}
			bucket := cache.rowStarts
			if row.PositionAfter {
				bucket = cache.rowEnds
			}
			bucket[id] = bucket[id][:0]
		}
		rows := a.buildPresentationTurnRows(turn, cache.idsByTurn[turn], cache, index)
		cache.turnRows[turn] = rows
		for _, row := range rows {
			id := row.PositionPayloadID
			if len(row.Parts) > 0 {
				id = row.Parts[0].PayloadID
			}
			bucket := cache.rowStarts
			if row.PositionAfter {
				bucket = cache.rowEnds
			}
			bucket[id] = append(bucket[id], row)
		}
	}
	clear(cache.dirtyTurns)
	cache.rows = cache.rows[:0]
	for _, id := range cache.layoutIDs {
		cache.rows = append(cache.rows, cache.rowStarts[id]...)
		cache.rows = append(cache.rows, cache.rowEnds[id]...)
	}
	cache.visible = cache.visible[:0]
	for _, row := range cache.rows {
		if row.Control && row.ProcessStatus != "closed" {
			continue
		}
		if row.Process && !a.turnProcessIsOpen(row) {
			continue
		}
		cache.visible = append(cache.visible, row)
	}
	cache.indexDirty = false
	cache.revision = a.chatStructureRevision
	cache.running = a.current.Running
	cache.first = &messages[0]
	cache.length = len(messages)
	a.chatRowsCache = cache
	return cache.rows
}
func (a *app) buildPresentationTurnRows(turn int, ids []string, cache *chatRowsCache, index *chatPresentationIndex) []chatRow {
	p := a.current.ChatPresentation
	t, known := chatTurn{}, false
	if i, ok := index.turns[turn]; ok {
		t = p.Turns[i]
		known = true
	}
	type item struct {
		ref              chatPartRef
		assistant, input bool
		barrier          bool
	}
	items := make([]item, 0, len(ids)*2)
	previousSegment := -1
	for _, id := range ids {
		i, ok := a.messageIndex[id]
		if !ok {
			continue
		}
		m := &a.current.Messages[i]
		segment := cache.segments[id]
		barrier := previousSegment != segment
		if key, ok := index.payloads[id]; ok {
			step := p.Steps[index.steps[key]]
			ref := chatPartRef{NodeKey: step.NodeKey, PayloadID: step.PayloadID, AnchorSeq: step.AnchorSeq, Turn: step.Turn, Step: step.Step}
			if step.HasReasoning {
				ref.Part = "reasoning"
				ref.Terminal = (m.Interrupted || step.Status == "interrupted") && !assistantHasRawResponseBlock(m)
				ref.cachedKey = index.partKey(ref.NodeKey, ref.Part)
				items = append(items, item{ref: ref, assistant: true, barrier: barrier})
				barrier = false
				previousSegment = segment
			}
			if step.HasReply || m.Interrupted && !step.HasReasoning {
				ref.Part = "response"
				ref.Terminal = m.Interrupted || step.Status == "interrupted"
				ref.cachedKey = index.partKey(ref.NodeKey, ref.Part)
				items = append(items, item{ref: ref, assistant: true, barrier: barrier})
				previousSegment = segment
			}
			continue
		}
		if m.Kind == "attempt" || m.Role == "assistant" {
			continue
		}
		items = append(items, item{ref: chatPartRef{NodeKey: m.ID, PayloadID: m.ID, AnchorSeq: float64(m.Seq), Turn: turn, Step: m.Step, cachedKey: index.partKey(m.ID, "")}, input: m.Role == "user" && m.Kind != "context", barrier: barrier})
		previousSegment = segment
	}
	rows := make([]chatRow, 0, len(items))
	partsArena := make([]chatPartRef, 0, len(items))
	pendingStart := -1
	always := t.AlwaysOpen || t.Status == "open" || !t.FoldEligible || t.HasInterleavedInput || t.Spec == nil || t.EndReasonKind == "aborted" || t.EndReasonKind == "interrupted" || t.EndReasonKind == "error"
	open := always || cache.detail == "verbose"
	if cache.collapse == "next-input" && len(ids) > 0 {
		open = open || cache.layoutPositions[ids[len(ids)-1]] >= cache.lastUser
	}
	answerStep := 0
	if t.Spec != nil && t.Spec.AnswerStep != nil {
		answerStep = *t.Spec.AnswerStep
	}
	foldKey := fmt.Sprintf("%s\x00turn:%d:answer:%d", a.viewKey(a.sessionID), turn, answerStep)
	var duration *float64
	if t.StartTime != nil && t.EndTime != nil {
		d := max(1000, *t.EndTime-*t.StartTime)
		duration = &d
	}
	control := chatRow{ID: fmt.Sprintf("12:turn-process%d", turn), Control: true, Turn: turn, DefaultOpen: open, AlwaysOpen: always, FoldKey: foldKey, ProcessSpec: t.Spec, ProcessReason: string(t.EndReasonKind), ProcessStatus: t.Status, ProcessDuration: duration}
	hasControl := known && t.Spec != nil
	controlAdded := false
	if hasControl {
		control.LayoutAnchor = t.Spec.ControlAnchorSeq - .1
	}
	ready := known && t.Spec != nil && t.FoldEligible && cache.detail != "verbose"
	flush := func(before string) {
		if pendingStart < 0 {
			return
		}
		pending := partsArena[pendingStart:]
		groupable := true
		for _, part := range pending {
			if part.Part == "response" {
				groupable = false
				break
			}
		}
		if ready && groupable {
			group := chatRow{ID: "group:" + pending[0].key(), Process: true, Group: true, GroupParts: append([]chatPartRef(nil), pending...), Turn: turn,
				PositionPayloadID: pending[0].PayloadID, DefaultOpen: false, AlwaysOpen: always, FoldKey: foldKey, ProcessSpec: t.Spec,
				ProcessReason: string(t.EndReasonKind), ProcessStatus: t.Status, ProcessDuration: duration}
			rows = append(rows, group)
		} else {
			for i := range pending {
				part := pending[i]
				rows = append(rows, chatRow{ID: part.key(), Process: true, Turn: turn, Parts: pending[i : i+1], DefaultOpen: open, AlwaysOpen: always, FoldKey: foldKey, ProcessSpec: t.Spec, ProcessReason: string(t.EndReasonKind), ProcessStatus: t.Status, ProcessDuration: duration})
			}
		}
		pendingStart = -1
	}
	for _, it := range items {
		r := it.ref
		if it.barrier {
			flush(r.key())
		}
		if hasControl && !controlAdded && r.AnchorSeq >= control.LayoutAnchor {
			flush("controller")
			control.PositionPayloadID = r.PayloadID
			rows = append(rows, control)
			controlAdded = true
		}
		process := false
		if ready && !it.input {
			s := t.Spec
			process = r.AnchorSeq >= s.ProcessStartSeq && (s.AnswerAnchorSeq == nil || r.AnchorSeq < *s.AnswerAnchorSeq || (r.Part == "reasoning" && s.AnswerStep != nil && r.Step == *s.AnswerStep))
			if it.assistant && r.Part == "response" && cache.replies == "all" {
				process = false
			}
		}
		if !it.assistant {
			if m := a.chatPartMessage(r); m != nil && m.Role == "assistant" {
				process = false
			}
		}
		if process {
			if pendingStart < 0 {
				pendingStart = len(partsArena)
			}
			partsArena = append(partsArena, r)
		} else {
			flush(r.key())
			start := len(partsArena)
			partsArena = append(partsArena, r)
			row := chatRow{ID: r.key(), Turn: turn, Parts: partsArena[start : start+1]}
			if it.assistant && r.Part == "response" {
				row.Response = true
			}
			if it.input {
				row.User = true
			}
			rows = append(rows, row)
		}
	}
	flush("tail")
	if kind := string(t.EndReasonKind); kind == "error" || kind == "max-tokens" || kind == "max_tokens" {
		notice := chatRow{ID: fmt.Sprintf("notice:%d", turn), Notice: true, Turn: turn, NoticeKind: kind}
		if detail := a.turnErrorDetail(turn); detail != "" {
			notice.NoticeText = detail
		}
		if len(ids) > 0 {
			notice.PositionPayloadID = ids[len(ids)-1]
			notice.PositionAfter = true
		}
		rows = append(rows, notice)
	}
	if hasControl && !controlAdded && len(ids) > 0 {
		control.PositionPayloadID = ids[len(ids)-1]
		control.PositionAfter = true
		rows = append(rows, control)
	}
	canCollapse := false
	for _, row := range rows {
		if row.Process && (len(row.Parts) > 0 || len(row.GroupParts) > 0) {
			canCollapse = true
			break
		}
	}
	for i := range rows {
		if rows[i].Control {
			rows[i].CanCollapse = canCollapse && t.FoldEligible && cache.detail != "verbose"
		}
	}
	return rows
}
