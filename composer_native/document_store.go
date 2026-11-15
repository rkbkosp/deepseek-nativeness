package composer_native

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"slices"
	"sync"
)

// DocumentID is stable content identity, deliberately excluding transport and
// navigation generations. A window adapter supplies a fresh callback epoch.
type DocumentID struct{ AccountScope, HostID, SessionID, Slot string }

func (id DocumentID) Key() string {
	raw, _ := json.Marshal(id)
	return base64.RawURLEncoding.EncodeToString(raw)
}
func (id DocumentID) valid() bool {
	return id.AccountScope != "" && id.HostID != "" && id.SessionID != "" && id.Slot != ""
}

type StoredDocument struct {
	ID       DocumentID
	Snapshot Snapshot
	Epoch    string
	Hot      bool
}
type SubmissionCapture struct {
	DocumentID       DocumentID
	Epoch            string
	SemanticRevision uint64
	SemanticDigest   string
	Runs             []Run
	CanonicalText    string
	AttachmentIDs    []string
}

// AcceptedSettlement carries an ID from the existing send ledger. The store
// never generates requests, retries transport, or judges remote acceptance.
type AcceptedSettlement struct {
	RequestID string
	Capture   SubmissionCapture
}
type CommitResult struct {
	Document                           StoredDocument
	Changed, Preserved, AlreadySettled bool
	Deferred                           bool
	RemovedUTF16                       int
}

// AcceptedVersion identifies the current local document that a preparation
// observed, not the older epoch in the submitted capture. Selection/style
// frame changes may conservatively require preparing again.
type AcceptedVersion struct {
	DocumentID                        DocumentID
	Epoch                             string
	Hot                               bool
	SurfaceRevision, SemanticRevision uint64
	SemanticDigest                    string
	FenceAfter                        uint64
	Invalid, Marked                   bool
	Error                             string
}

// AcceptedPreparation is a read-only, local CAS capability. It owns no native
// side effects and is not registered in another ledger or ticket table. Its
// fields are private so a caller cannot alter the captured request or preview.
type AcceptedPreparation struct {
	store    *DocumentStore
	entry    *storedEntry
	mutation uint64
	expected AcceptedVersion
	accepted AcceptedSettlement
	preview  CommitResult
}

func (p AcceptedPreparation) Expected() AcceptedVersion { return p.expected }
func (p AcceptedPreparation) Preview() CommitResult {
	result := p.preview
	result.Document = cloneDocument(result.Document)
	return result
}

var ErrStaleAcceptedPreparation = errors.New("stale or mismatched accepted preparation")

type storedEntry struct {
	StoredDocument
	settled    map[string]string
	fenceAfter uint64
	// A causal scalar catches ABA binding/fence transitions even if their
	// visible revisions/digest return to the same values. It is not a ledger.
	mutation uint64
}
type DocumentStore struct {
	mu      sync.Mutex
	entries map[DocumentID]*storedEntry
}

func NewDocumentStore() *DocumentStore              { return &DocumentStore{entries: map[DocumentID]*storedEntry{}} }
func cloneSnapshot(s Snapshot) Snapshot             { s.Runs = append([]Run(nil), s.Runs...); return s }
func cloneDocument(d StoredDocument) StoredDocument { d.Snapshot = cloneSnapshot(d.Snapshot); return d }

