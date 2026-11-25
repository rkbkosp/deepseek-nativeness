package main

import "testing"

func TestIsDevRuntime(t *testing.T) {
	a := &app{}
	if a.isDevRuntime() {
		t.Fatal("no runtime reported dev")
	}
	a.localRuntime = &localRuntime{payload: &runtimePayload{}}
	if !a.isDevRuntime() {
		t.Fatal("hand-assembled runtime not dev")
	}
	a.localRuntime.payload.VendorAsarSha256 = "sha"
	if a.isDevRuntime() {
		t.Fatal("vendored payload reported dev")
	}
}
