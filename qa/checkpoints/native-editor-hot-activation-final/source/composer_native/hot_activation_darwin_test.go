//go:build darwin

package composer_native

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestHotActivationAdoptsBindingButNeverReleasesFenceFromHeadersOrReplay(t *testing.T) {
	request, ack, namespace := activationFixture()
	e := &Editor{id: 7, epoch: request.Epoch, docKey: request.DocKey, accountScope: request.AccountScope, revision: 10, activationNamespace: namespace}
	raw, _ := json.Marshal(ack)
	adopted, err := e.adoptHotActivationLocked(request, raw)
	if err != nil || adopted.Epoch != ack.Epoch || e.Valid() {
		t.Fatal("ack is not a body validation", err)
	}
	if e.invalidAfterRevision != 11 || e.activationGeneration != 1 {
		t.Fatal("binding barrier not adopted")
	}
	if _, err = e.adoptHotActivationLocked(request, raw); err == nil || e.Valid() {
		t.Fatal("old ack reactivated")
	}
	e.deliver(Snapshot{ID: 7, Epoch: request.Epoch, DocKey: request.DocKey, AccountScope: request.AccountScope, Revision: 99}, nil)
	if e.Valid() {
		t.Fatal("old callback recovered")
	}
	e.deliver(Snapshot{ID: 7, Epoch: ack.Epoch, DocKey: ack.DocKey, AccountScope: ack.AccountScope, Revision: 11, SemanticRevision: ack.SemanticRevision, SemanticDigest: ack.SemanticDigest}, nil)
	if e.Valid() {
		t.Fatal("ack revision recovered without fresh native body")
	}
	e.deliver(Snapshot{ID: 7, Epoch: ack.Epoch, DocKey: ack.DocKey, AccountScope: ack.AccountScope, Revision: 12, SemanticRevision: ack.SemanticRevision, SemanticDigest: ack.SemanticDigest}, nil)
	if !e.Valid() {
		t.Fatal("fresh valid current frame failed recovery")
	}
	e.closed = true
	e.deliver(Snapshot{}, errors.New("late"))
	if _, err = e.adoptHotActivationLocked(HotActivationRequest{Epoch: ack.Epoch, DocKey: ack.DocKey, AccountScope: ack.AccountScope}, raw); err == nil {
		t.Fatal("closed carrier accepted ack")
	}
}
func TestActualSwiftHotCorpusOversizeInvalidRecoveryAndHighBarrier(t *testing.T) {
	path := os.Getenv("NATIVE_EDITOR_HOT_RESULTS")
	if path == "" {
		t.Skip("run qa/native-editor-hot-next/run.sh and supply NATIVE_EDITOR_HOT_RESULTS")
	}
	var data struct {
		Corpus map[string]json.RawMessage `json:"corpus"`
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	var request HotActivationRequest
	if err = json.Unmarshal(data.Corpus["oversizeRequest"], &request); err != nil {
		t.Fatal(err)
	}
	old, err := DecodeSnapshot(data.Corpus["oldB"])
	if err != nil {
		t.Fatal(err)
	}
	e := &Editor{id: old.ID, epoch: old.Epoch, docKey: old.DocKey, accountScope: old.AccountScope, revision: old.Revision, semanticRevision: old.SemanticRevision, semanticDigest: old.SemanticDigest, activationNamespace: strings.Repeat("a", 32)}
	ack, err := e.adoptHotActivationLocked(request, data.Corpus["oversizeAck"])
	if err != nil || e.Valid() {
		t.Fatal("actual bounded oversized hot ack", err)
	}
	fence, decodeErr := DecodeSnapshot(data.Corpus["oversizeFence"])
	if decodeErr == nil || fence.Revision <= ack.Revision {
		t.Fatal("missing typed higher oversize fence")
	}
	e.deliver(fence, decodeErr)
	if e.Valid() || e.invalidAfterRevision != fence.Revision {
		t.Fatal("oversize native body enabled submission")
	}
	e.deliver(old, nil)
	if e.Valid() {
		t.Fatal("old callback released fence")
	}
	recovered, err := DecodeSnapshot(data.Corpus["validRecovery"])
	if err != nil {
		t.Fatal(err)
	}
	e.deliver(recovered, nil)
	if !e.Valid() {
		t.Fatal("actual native valid recovery failed", e.Error())
	}
	var invalidRequest HotActivationRequest
	_ = json.Unmarshal(data.Corpus["invalidRequest"], &invalidRequest)
	var invalidAck HotActivationAck
	_ = json.Unmarshal(data.Corpus["invalidAck"], &invalidAck)
	invalidEditor := &Editor{id: invalidAck.ID, epoch: invalidRequest.Epoch, docKey: invalidRequest.DocKey, accountScope: invalidRequest.AccountScope, activationNamespace: strings.Repeat("a", 32)}
	if _, err = invalidEditor.adoptHotActivationLocked(invalidRequest, data.Corpus["invalidAck"]); err != nil || invalidEditor.Valid() {
		t.Fatal("invalid hot body ack not bound/fenced", err)
	}
	invalidBody, invalidErr := DecodeSnapshot(data.Corpus["invalidBody"])
	if invalidErr == nil {
		t.Fatal("invalid semantic reference accepted")
	}
	invalidEditor.deliver(invalidBody, invalidErr)
	if invalidEditor.Valid() {
		t.Fatal("invalid source enabled submission")
	}
	var high struct {
		Before  Snapshot `json:"before"`
		After   Snapshot `json:"after"`
		Request struct {
			HotActivationRequest
			AfterRevision uint64 `json:"afterRevision"`
		} `json:"request"`
		Reply json.RawMessage `json:"reply"`
	}
	_ = json.Unmarshal(data.Corpus["highBarrier"], &high)
	highEditor := &Editor{id: high.Before.ID, epoch: high.Before.Epoch, docKey: high.Before.DocKey, accountScope: high.Before.AccountScope, revision: high.Before.Revision, activationNamespace: strings.Repeat("a", 32)}
	highEditor.deliver(Snapshot{ID: high.Before.ID, Epoch: high.Before.Epoch, DocKey: high.Before.DocKey, AccountScope: high.Before.AccountScope, Revision: high.Request.AfterRevision}, errors.New("synthetic high-revision malformed frame"))
	_, err = highEditor.adoptHotActivationLocked(high.Request.HotActivationRequest, high.Reply)
	var rejected *ActivationRejected
	if !errors.As(err, &rejected) || rejected.Code != "STALE_ACTIVATION_REVISION" || highEditor.Valid() || highEditor.invalidAfterRevision != high.Request.AfterRevision || highEditor.docKey != high.Before.DocKey || high.Before.CanonicalText != high.After.CanonicalText {
		t.Fatal("actual native high-barrier rejection changed binding/text or cleared receiver fence", err)
	}
}