// Seed never overwrites an existing unsent semantic document.
func (s *DocumentStore) Seed(id DocumentID, runs []Run, start, end int) error {
	if !id.valid() {
		return errors.New("incomplete document identity")
	}
	normalized, e := NormalizeRuns(runs)
	if e != nil {
		return e
	}
	d, c, e := ProjectRuns(normalized)
	if e != nil {
		return e
	}
	if start < 0 || end < start || end > UTF16Len(d) || !IsUTF16Boundary(d, start) || !IsUTF16Boundary(d, end) {
		return errors.New("invalid UTF16 selection")
	}
	digest, _ := SemanticDigest(normalized)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries[id] != nil {
		return errors.New("semantic document already exists")
	}
	s.entries[id] = &storedEntry{StoredDocument: StoredDocument{ID: id, Snapshot: Snapshot{Kind: "snapshot", DocKey: id.Key(), AccountScope: id.AccountScope, Runs: normalized, DetectText: d, CanonicalText: c, SemanticRevision: 1, SemanticDigest: digest, SelectionStart: start, SelectionEnd: end}}, settled: map[string]string{}, mutation: 1}
	return nil
}
func (s *DocumentStore) Bind(id DocumentID, epoch string) (StoredDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil || epoch == "" {
		return StoredDocument{}, errors.New("missing document or callback epoch")
	}
	if entry.Hot && entry.Epoch == epoch {
		// Even an idempotent bind ends an earlier preparation window. It
		// still must not clear the invalid fence or replace native semantics.
		entry.mutation++
		return cloneDocument(entry.StoredDocument), nil
	}
	entry.Epoch = epoch
	entry.Hot = true
	entry.Snapshot.Epoch = epoch
	entry.Snapshot.Revision = 0
	entry.fenceAfter = 0
	entry.mutation++
	return cloneDocument(entry.StoredDocument), nil
}
func (s *DocumentStore) Accept(id DocumentID, epoch string, snapshot Snapshot) error {
	// Identifiable retired frames stay inert even when their payload is
	// malformed; only the bound current carrier may fence this document.
	s.mu.Lock()
	entry := s.entries[id]
	retired := entry == nil || !entry.Hot || entry.Epoch != epoch || (snapshot.Epoch != "" && snapshot.Epoch != epoch) || (snapshot.DocKey != "" && snapshot.DocKey != id.Key()) || (snapshot.AccountScope != "" && snapshot.AccountScope != id.AccountScope)
	if retired {
		s.mu.Unlock()
		return errors.New("retired document callback")
	}
	if snapshot.Revision != 0 && snapshot.Revision < entry.Snapshot.Revision {
		s.mu.Unlock()
		return errors.New("stale surface revision")
	}
	s.mu.Unlock()
	raw, e := json.Marshal(snapshot)
	if e != nil {
		s.Fence(id, epoch, snapshot.Revision, e.Error())
		return e
	}
	valid, e := DecodeSnapshot(raw)
	if e != nil {
		s.Fence(id, epoch, snapshot.Revision, e.Error())
		return e
	}
	if valid.SemanticDigest == "" || valid.SemanticRevision == 0 {
		s.Fence(id, epoch, snapshot.Revision, "missing semantic revision")
		return errors.New("missing semantic revision")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry = s.entries[id]
	if entry == nil || !entry.Hot || entry.Epoch != epoch || valid.Epoch != epoch || valid.DocKey != id.Key() || valid.AccountScope != id.AccountScope {
		return errors.New("retired document callback")
	}
	if valid.SemanticRevision < entry.Snapshot.SemanticRevision {
		return errors.New("stale or conflicting semantic revision")
	}
	if valid.SemanticRevision == entry.Snapshot.SemanticRevision && valid.SemanticDigest != entry.Snapshot.SemanticDigest {
		entry.Snapshot.Invalid = true
		entry.Snapshot.Error = "conflicting semantic revision"
		entry.fenceAfter = max(entry.fenceAfter, valid.Revision)
		entry.mutation++
		return errors.New("conflicting semantic revision")
	}
	if valid.Revision < entry.Snapshot.Revision && valid.Epoch == entry.Snapshot.Epoch {
		return errors.New("stale surface revision")
	}
	if entry.Snapshot.Invalid && valid.Revision <= entry.fenceAfter {
		return errors.New("valid frame predates invalid fence")
	}
	entry.Snapshot = cloneSnapshot(valid)
	entry.fenceAfter = 0
	entry.mutation++
	return nil
}

// Fence preserves the last synchronized semantics but makes them unavailable
// to submission until a newer current-scope valid snapshot arrives.
func (s *DocumentStore) Fence(id DocumentID, epoch string, revision uint64, reason string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil || !entry.Hot || entry.Epoch != epoch || (revision != 0 && revision < entry.Snapshot.Revision) {
		return false
	}
	entry.Snapshot.Invalid = true
	entry.Snapshot.Error = reason
	entry.fenceAfter = max(entry.fenceAfter, entry.Snapshot.Revision, revision)
	entry.mutation++
	return true
}
func (s *DocumentStore) Read(id DocumentID) (StoredDocument, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return StoredDocument{}, false
	}
	return cloneDocument(e.StoredDocument), true
}
func (s *DocumentStore) Capture(id DocumentID, epoch string, attachmentIDs []string) (SubmissionCapture, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil || !entry.Hot || entry.Epoch != epoch {
		return SubmissionCapture{}, errors.New("missing semantic draft")
	}
	snap := entry.Snapshot
	if snap.Marked || snap.Invalid || snap.Error != "" {
		return SubmissionCapture{}, errors.New("draft not synchronized for submission")
	}
	for _, r := range snap.Runs {
		if r.Invalid {
			return SubmissionCapture{}, errors.New("invalid reference retained; cannot serialize")
		}
	}
	return SubmissionCapture{DocumentID: id, Epoch: epoch, SemanticRevision: snap.SemanticRevision, SemanticDigest: snap.SemanticDigest, Runs: append([]Run(nil), snap.Runs...), CanonicalText: snap.CanonicalText, AttachmentIDs: append([]string(nil), attachmentIDs...)}, nil
}

