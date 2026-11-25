package main

import "testing"

func TestActivityGroupDescriptorUsesProcessCategories(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "r", Role: "assistant", Kind: "assistant", AssistantBlocks: []assistantBlock{{Kind: "reasoning", Text: "think"}}},
		{ID: "t", Role: "tool", Kind: "tool", Tool: &toolNode{Name: "bash"}},
	}}
	parts := []chatPartRef{{NodeKey: "r", PayloadID: "r", Part: "reasoning"}, {NodeKey: "t", PayloadID: "t"}}
	title, icon := a.groupDescriptor(parts)
	if title != "执行了命令" || icon != "api-outline" {
		t.Fatalf("descriptor=%q %q", title, icon)
	}
}
