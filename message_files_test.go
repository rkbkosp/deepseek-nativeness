package main

import "testing"

func TestMessageFileReferencesSkipsImages(t *testing.T) {
	m := message{Blocks: []byte(`[
		{"type":"file","attachment":{"attachmentId":"a1","name":"notes.pdf","mediaType":"application/pdf","bytes":2048}},
		{"type":"image","attachment":{"attachmentId":"a2","name":"shot.png","mediaType":"image/png","width":10,"height":10,"bytes":100}}
	]`)}
	refs := messageFileReferences(m)
	if len(refs) != 1 || refs[0].Name != "notes.pdf" {
		t.Fatalf("file refs = %+v", refs)
	}
	if got := formatFileBytes(refs[0].Bytes); got != "2.0 KB" {
		t.Fatalf("size = %q", got)
	}
}

func TestMessageFileReferencesReadsAssistantBlocks(t *testing.T) {
	m := message{AssistantBlocks: []assistantBlock{{
		Kind:       "file",
		Attachment: []byte(`{"attachmentId":"a3","name":"report.csv","mediaType":"text/csv","bytes":0}`),
	}}}
	refs := messageFileReferences(m)
	if len(refs) != 1 || refs[0].Name != "report.csv" {
		t.Fatalf("assistant file refs = %+v", refs)
	}
}
