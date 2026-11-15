package composer_native

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func activationFixture() (HotActivationRequest, HotActivationAck, string) {
	namespace := strings.Repeat("a", 32)
	request := HotActivationRequest{Epoch: "old", DocKey: "B", AccountScope: "account", TargetDocKey: "A", TargetAccountScope: "account"}
	ack := HotActivationAck{Kind: "hotActivated", ID: 7, Epoch: activationEpoch(namespace, 1), DocKey: "A", AccountScope: "account", Revision: 11, SemanticRevision: 2, SemanticDigest: strings.Repeat("b", 64), ActivationGeneration: 1, RequiresSnapshot: true}
	return request, ack, namespace
}
func TestHotActivationAcknowledgementIsBoundedStrictAndNeverAValidatedBody(t *testing.T) {
	request, ack, namespace := activationFixture()
	raw, _ := json.Marshal(ack)
	emptyDigest, _ := SemanticDigest(nil)
	empty := ack
	empty.SemanticDigest = emptyDigest
	emptyRaw, _ := json.Marshal(empty)
	if _, err := DecodeSnapshot(emptyRaw); err == nil {
		t.Fatal("metadata-only hot acknowledgement decoded as an empty document")
	}
	if _, err := decodeHotActivationAck(raw, 7, request, namespace, 1, 10); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*HotActivationAck){func(a *HotActivationAck) { a.ID++ }, func(a *HotActivationAck) { a.Epoch = "old" }, func(a *HotActivationAck) { a.DocKey = "other" }, func(a *HotActivationAck) { a.AccountScope = "other" }, func(a *HotActivationAck) { a.ActivationGeneration = 0 }, func(a *HotActivationAck) { a.Revision = 10 }, func(a *HotActivationAck) { a.SemanticDigest = "bad" }, func(a *HotActivationAck) { a.RequiresSnapshot = false }} {
		bad := ack
		mutate(&bad)
		payload, _ := json.Marshal(bad)
		if _, err := decodeHotActivationAck(payload, 7, request, namespace, 1, 10); err == nil {
			t.Fatal("bad ack admitted", string(payload))
		}
	}
	for _, payload := range [][]byte{append(raw, []byte(` {}`)...), []byte(strings.Repeat(" ", MaxActivationAckBytes+1)), []byte(`{"kind":"hotActivated","runs":[]}`)} {
		if _, err := decodeHotActivationAck(payload, 7, request, namespace, 1, 10); err == nil {
			t.Fatal("unbounded or non-ack body admitted")
		}
	}
	for _, bad := range []HotActivationRequest{{TargetDocKey: "A", TargetAccountScope: ""}, {TargetDocKey: strings.Repeat("k", 2049), TargetAccountScope: "account"}, {TargetDocKey: "A", TargetAccountScope: "bad\naccount"}} {
		if err := bad.validate(); err == nil {
			t.Fatal("bad identity admitted")
		}
	}
}
func TestOnlyKnownPureNativeRejectionsPermitMissingColdPath(t *testing.T) {
	r, _, namespace := activationFixture()
	for _, code := range []string{"HOT_DOCUMENT_MISSING", "HOT_DOCUMENT_ACCOUNT_MISMATCH", "STALE_ACTIVATION_SOURCE", "STALE_ACTIVATION_REVISION"} {
		raw, _ := json.Marshal(map[string]any{"error": code})
		_, err := decodeHotActivationAck(raw, 7, r, namespace, 1, 10)
		var rejected *ActivationRejected
		if !errors.As(err, &rejected) {
			t.Fatal("known before-mutation error lost", err)
		}
		if errors.Is(err, ErrHotDocumentMissing) != (code == "HOT_DOCUMENT_MISSING") {
			t.Fatal("unsafe cold fallback", code)
		}
	}
	for _, raw := range []string{`{"error":"FUTURE_POST_MUTATION_ERROR"}`, `{"error":"HOT_DOCUMENT_MISSING","id":7}`} {
		_, err := decodeHotActivationAck([]byte(raw), 7, r, namespace, 1, 10)
		var rejected *ActivationRejected
		if err == nil || errors.As(err, &rejected) || errors.Is(err, ErrHotDocumentMissing) {
			t.Fatal("unproven rejection classified safe", raw, err)
		}
	}
}
