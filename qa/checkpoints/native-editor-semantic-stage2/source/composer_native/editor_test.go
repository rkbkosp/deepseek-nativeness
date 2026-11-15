package composer_native

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestNativeProjectionMapsAtomicReferencesAcrossUTF16AndClipboard(t *testing.T) {
	s := Snapshot{Runs: []Run{{Kind: "text", Text: "前🙂 "}, {Kind: "reference", Source: "reference", ID: "r", Label: "source", Ref: "@[source](dsh-session:ImEi)", ClipboardText: "@[source](dsh-session:ImEi)"}, {Kind: "text", Text: " 后"}}}
	s.DetectText = "前🙂 \ufffc 后"
	s.CanonicalText = "前🙂 @[source](dsh-session:ImEi) 后"
	s.SelectionStart = 5
	s.SelectionEnd = 5
	raw, _ := json.Marshal(s)
	if _, e := DecodeSnapshot(raw); e != nil {
		t.Fatal(e)
	}
	if s.CanonicalToNative(3) != 4 || s.CanonicalToNative(4) != 5 || s.NativeToCanonical(4) != 3 || s.NativeToCanonical(5) != 3+len([]rune(s.Runs[1].ClipboardText)) {
		t.Fatal("projection boundary mismatch")
	}
	if RuneAtUTF16("前🙂x", 2) != 1 || RuneAtUTF16("前🙂x", 3) != 2 || UTF16AtRune("前🙂x", 2) != 3 {
		t.Fatal("surrogate pair mapping broke")
	}
	s.CanonicalText = "forged"
	raw, _ = json.Marshal(s)
	if _, e := DecodeSnapshot(raw); e == nil {
		t.Fatal("different model projection accepted")
	}
}
func TestNativeSnapshotRejectsUnknownOccurrencesAndInvalidSelection(t *testing.T) {
	for _, raw := range []string{`{"runs":[{"kind":"alien"}],"detectText":"\ufffc"}`, `{"runs":[{"kind":"reference","id":"r"}],"detectText":"\ufffc"}`, `{"selectionStart":1,"selectionEnd":1}`} {
		if _, e := DecodeSnapshot([]byte(raw)); e == nil {
			t.Fatal("invalid native editor state accepted", raw)
		}
	}
}
func BenchmarkNativeLargeLegitimateDraft(b *testing.B) {
	for _, count := range []int{1000, 10000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			s := Snapshot{}
			for i := 0; i < count; i++ {
				s.Runs = append(s.Runs, Run{Kind: "text", Text: "x"})
			}
			s.DetectText = strings.Repeat("x", count)
			s.CanonicalText = s.DetectText
			raw, _ := json.Marshal(s)
			b.SetBytes(int64(len(raw)))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, e := DecodeSnapshot(raw); e != nil {
					b.Fatal(e)
				}
			}
		})
	}
}
