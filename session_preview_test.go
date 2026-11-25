package main

import (
	"strings"
	"testing"
)

func TestLastEventTextPicksTheNewestText(t *testing.T) {
	raw := []byte(`{"records":[
		{"event":{"type":"message/append","data":{"message":{"content":[{"type":"text","text":"older"}]}}}},
		{"event":{"type":"message/append","data":{"message":{"content":[{"type":"text","text":"newest"}]}}}},
		{"event":{"type":"turn/end","data":{}}}
	]}`)
	if got := lastEventText(raw); got != "newest" {
		t.Fatalf("preview = %q", got)
	}
	long := []byte(`{"records":[{"event":{"data":{"text":"` + strings.Repeat("x", 300) + `"}}}]}`)
	if got := lastEventText(long); len([]rune(got)) > 241 || !strings.HasSuffix(got, "…") {
		t.Fatalf("long preview not trimmed: %d", len(got))
	}
}
