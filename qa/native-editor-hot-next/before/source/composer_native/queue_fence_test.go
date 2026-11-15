package composer_native

import (
	"errors"
	"testing"
)

func TestActualInvalidProducerBarrierSurvivesReorderedStoreQueue(t *testing.T) {
	for _, kind := range []string{"known-frame", "headerless", "known-then-headerless"} {
		t.Run(kind, func(t *testing.T) {
			s := NewDocumentStore()
			id := fixtureDocument("queue-account", "h", "s", "main")
			if err := s.Seed(id, []Run{{Kind: "text", Text: "未发送🙂"}}, 0, 0); err != nil {
				t.Fatal(err)
			}
			bound, _ := s.Bind(id, "current")
			base := bound.Snapshot
			base.ID = 77
			base.Revision = 10
			if err := s.Accept(id, "current", base); err != nil {
				t.Fatal(err)
			}
			var queue []Snapshot
			e := &Editor{id: 77, epoch: "current", docKey: id.Key(), accountScope: id.AccountScope, revision: 10, semanticRevision: base.SemanticRevision, semanticDigest: base.SemanticDigest, onEvent: func(s Snapshot) { queue = append(queue, s) }}
			prior := base
			prior.Revision = 11
			e.deliver(prior, nil)
			invalid := base
			invalid.Revision = 12
			if kind != "headerless" {
				e.deliver(invalid, errors.New("malformed current frame"))
			}
			if kind != "known-frame" {
				e.deliver(Snapshot{}, errors.New("headerless current failure"))
			}
			fence := queue[len(queue)-1]
			want := uint64(12)
			if kind == "headerless" {
				want = 11
			}
			if fence.Revision != want || fence.ID != 77 || fence.Epoch != "current" || fence.DocKey != id.Key() || fence.AccountScope != id.AccountScope || fence.SemanticRevision != base.SemanticRevision || fence.SemanticDigest != base.SemanticDigest {
				t.Fatal("invalid producer dropped reliable fence metadata", fence)
			}
			if err := s.Accept(id, "current", fence); err == nil {
				t.Fatal("fence was accepted as replacement draft")
			}
			_ = s.Accept(id, "current", queue[0])
			if _, err := s.Capture(id, "current", nil); err == nil || e.Valid() {
				t.Fatal("reordered prior valid recovered current invalid")
			}
			recovery := base
			recovery.Revision = want + 1
			e.deliver(recovery, nil)
			if !e.Valid() {
				t.Fatal("newer producer recovery failed")
			}
			if err := s.Accept(id, "current", queue[len(queue)-1]); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Capture(id, "current", nil); err != nil {
				t.Fatal(err)
			}
			for _, old := range []Snapshot{{ID: 77, Epoch: "old", DocKey: id.Key(), AccountScope: id.AccountScope, Revision: 100, Error: "old malformed"}, {ID: 77, Epoch: "current", DocKey: id.Key(), AccountScope: "old-account", Revision: 100, Error: "old account malformed"}} {
				if err := s.Accept(id, "current", old); err == nil {
					t.Fatal("old malformed accepted")
				}
				if _, err := s.Capture(id, "current", nil); err != nil {
					t.Fatal("identifiable retired error fenced current valid draft", err)
				}
			}
		})
	}
}
