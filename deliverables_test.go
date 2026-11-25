package main

import "testing"

func TestTurnDeliverablePathsDedupesMutations(t *testing.T) {
	a := &app{current: snapshot{Messages: []message{
		{Turn: 1, Tool: &toolNode{Name: "write", Phase: "settled", ArgsRaw: `{"file_path":"/tmp/a.txt","content":"x"}`}},
		{Turn: 1, Tool: &toolNode{Name: "edit", Phase: "settled", ArgsRaw: `{"file_path":"/tmp/a.txt","old_string":"x","new_string":"y"}`}},
		{Turn: 1, Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":"ls"}`}},
		{Turn: 2, Tool: &toolNode{Name: "write", Phase: "settled", ArgsRaw: `{"file_path":"/tmp/b.txt","content":"z"}`}},
	}}}
	paths := a.turnDeliverablePaths(1)
	if len(paths) != 1 || paths[0] != "/tmp/a.txt" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestPresentedByTurnReadsDeliveryEvents(t *testing.T) {
	raw := []byte(`{"records":[
		{"event":{"type":"deliverables/presented","data":{"turn":2,"callId":"c1","files":[{"path":"out/a.md","description":"报告"}]}}},
		{"event":{"type":"message/append","data":{}}},
		{"event":{"type":"deliverables/presented","data":{"turn":0,"callId":"c2","files":[{"path":"bad"}]}}}
	]}`)
	got := presentedByTurn(raw)
	if len(got[2]) != 1 || got[2][0].Path != "out/a.md" || got[2][0].Description != "报告" {
		t.Fatalf("presented = %+v", got)
	}
	if len(got[0]) != 0 {
		t.Fatalf("malformed turn accepted: %+v", got[0])
	}
}
