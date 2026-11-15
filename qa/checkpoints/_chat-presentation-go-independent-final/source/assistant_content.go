package main

import "strings"

// ECMAScript String.trim whitespace, as used by the pinned assistant-content
// classifier. Go's unicode.IsSpace additionally includes NEL and excludes BOM.
func assistantNonblank(text string) bool {
	return strings.TrimFunc(text, func(r rune) bool {
		return r >= '\u0009' && r <= '\u000d' || r == ' ' || r == '\u00a0' || r == '\u1680' || r >= '\u2000' && r <= '\u200a' || r == '\u2028' || r == '\u2029' || r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
	}) != ""
}
