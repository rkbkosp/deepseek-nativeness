package main

import "sort"

// The arena remains in durable/source order. Only assistant references have
// independent (possibly fractional) layout positions; unpositioned tool heads
// never acquire a fabricated zero-sequence anchor.
func (a *app) presentationLayoutIDs(index *chatPresentationIndex, reuse []string) []string {
	type baseNode struct {
		id       string
		original int
	}
	type assistantNode struct {
		id       string
		anchor   float64
		original int
	}
	base := make([]baseNode, 0, len(a.current.Messages))
	var refs []assistantNode
	var knownPositions []int
	var prefixMax []int64
	for i := range a.current.Messages {
		m := &a.current.Messages[i]
		if key, ok := index.payloads[m.ID]; ok {
			step := a.current.ChatPresentation.Steps[index.steps[key]]
			refs = append(refs, assistantNode{m.ID, step.AnchorSeq, i})
			continue
		}
		if m.Role == "assistant" {
			continue
		}
		position := len(base)
		base = append(base, baseNode{m.ID, i})
		if m.seqPresent || m.Seq != 0 {
			knownPositions = append(knownPositions, position)
			maximum := m.Seq
			if len(prefixMax) > 0 {
				maximum = max(maximum, prefixMax[len(prefixMax)-1])
			}
			prefixMax = append(prefixMax, maximum)
		}
	}
	buckets := make(map[int][]assistantNode)
	for _, ref := range refs {
		next := sort.Search(len(prefixMax), func(i int) bool { return float64(prefixMax[i]) > ref.anchor })
		left, right := -1, len(base)
		if next > 0 {
			left = knownPositions[next-1]
		}
		if next < len(knownPositions) {
			right = knownPositions[next]
		}
		position := left + 1 + sort.Search(right-left-1, func(i int) bool { return base[left+1+i].original > ref.original })
		buckets[position] = append(buckets[position], ref)
	}
	out := reuse[:0]
	for i := 0; i <= len(base); i++ {
		refs := buckets[i]
		if len(refs) > 1 {
			sort.SliceStable(refs, func(i, j int) bool {
				if refs[i].anchor == refs[j].anchor {
					return refs[i].original < refs[j].original
				}
				return refs[i].anchor < refs[j].anchor
			})
		}
		for _, ref := range refs {
			out = append(out, ref.id)
		}
		if i < len(base) {
			out = append(out, base[i].id)
		}
	}
	return out
}
