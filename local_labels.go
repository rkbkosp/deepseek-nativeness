package main

// Wording for the two ways this client reaches a Harness Host, plus the small
// decisions that keep Remote-only chrome out of a launch that owns its Host.
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

// entryIntent is what a visible entry should do once its click arrives. The
// Remote-era surfaces all have the same shape: run their own action, or send an
// unauthorised client to login and the device list. A local launch is already
// pointed at its Host, so it holds instead of leaving for a page it cannot use.
type entryIntent int

const (
	// intentProceed runs the entry's own action (new session, workspace sheet).
	intentProceed entryIntent = iota
	// intentOpenConnection opens the Remote login and device page.
	intentOpenConnection
	// intentHold stays put while the local Host boots or after it failed.
	intentHold
)

func (i entryIntent) String() string {
	switch i {
	case intentProceed:
		return "proceed"
	case intentOpenConnection:
		return "open-connection"
	case intentHold:
		return "hold"
	}
	return "unknown"
}

// newSessionIntent decides what both "新会话" buttons do. Remote keeps its
// original behaviour, including the sign-in page for an unauthorised client.
func (a *app) newSessionIntent() entryIntent {
	if a.localMode() {
		if a.connected {
			return intentProceed
		}
		return intentHold
	}
	if !a.connected {
		return intentOpenConnection
	}
	return intentProceed
}

// applyNewSessionIntent runs that decision, so the sidebar and the title bar
// cannot drift apart.
func (a *app) applyNewSessionIntent() {
	switch a.newSessionIntent() {
	case intentOpenConnection:
		a.connectionOpen = true
		a.fetchDevices()
	case intentHold:
		a.error = a.localHostPhaseLabel()
	default:
		a.createSession()
	}
}

// workspaceCreateIntent is the same decision for "新建工作区".
func (a *app) workspaceCreateIntent() entryIntent {
	if a.localMode() && !a.connected {
		return intentHold
	}
	if !a.connected {
		return intentOpenConnection
	}
	return intentProceed
}

// Remote-only entries of the sidebar "更多" menu. They need a Remote server, so
// a local launch hides them rather than offering a page it cannot fill.
const (
	hostMenuRemoteWeb        = "remote-web"
	hostMenuRemoteConnection = "remote-connection"
)

// hostMenuItemVisible reports whether a "更多" menu entry may be offered here.
func (a *app) hostMenuItemVisible(id string) bool {
	switch id {
	case hostMenuRemoteWeb, hostMenuRemoteConnection:
		return !a.localMode()
	default:
		return true
	}
}

// newSessionLabel is the sidebar's primary button before a Host is connected.
func (a *app) newSessionLabel() string {
	if a.connected || a.demo {
		return "新会话"
	}
	if a.localMode() {
		if a.localRuntime != nil && a.localRuntime.err != "" {
			return "本地 Host 未就绪"
		}
		return "本地 Host 准备中"
	}
	return "连接远程主机"
}

// localHostStartingLabel is the local wording while the Host has no status yet.
const localHostStartingLabel = "本地 Host 正在启动，请稍候。"

// localHostPhaseLabel explains, without Remote's words, why a local launch has
// no Host yet. A terminal failure keeps its own message.
func (a *app) localHostPhaseLabel() string {
	local := a.localRuntime
	if local == nil {
		return localHostStartingLabel
	}
	if local.err != "" {
		return "本地 Host 未能启动：" + local.err
	}
	if local.status != "" {
		return local.status
	}
	return localHostStartingLabel
}

// hostPlaceholderCopy is the "no Host yet" surface. Action is empty when there
// is nothing to choose, which is the whole point of local mode.
type hostPlaceholderCopy struct {
	Title, Body, Action string
	Wrap                bool
}

func (a *app) hostPlaceholder() hostPlaceholderCopy {
	if a.localMode() {
		title := "正在启动本地 Host"
		if a.localRuntime != nil && a.localRuntime.err != "" {
			title = "本地 Host 未启动"
		}
		return hostPlaceholderCopy{Title: title, Body: a.localHostPhaseLabel(), Wrap: true}
	}
	return hostPlaceholderCopy{Title: "连接你的工作主机", Body: "工作留在 MacMini，界面在这里。", Action: "选择 Remote 主机"}
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
