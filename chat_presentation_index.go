package main

import (
	"encoding/json"
	"fmt"
)

// Session-local metadata indexes. They own only small placement records and
// references; no duplicate assistant text, blocks or raw event journal.
type chatPresentationIndex struct {
	owner     *chatPresentation
	turns     map[int]int
	steps     map[string]int
	payloads  map[string]string
	turnSteps map[int]map[string]bool
	partKeys  map[chatPartKey]string
	timeline  map[int]int
}
type chatPartKey struct{ node, part string }

func (x *chatPresentationIndex) partKey(node, part string) string {
	key := chatPartKey{node, part}
	if value, ok := x.partKeys[key]; ok {
		return value
	}
	value := fmt.Sprintf("%q:%s", node, part)
	x.partKeys[key] = value
	return value
}

func (a *app) presentationIndex() *chatPresentationIndex {
	p := a.current.ChatPresentation
	if index := a.chatPresentationIndex; index != nil && index.owner == p {
		return index
	}
	index := &chatPresentationIndex{owner: p, turns: map[int]int{}, steps: map[string]int{}, payloads: map[string]string{}, turnSteps: map[int]map[string]bool{}, partKeys: map[chatPartKey]string{}, timeline: map[int]int{}}
	for i, raw := range a.current.Turns {
		var row struct {
			Turn int `json:"turn"`
		}
		if json.Unmarshal(raw, &row) == nil {
			index.timeline[row.Turn] = i
		}
	}
	for i, t := range p.Turns {
		index.turns[t.Turn] = i
	}
	for i, s := range p.Steps {
		index.steps[s.NodeKey] = i
		index.addStep(s)
	}
	a.chatPresentationIndex = index
	return index
}
func (x *chatPresentationIndex) addStep(s chatStep) {
	x.payloads[s.PayloadID] = s.NodeKey
	if x.turnSteps[s.Turn] == nil {
		x.turnSteps[s.Turn] = map[string]bool{}
	}
	x.turnSteps[s.Turn][s.NodeKey] = true
}
func (x *chatPresentationIndex) removeStep(s chatStep) {
	delete(x.payloads, s.PayloadID)
	delete(x.turnSteps[s.Turn], s.NodeKey)
}
