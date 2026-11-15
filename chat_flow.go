package main

// Conversation flow spacing follows the original ChatView CSS: process rows sit
// 4 DIP apart, an Assistant response is separated by 12, and the row after a
// Turn's process control by 16. The list itself contributes no gap.
func chatFlowGap(prev, current chatRow) float32 {
	if prev.ID == "" {
		return 0
	}
	if prev.Running && current.Steering {
		return 0
	}
	if prev.Control {
		return 16
	}
	if prev.Response || current.Response {
		return 12
	}
	return 4
}

// chatRowColumnGap keeps a row's own children in the original rhythm:
// user content 5, Assistant blocks 16, process/control rows no extra gap.
func chatRowColumnGap(row chatRow) float32 {
	switch {
	case row.User:
		return 5
	case row.Control || row.Process:
		if row.Process && row.ProcessSpec == nil {
			// The legacy process disclosure builds its label and body as
			// siblings; keep their 10 DIP rhythm.
			return 10
		}
		return 0
	default:
		return 16
	}
}
