package main

import (
	"encoding/json"
	"testing"
)

func TestComposerMentionLabelsDedupesQuotedAndPlain(t *testing.T) {
	labels := composerMentionLabels(`看 @a 和 @"b c" 再看 @a`)
	if len(labels) != 2 || labels[0] != "a" || labels[1] != "b c" {
		t.Fatalf("labels = %v", labels)
	}
}

func TestRemoveComposerMentionHandlesQuotedPaths(t *testing.T) {
	if got := removeComposerMention(`看 @a 和 @"b c" 尾巴`, "b c"); got != `看 @a 和 尾巴` {
		t.Fatalf("quoted removal = %q", got)
	}
	if got := removeComposerMention(`看 @a 尾巴`, "a"); got != `看 尾巴` {
		t.Fatalf("plain removal = %q", got)
	}
}

func TestOpenMentionPathSelectsTheDocumentOrDirectory(t *testing.T) {
	a := &app{}
	a.openMentionPath("docs/")
	if !a.rightPaneOpen || a.currentRightPane().Tab != "files" || a.currentRightPane().CurrentDir != "docs" {
		t.Fatalf("directory open = %+v", a.currentRightPane())
	}
	a.openMentionPath("docs/readme.md")
	if a.currentRightPane().Tab != "document" || a.currentRightPane().Selected != "docs/readme.md" {
		t.Fatalf("file open = %+v", a.currentRightPane())
	}
}

func TestComposerFilePartSerializesReceipt(t *testing.T) {
	raw, err := json.Marshal(composerContentPart{Type: "file", ReceiptID: "receipt-1", Name: "a.txt"})
	if err != nil {
		t.Fatal(err)
	}
	var part map[string]any
	if err := json.Unmarshal(raw, &part); err != nil {
		t.Fatal(err)
	}
	if part["type"] != "file" || part["receiptId"] != "receipt-1" {
		t.Fatalf("part = %v", part)
	}
}
