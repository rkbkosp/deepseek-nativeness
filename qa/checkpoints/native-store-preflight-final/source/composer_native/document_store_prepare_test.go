package composer_native

import (
	"errors"
	"reflect"
	"testing"
)

func preparedFixture(t *testing.T) (*DocumentStore, DocumentID, AcceptedSettlement) {
	t.Helper()
	s := NewDocumentStore()
	id := fixtureDocument("account", "host", "session", "main")
	runs := []Run{{Kind: "text", Text: "前🙂 "}, fixtureReference("original")}
	if err := s.Seed(id, runs, 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Bind(id, "capture-epoch"); err != nil {
		t.Fatal(err)
	}
	capture, err := s.Capture(id, "capture-epoch", []string{"image-original"})
	if err != nil {
		t.Fatal(err)
	}
	return s, id, AcceptedSettlement{RequestID: "existing-ledger-id", Capture: capture}
}
func prepareMust(t *testing.T, s *DocumentStore, a AcceptedSettlement) AcceptedPreparation {
	t.Helper()
	p, err := s.PrepareAccepted(a)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func assertReadEqual(t *testing.T, s *DocumentStore, id DocumentID, before StoredDocument) {
	t.Helper()
	after, _ := s.Read(id)
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("read-only/rejected action changed draft: before%+v after%+v", before, after)
	}
}

func TestPrepareAcceptedPureReadsAreReusableAndUnusedTicketDoesNotSettle(t *testing.T) {
	s, id, a := preparedFixture(t)
	before, _ := s.Read(id)
	stamp := s.entries[id].mutation
	first, second := prepareMust(t, s, a), prepareMust(t, s, a)
	third := prepareMust(t, s, a)
	for _, p := range []AcceptedPreparation{first, second, third} {
		v := p.Preview()
		if v.AlreadySettled || v.Deferred || !v.Changed || v.RemovedUTF16 != 5 {
			t.Fatal("wrong preparation disposition", v)
		}
		e := p.Expected()
		if e.DocumentID != id || e.Epoch != "capture-epoch" || !e.Hot || e.SemanticDigest != before.Snapshot.SemanticDigest || e.SemanticRevision != before.Snapshot.SemanticRevision || e.SurfaceRevision != before.Snapshot.Revision {
			t.Fatal("missing expected pre-state", e)
		}
	}
	assertReadEqual(t, s, id, before)
	if len(s.entries[id].settled) != 0 || s.entries[id].mutation != stamp {
		t.Fatal("Prepare mutated ledger/stamp")
	}
	// Discard first/third as a caller would after a failed native CAS. second is
	// still actionable: a read cannot invalidate another independent read.
	result, err := s.CommitPreparedAccepted(a, second)
	if err != nil || !result.Changed {
		t.Fatal(result, err)
	}
	if _, err = s.CommitPreparedAccepted(a, first); !errors.Is(err, ErrStaleAcceptedPreparation) {
		t.Fatal("used state accepted old ticket", err)
	}
}

func TestPrepareAcceptedColdRestoreDuplicateSkipsNativeBeforeRetypedDraft(t *testing.T) {
	s, id, a := preparedFixture(t)
	s.RetireDocument(id)
	p := prepareMust(t, s, a)
	if p.Expected().Hot || p.Expected().Epoch != "" {
		t.Fatal("cold ticket bound old capture epoch")
	}
	if result, err := s.CommitPreparedAccepted(a, p); err != nil || !result.Changed {
		t.Fatal(result, err)
	}
	if _, err := s.Bind(id, "new-epoch"); err != nil {
		t.Fatal(err)
	}
	// A retyped occurrence has the same canonical ref, a fresh ID and its own undo.
	runs := append([]Run(nil), a.Capture.Runs...)
	runs[1].ID = "new-occurrence"
	storeSnapshot(t, s, id, runs)
	before, _ := s.Read(id)
	nativeCalls := 0
	p = prepareMust(t, s, a)
	preview := p.Preview()
	if !preview.AlreadySettled || preview.Deferred || preview.Changed {
		t.Fatal("duplicate must win before any native side effect", preview)
	}
	if !preview.AlreadySettled && !preview.Deferred {
		nativeCalls++
	}
	result, err := s.CommitPreparedAccepted(a, p)
	if err != nil || !result.AlreadySettled || nativeCalls != 0 {
		t.Fatal("duplicate reached native", result, err, nativeCalls)
	}
	assertReadEqual(t, s, id, before)
	// Even while the new native document is invalid, a settled receipt remains
	// inert rather than becoming an actionable deferred clear after recovery.
	s.Fence(id, "new-epoch", before.Snapshot.Revision+1, "new invalid")
	if q := prepareMust(t, s, a).Preview(); !q.AlreadySettled || q.Deferred {
		t.Fatal("settled request became deferred", q)
	}
}

func TestPrepareAcceptedMarkedAndInvalidDeferWithoutMarkingSettled(t *testing.T) {
	for _, mode := range []string{"marked", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			s, id, a := preparedFixture(t)
			current, _ := s.Read(id)
			if mode == "invalid" {
				s.Fence(id, "capture-epoch", 3, "malformed")
			} else {
				marked := current.Snapshot
				marked.Revision = 3
				marked.Marked = true
				if err := s.Accept(id, "capture-epoch", marked); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := s.Read(id)
			p := prepareMust(t, s, a)
			if !p.Preview().Deferred || p.Preview().AlreadySettled {
				t.Fatal("unsafe preparation actionable")
			}
			if result, err := s.CommitPreparedAccepted(a, p); err != nil || !result.Deferred {
				t.Fatal(result, err)
			}
			assertReadEqual(t, s, id, before)
			if len(s.entries[id].settled) != 0 {
				t.Fatal("deferred request prematurely settled")
			}
			recovered := current.Snapshot
			recovered.Revision = 4
			if err := s.Accept(id, "capture-epoch", recovered); err != nil {
				t.Fatal(err)
			}
			if _, err := s.CommitPreparedAccepted(a, p); !errors.Is(err, ErrStaleAcceptedPreparation) {
				t.Fatal("pre-recovery ticket survived", err)
			}
			fresh := prepareMust(t, s, a)
			if fresh.Preview().Deferred || !fresh.Preview().Changed {
				t.Fatal("fresh valid remained blocked")
			}
		})
	}
}

