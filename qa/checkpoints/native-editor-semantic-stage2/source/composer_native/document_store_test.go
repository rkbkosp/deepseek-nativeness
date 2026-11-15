package composer_native

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func fixtureReference(id string) Run {
	return Run{Kind: "reference", Source: "reference", ID: id, Ref: "@file", Label: "file", Appearance: "file", ClipboardText: "@file"}
}
func fixtureDocument(account, host, session, slot string) DocumentID {
	return DocumentID{AccountScope: account, HostID: host, SessionID: session, Slot: slot}
}
func storeSnapshot(t *testing.T, s *DocumentStore, id DocumentID, runs []Run) Snapshot {
	t.Helper()
	d, _ := s.Read(id)
	snapshot := d.Snapshot
	snapshot.Runs = append([]Run(nil), runs...)
	snapshot.DetectText, snapshot.CanonicalText, _ = ProjectRuns(runs)
	snapshot.SemanticDigest, _ = SemanticDigest(runs)
	snapshot.SemanticRevision++
	snapshot.Revision++
	snapshot.SelectionStart = UTF16Len(snapshot.DetectText)
	snapshot.SelectionEnd = snapshot.SelectionStart
	if err := s.Accept(id, d.Epoch, snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestSemanticDigestIsPartitionIndependentButOccurrenceSensitive(t *testing.T) {
	a := []Run{{Kind: "text", Text: "前🙂 "}, fixtureReference("one")}
	b := []Run{{Kind: "text", Text: "前"}, {Kind: "text", Text: "🙂 "}, fixtureReference("one")}
	ha, _ := SemanticDigest(a)
	hb, _ := SemanticDigest(b)
	if ha != hb {
		t.Fatal("attribute-only partition changed semantic digest")
	}
	b[2].ID = "new"
	hc, _ := SemanticDigest(b)
	if hc == ha {
		t.Fatal("same canonical/new occurrence reused digest")
	}
	for _, source := range []string{"", "plugin"} {
		r := fixtureReference("bad")
		r.Source = source
		if _, err := SemanticDigest([]Run{r}); err == nil {
			t.Fatal("unknown owner admitted")
		}
	}
}

func TestGoDigestMatchesActualSwiftSnapshots(t *testing.T) {
	file := os.Getenv("NATIVE_EDITOR_SWIFT_RESULTS")
	if file == "" {
		t.Skip("run with explicit actual AppKit result path")
	}
	raw, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	var result struct {
		Passed        bool
		DigestSamples []struct {
			Runs   []Run
			Digest string
		}
	}
	if e = json.Unmarshal(raw, &result); e != nil {
		t.Fatal(e)
	}
	if !result.Passed || len(result.DigestSamples) < 3 {
		t.Fatal("actual Swift author gates missing")
	}
	for _, sample := range result.DigestSamples {
		hash, e := SemanticDigest(sample.Runs)
		if e != nil || hash != sample.Digest {
			t.Fatalf("Go/Swift semantic protocol diverged: %s %s %v", hash, sample.Digest, e)
		}
	}
}

func TestDocumentStoreRetiresHotStateWithoutLosingUnsentDrafts(t *testing.T) {
	s := NewDocumentStore()
	for i := 0; i < 50; i++ {
		id := fixtureDocument("account", "host", fmt.Sprint(i), "main")
		if err := s.Seed(id, []Run{{Kind: "text", Text: fmt.Sprintf("未发送🙂 %d", i)}, fixtureReference(fmt.Sprint(i))}, 2, 4); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Bind(id, fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	docs, hot := s.Counts()
	if docs != 50 || hot != 50 {
		t.Fatal(docs, hot)
	}
	retired := s.RetireAccount("account")
	docs, hot = s.Counts()
	if docs != 50 || hot != 0 || len(retired) != 50 {
		t.Fatal("retirement deleted semantic content")
	}
	for _, d := range retired {
		restored, e := s.Bind(d.ID, "new-epoch")
		if e != nil || restored.Snapshot.CanonicalText != d.Snapshot.CanonicalText || restored.Snapshot.SelectionStart != 2 || restored.Snapshot.SelectionEnd != 4 {
			t.Fatal("semantic draft or selection lost")
		}
	}
	s.RetireWindow()
	docs, hot = s.Counts()
	if docs != 50 || hot != 0 {
		t.Fatal("window retirement deleted drafts")
	}
}

func TestDocumentStoreIdentityAndQueuedCallbacksAreIsolated(t *testing.T) {
	s := NewDocumentStore()
	ids := []DocumentID{fixtureDocument("a", "host", "same", "main"), fixtureDocument("b", "host", "same", "main"), fixtureDocument("a", "other", "same", "main"), fixtureDocument("a", "host", "same", "queue:item")}
	for i, id := range ids {
		if e := s.Seed(id, []Run{{Kind: "text", Text: fmt.Sprint(i)}}, 0, 0); e != nil {
			t.Fatal(e)
		}
		s.Bind(id, "first")
	}
	old, _ := s.Read(ids[0])
	s.RetireDocument(ids[0])
	s.Bind(ids[0], "second")
	if e := s.Accept(ids[0], "first", old.Snapshot); e == nil {
		t.Fatal("queued old epoch accepted")
	}
	if e := s.Accept(ids[1], "first", old.Snapshot); e == nil {
		t.Fatal("same session crossed account")
	}
	for i, id := range ids {
		d, _ := s.Read(id)
		if d.Snapshot.CanonicalText != fmt.Sprint(i) {
			t.Fatal("retargeted semantic draft")
		}
	}
}

func TestDocumentStoreAcceptedSettlementPreservesSuffixIdentityAndRejectsReplay(t *testing.T) {
	s := NewDocumentStore()
	id := fixtureDocument("a", "h", "s", "main")
	sent := []Run{{Kind: "text", Text: "sent "}, fixtureReference("old")}
	if e := s.Seed(id, sent, 6, 6); e != nil {
		t.Fatal(e)
	}
	s.Bind(id, "epoch")
	ids := []string{"image-old"}
	capture, e := s.Capture(id, ids)
	if e != nil {
		t.Fatal(e)
	}
	ids[0] = "mutated"
	sent[0].Text = "mutated"
	if capture.AttachmentIDs[0] != "image-old" || capture.Runs[0].Text != "sent " {
		t.Fatal("capture aliases live payload")
	}
	fresh := fixtureReference("fresh")
	runs := append(append([]Run(nil), capture.Runs...), Run{Kind: "text", Text: " new "}, fresh)
	storeSnapshot(t, s, id, runs)
	result, e := s.CommitAccepted(AcceptedSettlement{RequestID: "existing-request", Capture: capture})
	if e != nil || !result.Changed || result.Document.Snapshot.CanonicalText != " new @file" || result.Document.Snapshot.Runs[1].ID != "fresh" {
		t.Fatal("fresh suffix lost", result, e)
	}
	duplicate, e := s.CommitAccepted(AcceptedSettlement{RequestID: "existing-request", Capture: capture})
	if e != nil || !duplicate.AlreadySettled || duplicate.Document.Snapshot.CanonicalText != " new @file" {
		t.Fatal("accepted replay altered suffix")
	}
	id2 := fixtureDocument("a", "h", "s2", "main")
	s.Seed(id2, []Run{fixtureReference("old")}, 1, 1)
	s.Bind(id2, "epoch")
	old, _ := s.Capture(id2, nil)
	storeSnapshot(t, s, id2, []Run{fixtureReference("new")})
	preserved, e := s.CommitAccepted(AcceptedSettlement{RequestID: "same-clipboard", Capture: old})
	if e != nil || !preserved.Preserved || preserved.Document.Snapshot.Runs[0].ID != "new" {
		t.Fatal("same clipboard new occurrence cleared")
	}
	storeSnapshot(t, s, id2, []Run{fixtureReference("old")})
	again, _ := s.CommitAccepted(AcceptedSettlement{RequestID: "same-clipboard", Capture: old})
	if !again.AlreadySettled || again.Document.Snapshot.Runs[0].ID != "old" {
		t.Fatal("late duplicate after undo cleared draft")
	}
}

func TestDocumentStoreImageOnlyAndInvalidReferenceNeverClearNewText(t *testing.T) {
	s := NewDocumentStore()
	id := fixtureDocument("a", "h", "s", "main")
	s.Seed(id, nil, 0, 0)
	s.Bind(id, "epoch")
	imageOnly, _ := s.Capture(id, []string{"old-image"})
	storeSnapshot(t, s, id, []Run{{Kind: "text", Text: "new text"}})
	result, e := s.CommitAccepted(AcceptedSettlement{RequestID: "image-request", Capture: imageOnly})
	if e != nil || result.Changed || result.Document.Snapshot.CanonicalText != "new text" {
		t.Fatal("image-only receipt cleared new text")
	}
	r := fixtureReference("invalid")
	r.Invalid = true
	storeSnapshot(t, s, id, []Run{r})
	if _, e := s.Capture(id, nil); e == nil {
		t.Fatal("invalid reference submitted")
	}
}
