package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Cross-language boundary guard: literal requests in the actual bundled pages
// must be allowed by Go, rather than passing JS/Node tests in isolation.
func TestActualCompatPageRequestsAreAllowlisted(t *testing.T) {
	expressions := []*regexp.Regexp{regexp.MustCompile(`\b(?:request|invoke|mutate|open|rpc\.(?:read|mutate|mutateWithId))\(\s*["']([A-Za-z][A-Za-z0-9]+)["']`), regexp.MustCompile(`subscribeOwnedStream\(\s*ctx,\s*["']([A-Za-z][A-Za-z0-9]+)["']`)}
	err := filepath.WalkDir("compat/src", func(file string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || (!strings.HasSuffix(file, ".ts") && !strings.HasSuffix(file, ".tsx")) {
			return nil
		}
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
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
