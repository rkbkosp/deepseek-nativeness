package composer_native

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash"
	"strings"
)

// NormalizeRuns makes attribute-only text partitions irrelevant while keeping
// each occurrence's identity and owner. Only the built-in identity codec is
// admitted. This is not a generic plugin reference serializer.
func NormalizeRuns(input []Run) ([]Run, error) {
	out := make([]Run, 0, len(input))
	ids := map[string]bool{}
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			out = append(out, Run{Kind: "text", Text: text.String()})
			text.Reset()
		}
	}
	for _, r := range input {
		if r.Kind == "text" {
			if strings.ContainsRune(r.Text, '\ufffc') {
				return nil, errors.New("literal object placeholder")
			}
			if r.Text == "" {
				continue
			}
			text.WriteString(r.Text)
			continue
		}
		flush()
		if r.Kind != "reference" && r.Kind != "command" {
			return nil, errors.New("unknown native draft run")
		}
		if r.ID == "" || r.ClipboardText == "" || ids[r.ID] {
			return nil, errors.New("missing or duplicate occurrence identity")
		}
		ids[r.ID] = true
		if r.Kind == "reference" && (r.Source != "reference" || r.Ref == "" || r.ClipboardText != r.Ref) {
			return nil, errors.New("unsupported reference source or codec")
		}
		if r.Kind == "command" && r.Source != "" {
			return nil, errors.New("unsupported command source")
		}
		r.Text = ""
		out = append(out, r)
	}
	flush()
	return out, nil
}

func digestField(h hash.Hash, s string) {
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(s)))
	h.Write(n[:])
	h.Write([]byte(s))
}

// SemanticDigest uses the same length-prefixed UTF-8 field protocol as Swift.
// Selection, style, callback epoch and transient key state are excluded.
func SemanticDigest(input []Run) (string, error) {
	runs, err := NormalizeRuns(input)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	digestField(h, "native-dsh-draft-v1")
	for _, r := range runs {
		invalid := "0"
		if r.Invalid {
			invalid = "1"
		}
		for _, s := range []string{r.Kind, r.Text, r.ID, r.Source, r.Ref, r.Label, r.Appearance, r.ClipboardText, invalid} {
			digestField(h, s)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func ProjectRuns(input []Run) (detect, canonical string, err error) {
	runs, e := NormalizeRuns(input)
	if e != nil {
		return "", "", e
	}
	var d, c strings.Builder
	for _, r := range runs {
		if r.Kind == "text" {
			d.WriteString(r.Text)
			c.WriteString(r.Text)
		} else {
			d.WriteRune('\ufffc')
			c.WriteString(r.ClipboardText)
		}
	}
	return d.String(), c.String(), nil
}

func IsUTF16Boundary(text string, at int) bool {
	if at < 0 {
		return false
	}
	offset := 0
	for _, r := range text {
		if at == offset {
			return true
		}
		offset++
		if r > 0xffff {
			offset++
		}
	}
	return at == offset
}

// RemoveCommittedPrefix preserves every newer suffix and atomic occurrence.
// A merely equal clipboard expansion with a different occurrence never matches.
func RemoveCommittedPrefix(current, sent []Run) ([]Run, bool) {
	left, e := NormalizeRuns(current)
	if e != nil {
		return nil, false
	}
	prefix, e := NormalizeRuns(sent)
	if e != nil {
		return nil, false
	}
	for _, r := range prefix {
		if len(left) == 0 {
			return nil, false
		}
		if r.Kind == "text" {
			if left[0].Kind != "text" || !strings.HasPrefix(left[0].Text, r.Text) {
				return nil, false
			}
			left[0].Text = strings.TrimPrefix(left[0].Text, r.Text)
			if left[0].Text == "" {
				left = left[1:]
			}
		} else {
			if left[0] != r {
				return nil, false
			}
			left = left[1:]
		}
	}
	return append([]Run(nil), left...), true
}
