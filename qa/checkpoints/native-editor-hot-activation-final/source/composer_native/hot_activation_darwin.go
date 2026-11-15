//go:build darwin

package composer_native

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"runtime"
	"unsafe"
)

type hotActivationCommand struct {
	HotActivationRequest
	Op                           string `json:"op"`
	ID                           uint64 `json:"id"`
	ActivationNamespace          string `json:"activationNamespace"`
	ExpectedActivationGeneration uint64 `json:"expectedActivationGeneration"`
	AfterRevision                uint64 `json:"afterRevision"`
}

func (e *Editor) activationSourceLocked(r HotActivationRequest) bool {
	return !e.closed && r.Epoch == e.epoch && r.DocKey == e.docKey && r.AccountScope == e.accountScope
}
func (e *Editor) adoptHotActivationLocked(r HotActivationRequest, raw []byte) (HotActivationAck, error) {
	if !e.activationSourceLocked(r) {
		return HotActivationAck{}, errors.New("stale hot activation source")
	}
	ack, err := decodeHotActivationAck(raw, e.id, r, e.activationNamespace, e.activationGeneration+1, max(e.revision, e.invalidAfterRevision))
	if err != nil {
		return ack, err
	}
	e.epoch = ack.Epoch
	e.docKey = ack.DocKey
	e.accountScope = ack.AccountScope
	e.revision = ack.Revision
	e.semanticRevision = ack.SemanticRevision
	e.semanticDigest = ack.SemanticDigest
	e.activationGeneration = ack.ActivationGeneration
	e.invalid = "native hot document requires a new validated snapshot"
	e.invalidAfterRevision = ack.Revision
	return ack, nil
}

// ActivateHot restores a native-owned document without providing any body.
// Metadata acknowledgement always leaves submission fenced. On the same UI
// transaction the future adapter must Bind Store to ack.Epoch then Fence at
// ack.Revision before any capture; never pass this acknowledgement to Accept.
func (e *Editor) ActivateHot(request HotActivationRequest) (ack HotActivationAck, err error) {
	if err = request.validate(); err != nil {
		return ack, err
	}
	mygo.RunOnMain(func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		if !e.activationSourceLocked(request) {
			err = errors.New("stale hot activation source")
			return
		}
		if e.activationGeneration == ^uint64(0) {
			err = errors.New("hot activation generation exhausted")
			return
		}
		if e.activationNamespace == "" {
			var nonce [16]byte
			if _, err = rand.Read(nonce[:]); err != nil {
				return
			}
			e.activationNamespace = hex.EncodeToString(nonce[:])
		}
		raw, marshalErr := json.Marshal(hotActivationCommand{HotActivationRequest: request, Op: "activateHot", ID: e.id, ActivationNamespace: e.activationNamespace, ExpectedActivationGeneration: e.activationGeneration, AfterRevision: max(e.revision, e.invalidAfterRevision)})
		if marshalErr != nil {
			err = marshalErr
			return
		}
		if len(raw) > MaxJSONBytes {
			err = errors.New("hot activation command too large")
			return
		}
		p := e.api.command(e.owner, unsafe.Pointer(unsafe.SliceData(raw)), int64(len(raw)))
		runtime.KeepAlive(raw)
		if p == nil {
			err = errors.New("native activation returned no acknowledgement")
		} else {
			defer e.api.free(p)
			n := e.api.length(p)
			if n < 0 || n > MaxActivationAckBytes {
				err = errors.New("native activation acknowledgement too large")
			} else {
				ack, err = e.adoptHotActivationLocked(request, append([]byte(nil), unsafe.Slice((*byte)(p), int(n))...))
			}
		}
		if err != nil {
			var rejection *ActivationRejected
			if !errors.As(err, &rejection) {
				e.invalid = err.Error()
				e.invalidAfterRevision = max(e.invalidAfterRevision, e.revision)
			}
		}
	})
	return ack, err
}