func acceptedVersion(entry *storedEntry) AcceptedVersion {
	snap := entry.Snapshot
	return AcceptedVersion{DocumentID: entry.ID, Epoch: entry.Epoch, Hot: entry.Hot,
		SurfaceRevision: snap.Revision, SemanticRevision: snap.SemanticRevision,
		SemanticDigest: snap.SemanticDigest, FenceAfter: entry.fenceAfter,
		Invalid: snap.Invalid, Marked: snap.Marked, Error: snap.Error}
}
func cloneAccepted(accepted AcceptedSettlement) AcceptedSettlement {
	accepted.Capture.Runs = append([]Run(nil), accepted.Capture.Runs...)
	accepted.Capture.AttachmentIDs = append([]string(nil), accepted.Capture.AttachmentIDs...)
	return accepted
}
func sameAccepted(a, b AcceptedSettlement) bool {
	x, y := a.Capture, b.Capture
	return a.RequestID == b.RequestID && x.DocumentID == y.DocumentID && x.Epoch == y.Epoch &&
		x.SemanticRevision == y.SemanticRevision && x.SemanticDigest == y.SemanticDigest &&
		x.CanonicalText == y.CanonicalText && slices.Equal(x.Runs, y.Runs) && slices.Equal(x.AttachmentIDs, y.AttachmentIDs)
}

// PrepareAccepted computes a disposition without changing the document,
// invalid fence or existing settled-request map. AlreadySettled is checked
// before invalid/marked so a duplicate never asks the caller to mutate native
// content, including after cold restoration and identical retyping.
func (s *DocumentStore) PrepareAccepted(accepted AcceptedSettlement) (AcceptedPreparation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.prepareAcceptedLocked(accepted)
}
func (s *DocumentStore) prepareAcceptedLocked(accepted AcceptedSettlement) (AcceptedPreparation, error) {
	capture := accepted.Capture
	entry := s.entries[capture.DocumentID]
	if entry == nil || accepted.RequestID == "" {
		return AcceptedPreparation{}, errors.New("missing accepted intent or document")
	}
	digest, e := SemanticDigest(capture.Runs)
	if e != nil || digest != capture.SemanticDigest {
		return AcceptedPreparation{}, errors.New("invalid captured semantics")
	}
	prepared := AcceptedPreparation{store: s, entry: entry, mutation: entry.mutation,
		expected: acceptedVersion(entry), accepted: cloneAccepted(accepted),
		preview: CommitResult{Document: cloneDocument(entry.StoredDocument)}}
	if prior, ok := entry.settled[accepted.RequestID]; ok {
		if prior != digest {
			return AcceptedPreparation{}, errors.New("accepted request payload conflict")
		}
		prepared.preview.AlreadySettled = true
		return prepared, nil
	}
	if entry.Snapshot.Invalid || entry.Snapshot.Marked || entry.Snapshot.Error != "" {
		prepared.preview.Deferred = true
		return prepared, nil
	}
	remaining, matched := RemoveCommittedPrefix(entry.Snapshot.Runs, capture.Runs)
	result := &prepared.preview
	result.Preserved = !matched || len(capture.Runs) == 0
	if matched && len(capture.Runs) > 0 {
		sentDetect, _, _ := ProjectRuns(capture.Runs)
		removed := UTF16Len(sentDetect)
		d, c, _ := ProjectRuns(remaining)
		nextDigest, _ := SemanticDigest(remaining)
		snap := &result.Document.Snapshot
		snap.Runs = remaining
		snap.DetectText = d
		snap.CanonicalText = c
		snap.SemanticDigest = nextDigest
		snap.SemanticRevision++
		snap.Revision++
		snap.SelectionStart = max(0, snap.SelectionStart-removed)
		snap.SelectionEnd = max(0, snap.SelectionEnd-removed)
		result.Changed = true
		result.RemovedUTF16 = removed
	}
	return prepared, nil
}

