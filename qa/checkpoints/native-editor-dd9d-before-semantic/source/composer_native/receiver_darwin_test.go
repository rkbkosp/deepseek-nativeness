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
	e.deliver(Snapshot{ID: 7, Epoch: "epoch", DocKey: "doc", Kind: "change"}, nil)
	if !e.Valid() || len(events) != 2 || events[1].Invalid {
		t.Fatal("valid recovery failed")
	}
	e.closed = true
	e.deliver(Snapshot{}, errors.New("late"))
	if len(events) != 2 {
		t.Fatal("retired callback touched UI")
	}
}
