package main

import (
	"encoding/json"
	"testing"
)

func TestLocalizedTextDecodesStringAndObject(t *testing.T) {
	var s localizedText
	if json.Unmarshal([]byte(`"标题"`), &s) != nil || s != "标题" {
		t.Fatalf("string = %q", s)
	}
	s = ""
	if json.Unmarshal([]byte(`{"en":"Title","zh-CN":"标题"}`), &s) != nil || s != "标题" {
		t.Fatalf("object = %q", s)
	}
}
