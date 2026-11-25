package main

// isDevRuntime reports whether this process runs a hand-assembled runtime
// tree rather than a vendored app-bundle payload. The dev-only menu entries
// follow the same distinction.
func (a *app) isDevRuntime() bool {
	return a.localRuntime != nil && a.localRuntime.payload != nil && a.localRuntime.payload.VendorAsarSha256 == ""
}

// restartLocalHost stops the current Host and starts a fresh generation. It is
// the reference's dev "Restart app host" command; sessions are restored by the
// normal local-runtime ready path.
func (a *app) restartLocalHost() {
	if a.localRuntime == nil {
		return
	}
	a.closeLocalRuntime()
	go a.startLocalRuntime()
}
