package main

// Wording for the two ways this client reaches a Harness Host.
//
// The native surfaces were written against a Remote server, so their copy says
// "Remote" and talks about a device list. When the Host runs in this process
// tree there is no server and no device list, and those words would describe a
// connection that does not exist. Only the labels differ; every surface below
// the copy is the same code path.

// localMode reports whether this launch owns its Host (`--local-native`).
func (a *app) localMode() bool {
	return a.localRuntime != nil && a.localRuntime.native
}

// connectedLabel replaces "Remote 已连接" in local mode.
func (a *app) connectedLabel() string {
	if a.localMode() {
		return "本地 Host 已连接"
	}
	return "Remote 已连接"
}

// workspaceHintLabel is the sidebar hint shown while no Workspace is known.
func (a *app) workspaceHintLabel() string {
	if a.localMode() {
		return "本机还没有工作区"
	}
	return "连接主机后显示远程工作区"
}

// hostNavLabel names the host surface in the sidebar footer.
func (a *app) hostNavLabel() string {
	if a.localMode() {
		return "本地 Host"
	}
	return "Remote"
}
