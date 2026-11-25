package main

import "testing"

func TestQuoteMessageFormatsEveryLine(t *testing.T) {
	a := &app{}
	a.quoteMessage("first\nsecond")
	if a.draft != "> first\n> second\n\n" {
		t.Fatalf("draft = %q", a.draft)
	}
}

func TestQuoteMessageTextReadsAssistantBlocks(t *testing.T) {
	m := message{AssistantBlocks: []assistantBlock{{Kind: "text", Text: " hello "}}}
	if got := quoteMessageText(m); got != "hello" {
		t.Fatalf("quote = %q", got)
	}
}
