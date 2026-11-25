package main

import "testing"

func TestDshCommandScriptNeedsTheLocalRuntime(t *testing.T) {
	a := &app{}
	if _, err := a.dshCommandScript(); err == nil {
		t.Fatal("missing runtime payload did not fail")
	}
}

func TestShQuoteEscapesSingleQuotes(t *testing.T) {
	if got := shQuote("a'b"); got != `'a'\''b'` {
		t.Fatalf("quote = %q", got)
	}
}

func TestRemoveDshCommandAtMissingPathIsANoop(t *testing.T) {
	a := &app{}
	if err := a.removeDshCommandAt(""); err != nil {
		t.Fatal(err)
	}
}
