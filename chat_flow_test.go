package main

import "testing"

func TestChatFlowGapMatchesOriginalRhythm(t *testing.T) {
	process := chatRow{ID: "process", Process: true}
	response := chatRow{ID: "response", Response: true}
	control := chatRow{ID: "control", Control: true}
	user := chatRow{ID: "user", User: true}
	cases := []struct {
		name string
		prev chatRow
		cur  chatRow
		want float32
	}{
		{"first", chatRow{}, process, 0},
		{"process-process", process, process, 4},
		{"process-response", process, response, 12},
		{"response-process", response, process, 12},
		{"response-response", response, response, 12},
		{"control-response", control, response, 16},
		{"user-process", user, process, 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := chatFlowGap(tc.prev, tc.cur); got != tc.want {
				t.Fatalf("gap=%v want %v", got, tc.want)
			}
		})
	}
	if gap := chatRowColumnGap(user); gap != 5 {
		t.Fatalf("user column gap=%v", gap)
	}
	if gap := chatRowColumnGap(response); gap != 16 {
		t.Fatalf("response column gap=%v", gap)
	}
	if gap := chatRowColumnGap(process); gap != 10 {
		t.Fatalf("legacy process column gap=%v", gap)
	}
	presentationProcess := process
	presentationProcess.ProcessSpec = &chatProcessSpec{}
	if gap := chatRowColumnGap(presentationProcess); gap != 0 {
		t.Fatalf("presentation process column gap=%v", gap)
	}
}
