package main

import "testing"

func TestScheduleSessionCounts(t *testing.T) {
	counts := scheduleSessionCounts([]scheduleRecord{
		{ID: "a", SessionID: "s1"},
		{ID: "b", SessionID: "s1"},
		{ID: "c", SessionID: "s2"},
		{ID: "d"},
	})
	if counts["s1"] != 2 || counts["s2"] != 1 || len(counts) != 2 {
		t.Fatalf("counts = %v", counts)
	}
}