func TestPrepareAcceptedFailedNativeCASDoesNotAdvanceStoreOrSettlement(t *testing.T) {
	s, id, a := preparedFixture(t)
	before, _ := s.Read(id)
	p := prepareMust(t, s, a)
	// A native operation reports a CAS failure. No Store commit is called; this
	// local simulation deliberately makes no claim about an AppKit transaction.
	nativeCAS := func(AcceptedVersion) bool { return false }
	if nativeCAS(p.Expected()) {
		t.Fatal("fixture must reject")
	}
	assertReadEqual(t, s, id, before)
	fresh := prepareMust(t, s, a)
	if fresh.Preview().AlreadySettled || fresh.Preview().Deferred || !fresh.Preview().Changed {
		t.Fatal("unused ticket advanced request")
	}
	if result, err := s.CommitPreparedAccepted(a, fresh); err != nil || !result.Changed {
		t.Fatal(result, err)
	}
}

func TestPrepareAcceptedRejectsStaleBindingFenceAndSameDigestABA(t *testing.T) {
	cases := map[string]func(*testing.T, *DocumentStore, DocumentID){
		"same-epoch-bind": func(t *testing.T, s *DocumentStore, id DocumentID) { s.Bind(id, "capture-epoch") },
		"bind":            func(t *testing.T, s *DocumentStore, id DocumentID) { s.Bind(id, "next") },
		"retire":          func(t *testing.T, s *DocumentStore, id DocumentID) { s.RetireDocument(id) },
		"retire-account":  func(t *testing.T, s *DocumentStore, id DocumentID) { s.RetireAccount(id.AccountScope) },
		"retire-window":   func(t *testing.T, s *DocumentStore, id DocumentID) { s.RetireWindow() },
		"marked": func(t *testing.T, s *DocumentStore, id DocumentID) {
			d, _ := s.Read(id)
			d.Snapshot.Marked = true
			d.Snapshot.Revision++
			if err := s.Accept(id, d.Epoch, d.Snapshot); err != nil {
				t.Fatal(err)
			}
		},
		"invalid": func(t *testing.T, s *DocumentStore, id DocumentID) {
			d, _ := s.Read(id)
			s.Fence(id, d.Epoch, 10, "invalid")
		},
		"same-digest-new-revision": func(t *testing.T, s *DocumentStore, id DocumentID) {
			d, _ := s.Read(id)
			d.Snapshot.Revision++
			if err := s.Accept(id, d.Epoch, d.Snapshot); err != nil {
				t.Fatal(err)
			}
		},
		"same-canonical-new-occurrence": func(t *testing.T, s *DocumentStore, id DocumentID) {
			d, _ := s.Read(id)
			d.Snapshot.Runs[1].ID = "new-occurrence"
			storeSnapshot(t, s, id, d.Snapshot.Runs)
		},
		"binding-aba": func(t *testing.T, s *DocumentStore, id DocumentID) { s.RetireDocument(id); s.Bind(id, "capture-epoch") },
		"same-frame-state-accept": func(t *testing.T, s *DocumentStore, id DocumentID) {
			d, _ := s.Read(id)
			if err := s.Accept(id, d.Epoch, d.Snapshot); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			s, id, a := preparedFixture(t)
			p := prepareMust(t, s, a)
			change(t, s, id)
			before, _ := s.Read(id)
			if _, err := s.CommitPreparedAccepted(a, p); !errors.Is(err, ErrStaleAcceptedPreparation) {
				t.Fatal("stale ticket admitted", err)
			}
			assertReadEqual(t, s, id, before)
			if len(s.entries[id].settled) != 0 {
				t.Fatal("stale ticket marked settled")
			}
		})
	}
}

