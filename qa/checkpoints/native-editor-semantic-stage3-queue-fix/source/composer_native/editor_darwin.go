//go:build darwin

package composer_native

import (
	"encoding/json"
	"errors"
	"github.com/ebitengine/purego"
	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/native"
	"runtime"
	"sync"
	"sync/atomic"
	"unsafe"
)

type nativeAPI struct {
	create  func(uint64, uintptr) uintptr
	view    func(uintptr) uintptr
	command func(uintptr, unsafe.Pointer, int64) unsafe.Pointer
	length  func(unsafe.Pointer) int64
	free    func(unsafe.Pointer)
	close   func(uintptr)
}

var apiMu sync.Mutex
var apis = map[string]*nativeAPI{}
var registry sync.Map
var nextID atomic.Uint64
var callbackOnce sync.Once
var callbackPointer uintptr

type Editor struct {
	mu                                               sync.Mutex
	id                                               uint64
	owner, view                                      uintptr
	closed                                           bool
	invalid                                          string
	epoch, docKey                                    string
	accountScope                                     string
	revision, semanticRevision, invalidAfterRevision uint64
	semanticDigest                                   string
	api                                              *nativeAPI
	onEvent                                          func(Snapshot)
}

func load(path string) (*nativeAPI, error) {
	apiMu.Lock()
	defer apiMu.Unlock()
	if a := apis[path]; a != nil {
		return a, nil
	}
	h, e := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if e != nil {
		return nil, e
	}
	a := &nativeAPI{}
	purego.RegisterLibFunc(&a.create, h, "nd_editor_create")
	purego.RegisterLibFunc(&a.view, h, "nd_editor_view")
	purego.RegisterLibFunc(&a.command, h, "nd_editor_command")
	purego.RegisterLibFunc(&a.length, h, "nd_editor_length")
	purego.RegisterLibFunc(&a.free, h, "nd_editor_free")
	purego.RegisterLibFunc(&a.close, h, "nd_editor_close")
	apis[path] = a
	return a, nil
}
func New(path string, onEvent func(Snapshot)) (*Editor, error) {
	a, e := load(path)
	if e != nil {
		return nil, e
	}
	callbackOnce.Do(func() {
		callbackPointer = purego.NewCallback(func(id uint64, p unsafe.Pointer, n int64) {
			v, ok := registry.Load(id)
			if !ok {
				return
			}
			editor := v.(*Editor)
			if p == nil || n < 0 || n > MaxJSONBytes {
				editor.deliver(Snapshot{}, errors.New("Native editor content exceeds the synchronized frame budget; original text retained and submission disabled."))
				return
			}
			raw := append([]byte(nil), unsafe.Slice((*byte)(p), int(n))...)
			snapshot, err := DecodeSnapshot(raw)
			editor.deliver(snapshot, err)
		})
	})
	editor := &Editor{api: a, id: nextID.Add(1), onEvent: onEvent}
	registry.Store(editor.id, editor)
	mygo.RunOnMain(func() { editor.owner = a.create(editor.id, callbackPointer); editor.view = a.view(editor.owner) })
	if editor.owner == 0 {
		registry.Delete(editor.id)
		return nil, errors.New("native editor construction failed")
	}
	return editor, nil
}
func (e *Editor) NativeView() uintptr {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return 0
	}
	return e.view
}
func (e *Editor) Apply(command Command) (Snapshot, error) {
	var s Snapshot
	raw, err := json.Marshal(command)
	if err != nil {
		return s, err
	}
	if len(raw) > MaxJSONBytes {
		return s, errors.New("native editor command too large")
	}
	mygo.RunOnMain(func() {
		e.mu.Lock()
		defer e.mu.Unlock()
		defer func() {
			if err != nil && !e.closed && e.invalid != "" {
				s = e.invalidSnapshotLocked()
			}
		}()
		if e.closed {
			err = errors.New("native editor closed")
			return
		}
		p := e.api.command(e.owner, unsafe.Pointer(unsafe.SliceData(raw)), int64(len(raw)))
		runtime.KeepAlive(raw)
		if p == nil {
			err = errors.New("native editor returned no result")
			e.invalid = err.Error()
			e.invalidAfterRevision = max(e.invalidAfterRevision, e.revision)
			return
		}
		defer e.api.free(p)
		n := e.api.length(p)
		if n < 0 || n > MaxJSONBytes {
			err = errors.New("native editor result too large")
			e.invalid = err.Error()
			e.invalidAfterRevision = max(e.invalidAfterRevision, e.revision)
			return
		}
		owned := append([]byte(nil), unsafe.Slice((*byte)(p), int(n))...)
		s, err = DecodeSnapshot(owned)
		if err == nil {
			e.invalid = ""
			e.invalidAfterRevision = 0
			e.epoch = s.Epoch
			e.docKey = s.DocKey
			e.accountScope = s.AccountScope
			e.revision = s.Revision
			e.semanticRevision = s.SemanticRevision
			e.semanticDigest = s.SemanticDigest
		} else {
			e.invalid = err.Error()
			e.invalidAfterRevision = max(e.invalidAfterRevision, e.revision, s.Revision)
		}
	})
	return s, err
}
func (e *Editor) Close() {
	if e == nil {
		return
	}
	mygo.RunOnMain(func() {
		e.mu.Lock()
		if e.closed {
			e.mu.Unlock()
			return
		}
		e.closed = true
		registry.Delete(e.id)
		owner := e.owner
		e.owner = 0
		e.view = 0
		e.onEvent = nil
		e.mu.Unlock()
		e.api.close(owner)
	})
}

