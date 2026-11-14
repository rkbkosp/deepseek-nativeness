package main

import (
	"os"
	"regexp"
	"testing"
)

// Cross-language boundary guard: literal requests in the actual bundled pages
// must be allowed by Go, rather than passing JS/Node tests in isolation.
func TestActualCompatPageRequestsAreAllowlisted(t *testing.T) {
	expressions := []*regexp.Regexp{regexp.MustCompile(`\b(?:request|invoke|mutate|open)\(\s*"([A-Za-z][A-Za-z0-9]+)"`), regexp.MustCompile(`subscribeOwnedStream\(\s*ctx,\s*"([A-Za-z][A-Za-z0-9]+)"`)}
	for _, file := range []string{"compat/src/main.tsx", "compat/src/trajectory.tsx", "compat/src/terminal-runtime.ts"} {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, re := range expressions {
			for _, match := range re.FindAllSubmatch(data, -1) {
				method := string(match[1])
				if !compatMethods[method] {
					t.Errorf("%s calls %s which Go rejects", file, method)
				}
			}
		}
	}
}
