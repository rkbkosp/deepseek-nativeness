// Package composer_native is the app-owned text surface. It uses the public
// MyGo NativeView seam and never owns a Host connection or sends a prompt.
package composer_native

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

const MaxJSONBytes = 1024 * 1024

type Run struct {
	Kind          string `json:"kind"`
	Text          string `json:"text,omitempty"`
	ID            string `json:"id,omitempty"`
	Source        string `json:"source,omitempty"`
	Ref           string `json:"ref,omitempty"`
	Label         string `json:"label,omitempty"`
	Appearance    string `json:"appearance,omitempty"`
	ClipboardText string `json:"clipboardText,omitempty"`
	Invalid       bool   `json:"invalid,omitempty"`
}
type Snapshot struct {
	Kind             string `json:"kind"`
	ID               uint64 `json:"id"`
	Epoch            string `json:"epoch"`
	DocKey           string `json:"docKey"`
	Revision         uint64 `json:"revision"`
	SemanticRevision uint64 `json:"semanticRevision"`
	SemanticDigest   string `json:"semanticDigest"`
	Runs             []Run  `json:"runs"`
	DetectText       string `json:"detectText"`
	CanonicalText    string `json:"canonicalText"`
	SelectionStart   int    `json:"selectionStart"`
	SelectionEnd     int    `json:"selectionEnd"`
	Marked           bool   `json:"marked"`
	Focused          bool   `json:"focused"`
	SelectedCommand  string `json:"selectedCommand"`
	SurfaceCount     int    `json:"surfaceCount"`
	Accelerated      bool   `json:"accelerated"`
	Modifiers        uint64 `json:"modifiers"`
	Repeat           bool   `json:"repeat"`
	Key              int    `json:"key"`
	Shift            bool   `json:"shift"`
	Text             string `json:"text"`
	Error            string `json:"error"`
	Invalid          bool   `json:"invalid"`
}
type Command struct {
	Style                    map[string]any `json:"style,omitempty"`
	ExpectedCanonical        *string        `json:"expectedCanonical,omitempty"`
	ExpectedSemanticRevision *uint64        `json:"expectedSemanticRevision,omitempty"`
	ExpectedSemanticDigest   string         `json:"expectedSemanticDigest,omitempty"`
	AccountScope             string         `json:"accountScope,omitempty"`
	TargetDocKey             string         `json:"targetDocKey,omitempty"`
	TargetAccountScope       string         `json:"targetAccountScope,omitempty"`
	RequestID                string         `json:"requestId,omitempty"`
	RemovedUTF16             int            `json:"removedUTF16,omitempty"`
	Op                       string         `json:"op"`
	Epoch                    string         `json:"epoch"`
	DocKey                   string         `json:"docKey"`
	Start                    int            `json:"start,omitempty"`
	End                      int            `json:"end,omitempty"`
	Runs                     []Run          `json:"runs,omitempty"`
	Open                     bool           `json:"open,omitempty"`
}

func DecodeSnapshot(raw []byte) (Snapshot, error) {
	var s Snapshot
	if len(raw) > MaxJSONBytes {
		return s, errors.New("native editor frame too large")
	}
	if e := json.Unmarshal(raw, &s); e != nil {
		return s, e
	}
	if s.Error != "" {
		return s, errors.New(s.Error)
	}
	if _, err := NormalizeRuns(s.Runs); err != nil {
		return s, err
	}
	var d, c strings.Builder
	for _, r := range s.Runs {
		if r.Kind == "text" {
			d.WriteString(r.Text)
			c.WriteString(r.Text)
		} else {
			if r.Kind != "reference" && r.Kind != "command" {
				return s, errors.New("unknown native draft run")
			}
			if r.ID == "" || r.ClipboardText == "" {
				return s, errors.New("incomplete native occurrence")
			}
			if r.Kind == "reference" && r.Source != "reference" {
				return s, errors.New("unsupported reference source")
			}
			d.WriteRune('\ufffc')
			c.WriteString(r.ClipboardText)
		}
	}
	if d.String() != s.DetectText || c.String() != s.CanonicalText {
		return s, errors.New("native draft projection mismatch")
	}
	if s.SemanticDigest != "" {
		digest, err := SemanticDigest(s.Runs)
		if err != nil || digest != s.SemanticDigest {
			return s, errors.New("semantic digest mismatch")
		}
	}
	if s.SelectionStart < 0 || s.SelectionEnd < s.SelectionStart || s.SelectionEnd > UTF16Len(d.String()) {
		return s, errors.New("invalid native selection")
	}
	return s, nil
}
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}
func RuneAtUTF16(s string, at int) int {
	offset := 0
	for i, r := range []rune(s) {
		n := 1
		if r > 0xffff {
			n = 2
		}
		if offset+n > at {
			return i
		}
		offset += n
	}
	return len([]rune(s))
}
func UTF16AtRune(s string, at int) int {
	r := []rune(s)
	at = max(0, min(at, len(r)))
	return UTF16Len(string(r[:at]))
}

// CanonicalToNative maps a clipboard-projection rune boundary to the UTF16
// native document; an interior position of an atomic run snaps to its end.
func (s Snapshot) CanonicalToNative(at int) int {
	canonical, native := 0, 0
	for _, r := range s.Runs {
		piece := r.Text
		if r.Kind != "text" {
			piece = r.ClipboardText
		}
		n := utf8.RuneCountInString(piece)
		if at <= canonical+n {
			if r.Kind != "text" {
				if at <= canonical {
					return native
				}
				return native + 1
			}
			return native + UTF16AtRune(piece, at-canonical)
		}
		canonical += n
		if r.Kind == "text" {
			native += UTF16Len(piece)
		} else {
			native++
		}
	}
	return native
}
func (s Snapshot) NativeToCanonical(at int) int {
	canonical, native := 0, 0
	for _, r := range s.Runs {
		piece := r.Text
		if r.Kind != "text" {
			piece = r.ClipboardText
		}
		n := 1
		if r.Kind == "text" {
			n = UTF16Len(piece)
		}
		if at <= native+n {
			if r.Kind != "text" {
				if at <= native {
					return canonical
				}
				return canonical + utf8.RuneCountInString(piece)
			}
			return canonical + RuneAtUTF16(piece, at-native)
		}
		native += n
		canonical += utf8.RuneCountInString(piece)
	}
	return canonical
}
