package main

// Rows reference the current message arena rather than copying historical
// message structs on each text delta. Structural changes invalidate this cache;
// in-place text/streaming updates remain visible through those slices.
type chatRowsCache struct {
	first                     *message
	length                    int
	revision                  uint64
	running                   bool
	activeTurn                int
	collapse, detail, replies string
	rows                      []chatRow
	// Groups with skipped tool-only assistant records keep indices, so their
	// small non-contiguous projection can be refreshed without history copies.
	gathered []chatGather
}
type chatGather struct {
	row     int
	indices []int
}

func (a *app) invalidateChatRows() { a.chatStructureRevision++; a.chatRowsCache = nil }
func assistantHasVisibleContent(m *message) bool {
	if m.Text != "" || m.Reasoning != "" || m.ReasoningDisplay != "" {
		return true
	}
	for _, b := range m.AssistantBlocks {
		if b.Kind != "tool-call" {
			return true
		}
	}
	return false
}
func (a *app) chatRows() []chatRow {
	messages := a.current.Messages
	if len(messages) == 0 {
		a.chatRowsCache = nil
		return nil
	}
	cached := a.chatRowsCache
	if cached != nil && cached.first == &messages[0] && cached.length == len(messages) && cached.revision == a.chatStructureRevision && cached.running == a.current.Running && cached.collapse == a.uiPrefs.StepsCollapse && cached.detail == a.uiPrefs.StepsDetail && cached.replies == a.uiPrefs.FoldedReplies {
		for _, group := range cached.gathered {
			for index, source := range group.indices {
				cached.rows[group.row].Messages[index] = messages[source]
			}
		}
		return cached.rows
	}
	next := &chatRowsCache{first: &messages[0], length: len(messages), revision: a.chatStructureRevision, running: a.current.Running, collapse: a.uiPrefs.StepsCollapse, detail: a.uiPrefs.StepsDetail, replies: a.uiPrefs.FoldedReplies, rows: make([]chatRow, 0, len(messages))}
	activeTurn, lastUser := 0, -1
	lastAssistant := map[int]int{}
	for i := len(messages) - 1; i >= 0; i-- {
		m := &messages[i]
		activeTurn = max(activeTurn, m.Turn)
		if m.Role == "user" && m.Kind != "context" && lastUser < 0 {
			lastUser = i
		}
		if m.Role == "assistant" && m.Text != "" {
			if _, exists := lastAssistant[m.Turn]; !exists {
				lastAssistant[m.Turn] = i
			}
		}
	}
	for _, event := range a.current.Trajectory {
		activeTurn = max(activeTurn, event.Turn)
	}
	next.activeTurn = activeTurn
	groupStart, previous := -1, -2
	var group *chatGather
	for index := range messages {
		m := &messages[index]
		if m.Role == "assistant" && !assistantHasVisibleContent(m) {
			continue
		}
		process := m.Kind == "tool" || m.Kind == "context" || m.Kind == "compaction" || m.Kind == "command" || m.Kind == "retry" || m.Kind == "turn-trigger"
		if next.replies == "final" && m.Role == "assistant" && lastAssistant[m.Turn] != index {
			process = true
		}
		if process && len(next.rows) > 0 && next.rows[len(next.rows)-1].Process && next.rows[len(next.rows)-1].Turn == m.Turn {
			row := &next.rows[len(next.rows)-1]
			if group == nil && previous+1 == index {
				row.Messages = messages[groupStart : index+1]
			} else {
				if group == nil {
					next.gathered = append(next.gathered, chatGather{row: len(next.rows) - 1})
					group = &next.gathered[len(next.gathered)-1]
					for j := groupStart; j <= previous; j++ {
						group.indices = append(group.indices, j)
					}
					row.Messages = append([]message(nil), row.Messages...)
				}
				group.indices = append(group.indices, index)
				row.Messages = append(row.Messages, *m)
			}
		} else {
			open := next.running && m.Turn == activeTurn
			if next.collapse == "next-input" {
				open = index >= lastUser
			}
			if next.detail == "verbose" {
				open = true
			}
			id := m.ID
			if process {
				id = "process:" + id
			}
			next.rows = append(next.rows, chatRow{ID: id, Process: process, Messages: messages[index : index+1], Turn: m.Turn, DefaultOpen: process && open})
			groupStart = index
			group = nil
		}
		previous = index
	}
	a.chatRowsCache = next
	return next.rows
}
