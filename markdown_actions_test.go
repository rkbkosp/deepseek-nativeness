package main

import "testing"

func TestRemoteMarkdownPathUsesWorkspaceBoundaryNeverLocalHost(t *testing.T) {
	for _, tt := range []struct {
		href, want string
		line       int
		fail       bool
	}{
		{"README.md", "README.md", 1, false}, {"file:///Users/remote/project/src/main.go#L42", "src/main.go", 42, false},
		{"/Users/remote/project/../secret", "", 0, true}, {"../secret", "", 0, true}, {"/Users/remote/project-other/a", "", 0, true},
		{"file://another-host/Users/remote/project/a", "", 0, true}, {"%2e%2e/secret", "", 0, true}, {"javascript:alert(1)", "", 0, true},
	} {
		t.Run(tt.href, func(t *testing.T) {
			name, line, err := remoteMarkdownPath("/Users/remote/project", tt.href)
			if (err != nil) != tt.fail || !tt.fail && (name != tt.want || line != tt.line) {
				t.Fatalf("%q %d %v", name, line, err)
			}
		})
	}
}
