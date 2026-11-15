//go:build darwin

package composer_native

import (
	"errors"
	"testing"
)

func TestInvalidNativeFrameIsObservableAndFencesSubmissionUntilRecovery(t *testing.T) {
	var events []Snapshot
	e := &Editor{id: 7, epoch: "epoch", docKey: "doc", onEvent: func(s Snapshot) { events = append(events, s) }}
	e.deliver(Snapshot{}, errors.New("oversize or malformed"))
	if e.Valid() || len(events) != 1 || !events[0].Invalid || events[0].DocKey != "doc" {
		t.Fatal("bad callback silently left valid old mirror")
	}
	e.deliver(Snapshot{ID: 7, Epoch: "epoch", DocKey: "doc", Kind: "change", Revision: 1}, nil)
	if !e.Valid() || len(events) != 2 || events[1].Invalid {
		t.Fatal("valid recovery failed")
	}
	e.closed = true
	e.deliver(Snapshot{}, errors.New("late"))
	if len(events) != 2 {
		t.Fatal("retired callback touched UI")
	}
}

func TestOldEpochOrRevisionCannotReleaseCurrentInvalidFence(t *testing.T) {
	var events []Snapshot
	e := &Editor{id: 7, epoch: "current", docKey: "doc", revision: 10, semanticRevision: 3, semanticDigest: "digest", onEvent: func(s Snapshot) { events = append(events, s) }}
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 11}, errors.New("malformed-current-frame"))
	for _, s := range []Snapshot{{ID: 7, Epoch: "old", DocKey: "doc", Revision: 100, SemanticRevision: 4, SemanticDigest: "other"}, {ID: 7, Epoch: "current", DocKey: "doc", Revision: 10, SemanticRevision: 3, SemanticDigest: "digest"}, {ID: 7, Epoch: "current", DocKey: "doc", Revision: 11, SemanticRevision: 3, SemanticDigest: "digest"}} {
		e.deliver(s, nil)
		if e.Valid() {
			t.Fatal("stale valid released invalid fence")
		}
	}
	if len(events) != 1 {
		t.Fatal("stale events reached adapter")
	}
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 12, SemanticRevision: 3, SemanticDigest: "digest"}, nil)
	if !e.Valid() || len(events) != 2 {
		t.Fatal("new valid current frame could not recover")
	}
	e.deliver(Snapshot{ID: 7, Epoch: "old", DocKey: "doc", Revision: 100}, errors.New("stale-malformed"))
	if !e.Valid() {
		t.Fatal("old invalid fenced new scope")
	}
	e.deliver(Snapshot{}, errors.New("oversize-no-safe-header"))
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 12, SemanticRevision: 3, SemanticDigest: "digest"}, nil)
	if e.Valid() {
		t.Fatal("cached same-revision frame released oversize fence")
	}
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 13, SemanticRevision: 2, SemanticDigest: "older-content"}, nil)
	if e.Valid() {
		t.Fatal("old semantic revision released oversize fence")
	}
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 14, SemanticRevision: 3, SemanticDigest: "digest"}, nil)
	if !e.Valid() {
		t.Fatal("new current valid recovery failed")
	}
}

func TestInvalidFenceNeverRegressesOnOlderOrHeaderlessMalformedFrame(t *testing.T) {
	e := &Editor{id: 7, epoch: "current", docKey: "doc", revision: 5, semanticRevision: 1, semanticDigest: "digest"}
	for _, revision := range []uint64{10, 9, 0} {
		e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: revision}, errors.New("invalid"))
		if e.invalidAfterRevision != 10 {
			t.Fatal("invalid fence regressed", e.invalidAfterRevision)
		}
	}
	for _, revision := range []uint64{6, 9, 10} {
		e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: revision, SemanticRevision: 1, SemanticDigest: "digest"}, nil)
		if e.Valid() {
			t.Fatal("valid older than retained fence recovered")
		}
	}
	e.deliver(Snapshot{ID: 7, Epoch: "current", DocKey: "doc", Revision: 11, SemanticRevision: 1, SemanticDigest: "digest"}, nil)
	if !e.Valid() {
		t.Fatal("genuinely newer recovery failed")
	}
}