// Invalid callbacks explicitly fence submission until a valid frame returns.
func (e *Editor) deliver(s Snapshot, err error) {
	if err == nil && s.Invalid {
		err = errors.New("native draft marked invalid")
	}
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return
	}
	if s.Epoch != "" && (s.Epoch != e.epoch || (s.DocKey != "" && s.DocKey != e.docKey)) {
		e.mu.Unlock()
		return
	}
	if s.AccountScope != "" && e.accountScope != "" && s.AccountScope != e.accountScope {
		e.mu.Unlock()
		return
	}
	if err == nil && (s.Epoch == "" || s.DocKey == "" || s.ID != e.id) {
		err = errors.New("malformed native owner header")
	}
	if err == nil && (s.Revision < e.revision || s.SemanticRevision < e.semanticRevision) {
		e.mu.Unlock()
		return
	}
	if err == nil && s.SemanticRevision == e.semanticRevision && e.semanticDigest != "" && s.SemanticDigest != e.semanticDigest {
		err = errors.New("conflicting native semantic revision")
	}
	if err != nil {
		if s.Revision != 0 && s.Revision < e.revision {
			e.mu.Unlock()
			return
		}
		e.invalid = err.Error()
		e.invalidAfterRevision = max(e.invalidAfterRevision, e.revision, s.Revision)
		// Fence notification, not a replacement draft: carry the maximum
		// known barrier and bound scope through a reordered UI queue.
		s = e.invalidSnapshotLocked()
	} else {
		if e.invalid != "" && s.Revision <= e.invalidAfterRevision {
			e.mu.Unlock()
			return
		}
		e.invalid = ""
		e.invalidAfterRevision = 0
		e.revision = s.Revision
		e.semanticRevision = s.SemanticRevision
		e.semanticDigest = s.SemanticDigest
		if s.AccountScope != "" {
			e.accountScope = s.AccountScope
		}
	}
	fn := e.onEvent
	e.mu.Unlock()
	if fn != nil {
		fn(s)
	}
}

// Caller holds mu. Semantic metadata identifies the last synchronized content;
// no Runs are claimed for the malformed current native document.
func (e *Editor) invalidSnapshotLocked() Snapshot {
	return Snapshot{ID: e.id, Kind: "invalid", Epoch: e.epoch, DocKey: e.docKey, AccountScope: e.accountScope, Revision: e.invalidAfterRevision, SemanticRevision: e.semanticRevision, SemanticDigest: e.semanticDigest, Invalid: true, Error: e.invalid}
}
func (e *Editor) Valid() bool   { e.mu.Lock(); defer e.mu.Unlock(); return !e.closed && e.invalid == "" }
func (e *Editor) Error() string { e.mu.Lock(); defer e.mu.Unlock(); return e.invalid }
