package main

import "testing"

func TestJobListStatusAcceptsBothWrappers(t *testing.T) {
	if status, ok := jobListStatus([]byte(`[{"id":"j1","status":"running"}]`), "j1"); !ok || status != "running" {
		t.Fatalf("array = %q %v", status, ok)
	}
	if status, ok := jobListStatus([]byte(`{"jobs":[{"jobId":"j2","status":"done"}]}`), "j2"); !ok || status != "done" {
		t.Fatalf("wrapper = %q %v", status, ok)
	}
	if _, ok := jobListStatus([]byte(`[]`), "j3"); ok {
		t.Fatal("missing job reported")
	}
}