func TestPrepareAcceptedRequestAndFullCaptureAreImmutableBoundaries(t *testing.T) {
	changes := map[string]func(*AcceptedSettlement){
		"request":    func(a *AcceptedSettlement) { a.RequestID = "another" },
		"epoch":      func(a *AcceptedSettlement) { a.Capture.Epoch = "different-capture" },
		"revision":   func(a *AcceptedSettlement) { a.Capture.SemanticRevision++ },
		"document":   func(a *AcceptedSettlement) { a.Capture.DocumentID.SessionID = "other" },
		"canonical":  func(a *AcceptedSettlement) { a.Capture.CanonicalText = "forged" },
		"attachment": func(a *AcceptedSettlement) { a.Capture.AttachmentIDs[0] = "other-image" },
		"runs": func(a *AcceptedSettlement) {
			a.Capture.Runs[1].ID = "new"
			a.Capture.SemanticDigest, _ = SemanticDigest(a.Capture.Runs)
		},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			s, id, a := preparedFixture(t)
			before, _ := s.Read(id)
			p := prepareMust(t, s, a)
			changed := cloneAccepted(a)
			change(&changed)
			if _, err := s.CommitPreparedAccepted(changed, p); !errors.Is(err, ErrStaleAcceptedPreparation) {
				t.Fatal("different capture borrowed ticket", err)
			}
			assertReadEqual(t, s, id, before)
			if result, err := s.CommitPreparedAccepted(a, p); err != nil || !result.Changed {
				t.Fatal("rejected mismatch invalidated original pure ticket", result, err)
			}
		})
	}
}

