package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestHighlightSpansMarksKeywordsStringsAndComments(t *testing.T) {
	normal, keyword, str, comment, number := ui.RGB(1, 1, 1), ui.RGB(2, 2, 2), ui.RGB(3, 3, 3), ui.RGB(4, 4, 4), ui.RGB(5, 5, 5)
	spans := highlightSpans(`func main() { x := "hi" // note`, "go", normal, keyword, str, comment, number)
	var sawKeyword, sawString, sawComment bool
	for _, span := range spans {
		switch span.Color {
		case keyword:
			sawKeyword = sawKeyword || span.Text == "func"
		case str:
			sawString = sawString || span.Text == `"hi"`
		case comment:
			sawComment = sawComment || span.Text == "// note"
		}
	}
	if !sawKeyword || !sawString || !sawComment {
		t.Fatalf("spans = %+v", spans)
	}
}

func TestHighlightSpansNumbers(t *testing.T) {
	spans := highlightSpans("x := 42", "go", ui.RGB(1, 1, 1), ui.RGB(2, 2, 2), ui.RGB(3, 3, 3), ui.RGB(4, 4, 4), ui.RGB(5, 5, 5))
	found := false
	for _, span := range spans {
		if span.Color == ui.RGB(5, 5, 5) && span.Text == "42" {
			found = true
		}
	}
	if !found {
		t.Fatalf("spans = %+v", spans)
	}
}

func TestCodeLanguageFromPath(t *testing.T) {
	cases := map[string]string{"a/b.go": "go", "x.tsx": "ts", "run.sh": "sh", "README": ""}
	for path, want := range cases {
		if got := codeLanguage(path); got != want {
			t.Fatalf("%s = %q want %q", path, got, want)
		}
	}
}
