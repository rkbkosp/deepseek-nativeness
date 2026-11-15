package composer_native

import (
	"encoding/base64"
	"encoding/json"
	"errors"
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
	RemovedUTF16                       int
}
type storedEntry struct {
	StoredDocument
	settled map[string]string
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
	if start < 0 || end < start || end > UTF16Len(d) {
		return errors.New("invalid UTF16 selection")
	}
	digest, _ := SemanticDigest(normalized)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries[id] != nil {
		return errors.New("semantic document already exists")
	}
	s.entries[id] = &storedEntry{StoredDocument: StoredDocument{ID: id, Snapshot: Snapshot{Kind: "snapshot", DocKey: id.Key(), AccountScope: id.AccountScope, Runs: normalized, DetectText: d, CanonicalText: c, SemanticRevision: 1, SemanticDigest: digest, SelectionStart: start, SelectionEnd: end}}, settled: map[string]string{}}
	return nil
}
func (s *DocumentStore) Bind(id DocumentID, epoch string) (StoredDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil || epoch == "" {
		return StoredDocument{}, errors.New("missing document or callback epoch")
	}
	entry.Epoch = epoch
	entry.Hot = true
	entry.Snapshot.Epoch = epoch
	return cloneDocument(entry.StoredDocument), nil
}
func (s *DocumentStore) Accept(id DocumentID, epoch string, snapshot Snapshot) error {
	raw, e := json.Marshal(snapshot)
	if e != nil {
		return e
	}
	valid, e := DecodeSnapshot(raw)
	if e != nil {
		return e
	}
	if valid.SemanticDigest == "" || valid.SemanticRevision == 0 {
		return errors.New("missing semantic revision")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil || !entry.Hot || entry.Epoch != epoch || valid.Epoch != epoch || valid.DocKey != id.Key() || valid.AccountScope != id.AccountScope {
		return errors.New("retired document callback")
	}
	if valid.SemanticRevision < entry.Snapshot.SemanticRevision || (valid.SemanticRevision == entry.Snapshot.SemanticRevision && valid.SemanticDigest != entry.Snapshot.SemanticDigest) {
		return errors.New("stale or conflicting semantic revision")
	}
	if valid.Revision < entry.Snapshot.Revision && valid.Epoch == entry.Snapshot.Epoch {
		return errors.New("stale surface revision")
	}
	entry.Snapshot = cloneSnapshot(valid)
	return nil
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
func (s *DocumentStore) Capture(id DocumentID, attachmentIDs []string) (SubmissionCapture, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[id]
	if entry == nil {
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
	return SubmissionCapture{DocumentID: id, SemanticRevision: snap.SemanticRevision, SemanticDigest: snap.SemanticDigest, Runs: append([]Run(nil), snap.Runs...), CanonicalText: snap.CanonicalText, AttachmentIDs: append([]string(nil), attachmentIDs...)}, nil
}

func (s *DocumentStore) CommitAccepted(accepted AcceptedSettlement) (CommitResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	capture := accepted.Capture
	entry := s.entries[capture.DocumentID]
	if entry == nil || accepted.RequestID == "" {
		return CommitResult{}, errors.New("missing accepted intent or document")
	}
	digest, e := SemanticDigest(capture.Runs)
	if e != nil || digest != capture.SemanticDigest {
		return CommitResult{}, errors.New("invalid captured semantics")
	}
	if prior, ok := entry.settled[accepted.RequestID]; ok {
		if prior != digest {
			return CommitResult{}, errors.New("accepted request payload conflict")
		}
		return CommitResult{Document: cloneDocument(entry.StoredDocument), AlreadySettled: true}, nil
	}
	entry.settled[accepted.RequestID] = digest
	remaining, matched := RemoveCommittedPrefix(entry.Snapshot.Runs, capture.Runs)
	result := CommitResult{Preserved: !matched || len(capture.Runs) == 0}
	if matched && len(capture.Runs) > 0 {
		sentDetect, _, _ := ProjectRuns(capture.Runs)
		removed := UTF16Len(sentDetect)
		d, c, _ := ProjectRuns(remaining)
		nextDigest, _ := SemanticDigest(remaining)
		snap := &entry.Snapshot
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
	result.Document = cloneDocument(entry.StoredDocument)
	return result, nil
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