func TestPrepareAcceptedPreviewAndCallerSlicesCannotMutateCapability(t *testing.T) {
	s, id, a := preparedFixture(t)
	prefix := cloneAccepted(a)
	storeSnapshot(t, s, id, append(append([]Run(nil), a.Capture.Runs...), Run{Kind: "text", Text: " suffix"}, fixtureReference("fresh")))
	p := prepareMust(t, s, a)
	want := p.Preview()
	wantDigest := want.Document.Snapshot.SemanticDigest
	preview := p.Preview()
	preview.Document.Snapshot.Runs[0].Text = "corrupt-preview"
	preview.Document.Snapshot.Runs[1].ID = "corrupt-reference"
	preview.Document.Snapshot.CanonicalText = "corrupt"
	expected := p.Expected()
	expected.SemanticDigest = "corrupt expected"
	// Mutating original capture after preparation must not alias the ticket.
	a.Capture.Runs[0].Text = "corrupt-caller"
	a.Capture.AttachmentIDs[0] = "corrupt-image"
	if _, err := s.CommitPreparedAccepted(a, p); !errors.Is(err, ErrStaleAcceptedPreparation) {
		t.Fatal("caller mutation affected sealed capture", err)
	}
	if got := p.Preview(); got.Document.Snapshot.SemanticDigest != wantDigest || got.Document.Snapshot.Runs[1].ID != "fresh" {
		t.Fatal("preview leaked internal document")
	}
	result, err := s.CommitPreparedAccepted(prefix, p)
	if err != nil || result.Document.Snapshot.CanonicalText != " suffix@file" || result.Document.Snapshot.Runs[1].ID != "fresh" {
		t.Fatal(result, err)
	}
	result.Document.Snapshot.Runs[1].ID = "corrupt-result"
	d, _ := s.Read(id)
	if d.Snapshot.Runs[1].ID != "fresh" {
		t.Fatal("commit result aliases Store")
	}
}

func TestPrepareAcceptedRejectsZeroAndForeignStoreTickets(t *testing.T) {
	s, id, a := preparedFixture(t)
	other, _, otherAccepted := preparedFixture(t)
	foreign := prepareMust(t, other, otherAccepted)
	before, _ := s.Read(id)
	for _, p := range []AcceptedPreparation{{}, foreign} {
		if _, err := s.CommitPreparedAccepted(a, p); !errors.Is(err, ErrStaleAcceptedPreparation) {
			t.Fatal("foreign/unissued ticket admitted", err)
		}
	}
	assertReadEqual(t, s, id, before)
}

func TestPrepareAcceptedConflictAndLegacyCommitCompatibility(t *testing.T) {
	s, id, a := preparedFixture(t)
	if result, err := s.CommitAccepted(a); err != nil || !result.Changed {
		t.Fatal("legacy commit changed", result, err)
	}
	// Existing settled identity remains semantic digest, not a new attachment or
	// capture-epoch ledger; the transport ledger owns wire payload conflicts.
	duplicate := cloneAccepted(a)
	duplicate.Capture.AttachmentIDs = []string{"new-id"}
	duplicate.Capture.Epoch = "later"
	if p := prepareMust(t, s, duplicate); !p.Preview().AlreadySettled {
		t.Fatal("invented new settled identity")
	}
	conflict := cloneAccepted(a)
	conflict.Capture.Runs = []Run{{Kind: "text", Text: "other"}}
	conflict.Capture.SemanticDigest, _ = SemanticDigest(conflict.Capture.Runs)
	before, _ := s.Read(id)
	if _, err := s.PrepareAccepted(conflict); err == nil {
		t.Fatal("same request different semantic payload admitted")
	}
	assertReadEqual(t, s, id, before)
}

func TestPrepareAcceptedOtherDocumentCannotInvalidateThisTicket(t *testing.T) {
	s, id, a := preparedFixture(t)
	p := prepareMust(t, s, a)
	other := fixtureDocument("account", "host", "other", "main")
	if err := s.Seed(other, []Run{{Kind: "text", Text: "unrelated"}}, 0, 0); err != nil {
		t.Fatal(err)
	}
	s.Bind(other, "other-epoch")
	s.Fence(other, "other-epoch", 20, "other invalid")
	s.RetireDocument(other)
	if result, err := s.CommitPreparedAccepted(a, p); err != nil || !result.Changed || result.Document.ID != id {
		t.Fatal("unrelated scope invalidated preparation", result, err)
	}
}