// CommitPreparedAccepted checks this exact request/capture and current local
// state before making any mutation. A failed external native CAS needs no
// cancellation call: simply discard its read-only preparation. Native effects
// must still be serialized by the future window adapter; this ticket does not
// lock an external editor or promise that a native operation has happened.
func (s *DocumentStore) CommitPreparedAccepted(accepted AcceptedSettlement, prepared AcceptedPreparation) (CommitResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[accepted.Capture.DocumentID]
	if prepared.store != s || entry == nil || prepared.entry != entry || prepared.mutation != entry.mutation ||
		prepared.expected != acceptedVersion(entry) || !sameAccepted(accepted, prepared.accepted) {
		return CommitResult{}, ErrStaleAcceptedPreparation
	}
	return s.commitPreparedLocked(prepared), nil
}
func (s *DocumentStore) commitPreparedLocked(prepared AcceptedPreparation) CommitResult {
	result := prepared.Preview()
	if result.AlreadySettled || result.Deferred {
		return result
	}
	entry := prepared.entry
	if result.Changed {
		entry.StoredDocument = cloneDocument(result.Document)
	}
	entry.settled[prepared.accepted.RequestID] = prepared.accepted.Capture.SemanticDigest
	entry.mutation++
	result.Document = cloneDocument(entry.StoredDocument)
	return result
}

// CommitAccepted retains the original single-store API and atomic locking for
// existing callers. New native integration must preflight before side effects
// and then use CommitPreparedAccepted with that preparation.
func (s *DocumentStore) CommitAccepted(accepted AcceptedSettlement) (CommitResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prepared, err := s.prepareAcceptedLocked(accepted)
	if err != nil {
		return CommitResult{}, err
	}
	return s.commitPreparedLocked(prepared), nil
}

// Retire only detaches hot native state. Every unsent semantic document and
// selection remains addressable, including drafts belonging to old accounts.
func (s *DocumentStore) RetireDocument(id DocumentID) (StoredDocument, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[id]
	if e == nil {
		return StoredDocument{}, false
	}
	e.Hot = false
	e.Epoch = ""
	e.Snapshot.Epoch = ""
	e.mutation++
	return cloneDocument(e.StoredDocument), true
}
func (s *DocumentStore) RetireAccount(account string) []StoredDocument {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []StoredDocument
	for id, e := range s.entries {
		if id.AccountScope == account {
			e.Hot = false
			e.Epoch = ""
			e.Snapshot.Epoch = ""
			e.mutation++
			out = append(out, cloneDocument(e.StoredDocument))
		}
	}
	return out
}
func (s *DocumentStore) RetireWindow() []StoredDocument {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []StoredDocument
	for _, e := range s.entries {
		e.Hot = false
		e.Epoch = ""
		e.Snapshot.Epoch = ""
		e.mutation++
		out = append(out, cloneDocument(e.StoredDocument))
	}
	return out
}
func (s *DocumentStore) Counts() (documents, hot int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries {
		documents++
		if e.Hot {
			hot++
		}
	}
	return
}
