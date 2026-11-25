package main

// Local runtime boot: resolve the payload, take the profile, start the Host and
// publish the page the original web client is served from.
//
// Everything the shell needs at runtime lives in localRuntime, so the shared
// `app` struct only gains one field.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/egoist/mygo"
	"native-dsh/desktop/internal/bridge"
)

// localNativeMode selects the native client over the local Host for this launch
// (`--local-native`). The served web client stays available as the comparison
// surface (`--local`).
var localNativeMode bool

// localHostID is the single host the local helper advertises; the native client
// connects to it instead of a Remote device list.
const localHostID = "local"

type localRuntime struct {
	payload *runtimePayload
	host    *runtimeHost
	page    *mygo.WebView
	url     string
	home    string

	// native selects the native client over the local Host (M4b) instead of the
	// served web client in a web view (M4a).
	native bool

	// status is the human-readable phase while starting; err is terminal.
	status  string
	err     string
	started time.Time

	// supervisor owns the Host process across restarts; host is only the
	// current generation, kept for the shell's "is a Host running" checks.
	supervisor *runtimeSupervisor
	// restarts and lastRestart record what the last restart did, for the UI copy
	// and for the QA recovery probe.
	restarts    int
	lastRestart string
	// hostPid is the current generation's Host process id, for diagnostics and
	// for the QA recovery probe's before/after evidence.
	hostPid int
	// phases records every phase the supervisor published, so the shell and the
	// QA probe can show the restart rather than just its end state.
	phases []string

	// bind starts the native helper for one ready URL. The default starts the
	// real helper; tests replace it to observe the recovery handshake without
	// spawning node.
	bind func(url string) error
}

// localDebugf logs local-runtime transitions when NATIVE_DSH_LOCAL_DEBUG is set,
// the same opt-in switch the served page uses. Only authorities are ever logged:
// a ready URL carries a single-use launch token and must not reach a log.
func localDebugf(format string, args ...any) {
	if os.Getenv("NATIVE_DSH_LOCAL_DEBUG") == "" {
		return
	}
	log.Printf("local: "+format, args...)
}

// runtimeTopic is the small amount of state the shell shows about the Host.
type runtimeTopic struct {
	Kind string
	Text string
}

// startLocalRuntime boots the local Host asynchronously and publishes the page
// when it is ready. It is safe to call from the UI thread: the blocking work
// happens in a goroutine and state changes are applied through a.update.
func (a *app) startLocalRuntime() {
	if a.localRuntime != nil {
		if a.localRuntime.page != nil {
			return
		}
		if a.localRuntime.supervisor != nil || a.localRuntime.host != nil {
			return // already starting or running
		}
	}
	local := &localRuntime{status: "正在查找本地运行时…", started: time.Now(), native: localNativeMode}
	a.localRuntime = local
	a.update(func() { a.error = "" })

	go func() {
		payload, err := resolveRuntimePayload()
		if err != nil {
			a.failLocalRuntime(local, err.Error())
			return
		}
		home, err := runtimeHome()
		if err != nil {
			a.failLocalRuntime(local, "无法确定 Harness 主目录："+err.Error())
			return
		}
		a.update(func() { local.payload, local.home = payload, home })
		a.update(func() { local.status = "正在检查 profile 占用…" })
		if err := ensureProfileAvailable(home); err != nil {
			a.failLocalRuntime(local, err.Error())
			return
		}
		a.update(func() {
			local.status = fmt.Sprintf("正在启动本地运行时 %s …", payload.Version)
		})
		launch := runtimeLaunch{
			Command: payload.Node,
			Args: []string{
				payload.Launcher,
				"--home", home,
				"--runtime", payload.Dsh,
				"--node", payload.Node,
				"--primary-runtime", payload.PrimaryRuntime,
				"--pnpm", payload.Pnpm,
				"--bin", payload.NodeBin,
				"--client-version", payload.Version,
			},
			Env:          inheritedEnvironment(),
			Dir:          payload.Root,
			OnEvent:      a.onRuntimeEvent(local),
			ReadyTimeout: 240 * time.Second,
		}
		supervisor := a.newLocalSupervisor(local, launch)
		a.update(func() { local.supervisor = supervisor })
		// run returns only when supervision ends: a requested shutdown, a
		// failure a restart cannot fix, or an exhausted restart budget.
		if err := supervisor.run(a.ctx); err != nil {
			a.failLocalRuntime(local, err.Error())
		}
	}()
}

// newLocalSupervisor wires one Host's restart policy to this shell.
func (a *app) newLocalSupervisor(local *localRuntime, launch runtimeLaunch) *runtimeSupervisor {
	supervisor := newRuntimeSupervisor(launch, defaultRuntimeRecovery)
	supervisor.OnHost = func(host *runtimeHost) {
		a.update(func() { local.host = host })
	}
	supervisor.OnStatus = func(status runtimeStatus) {
		a.update(func() { a.applyLocalStatus(local, status) })
	}
	supervisor.OnReady = func(ready runtimeReady, restarted bool) error {
		return a.localRuntimeReady(local, ready, restarted)
	}
	return supervisor
}

// applyLocalStatus publishes the supervisor's phase. A restart must be visible:
// the native client keeps its transcript on screen, so without this text a dead
// Host would look like a silent disconnect.
func (a *app) applyLocalStatus(local *localRuntime, status runtimeStatus) {
	if a.localRuntime != local {
		localDebugf("status %s ignored: runtime was replaced", status.Phase)
		return
	}
	local.phases = append(local.phases, strings.TrimSpace(fmt.Sprintf("%s attempt=%d %s",
		status.Phase, status.Attempt, status.Reason)))
	if len(local.phases) > 16 {
		local.phases = local.phases[len(local.phases)-16:]
	}
	localDebugf("status %s attempt=%d reason=%q", status.Phase, status.Attempt, status.Reason)
	switch status.Phase {
	case runtimePhaseReady:
		local.status = ""
		a.fatalLocal = ""
	case runtimePhaseRestart:
		local.restarts = status.Attempt
		local.lastRestart = status.Reason
		local.status = "本地 Host 已异常退出，正在自动重启并恢复连接（" +
			fmt.Sprintf("第 %d 次，原因：%s", status.Attempt, status.Reason) + "）。"
		a.status = "本地 Host 已重启，正在恢复"
		a.detail = "本地 Host 已异常退出，正在自动重启并重连。"
		// Nothing can be sent or read while the Host is gone; saying so is more
		// honest than leaving the previous "connected" state on screen.
		a.connected = false
	case runtimePhaseFailed:
		local.status = ""
		local.err = status.Message
		a.status = "本地 Host 已停止"
		a.error = status.Message
		if strings.Contains(status.Message, "已停止自动重启") {
			a.fatalLocal = status.Message
		}
	}
}

// localRuntimeReady runs for every generation the supervisor brings up. The
// first one opens the client; a later one has to re-point it, because a restarted
// Host listens on a new port and mints a new single-use launch token, so the old
// ready URL can never be reused.
func (a *app) localRuntimeReady(local *localRuntime, ready runtimeReady, restarted bool) error {
	localDebugf("ready restarted=%v host=%s pid=%d current=%v", restarted, hostPort(ready.URL), ready.Pid, a.localRuntime == local)
	if err := probeHostAlive(ready.URL); err != nil {
		// The Host answered `ready` but not HTTP: report the process output
		// instead of showing a blank page.
		return errors.New("本地 Host 未响应 HTTP：" + err.Error())
	}
	a.update(func() {
		if a.localRuntime != local {
			return
		}
		local.url = ready.URL
		local.hostPid = ready.Pid
		local.status = ""
	})
	if !restarted {
		if local.native {
			a.update(func() {
				if a.localRuntime != local {
					return
				}
				a.openLocalBridge(local)
			})
			if runtimeRecoveryProbePath != "" {
				a.startRecoveryProbe(local, ready)
			}
			return nil
		}
		a.openLocalPage(local)
		return nil
	}
	// A restart has to hand the client a new URL. The selection the user was
	// looking at is captured first so it can be reopened from the new catalog.
	sessionID, _ := a.localSelection()
	localDebugf("restart: previous session=%q", sessionID)
	if local.native {
		a.update(func() {
			if a.localRuntime != local {
				return
			}
			if err := a.bindLocalHelper(local, ready.URL); err != nil {
				a.failLocalRuntime(local, "本地 Host 已重启，但原生界面未能重新连接："+err.Error()+
					"。可用菜单「工作区 → 重新加载工作区」（⌘R）重试。")
				return
			}
			a.resumeLocalSession(local, sessionID)
		})
		return nil
	}
	a.reloadLocalPage(local)
	return nil
}

// onRuntimeEvent keeps the last Host event for diagnostics. It must not touch
// UI state directly: events arrive on the supervisor goroutine.
func (a *app) onRuntimeEvent(local *localRuntime) func(json.RawMessage) {
	return func(raw json.RawMessage) {
		var event struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &event) != nil || event.Type == "" {
			return
		}
		switch event.Type {
		case "platform-session":
			// Credential updates for embedded Platform views are not used by this
			// shell yet; ignoring them keeps the channel drained.
		default:
			a.update(func() {
				if local.payload == nil {
					return
				}
			})
		}
	}
}

func (a *app) failLocalRuntime(local *localRuntime, message string) {
	a.update(func() {
		if local.supervisor != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			_ = local.supervisor.stop(ctx)
			cancel()
			local.supervisor = nil
		}
		if local.host != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			_ = local.host.stop(ctx)
			local.host = nil
		}
		local.err = message
		local.status = ""
		a.error = message
	})
}

// bindLocalHelper starts the native client's helper against one ready URL. It
// speaks the same stdio contract as the Remote helper, so nothing above the
// transport knows the difference.
//
// Rebinding replaces the process instead of re-pointing it: the adapter's
// sockets, Peer and event streams belong to the Host that answered that URL, and
// a fresh helper is the only way to be sure none of them survive a restart.
func (a *app) bindLocalHelper(local *localRuntime, readyURL string) error {
	if local.payload == nil {
		return errors.New("本地运行时载荷不可用。")
	}
	a.retireLocalCarrier()
	if local.bind != nil {
		return local.bind(readyURL)
	}
	helper, err := resolveLocalHelper()
	if err != nil {
		return errors.New("找不到本地通信模块：" + err.Error())
	}
	localDebugf("bind helper host=%s", hostPort(readyURL))
	// The runtime root supplies the official stream-protocol parser and `ws`.
	a.startBridge(nodeExecutable(), []string{helper, "--url", readyURL, "--runtime", local.payload.Root})
	if a.client == nil {
		return errors.New("本地通信模块未能启动。")
	}
	return nil
}

// retireLocalCarrier releases the carrier of the Host that just went away.
//
// This is not just process hygiene. While its Host was down the old helper kept
// retrying, and every retry advanced the connection epoch it reports. The shell
// drops a status that looks older than the epoch it has adopted, so carrying
// that watermark into the replacement carrier makes the new helper's own
// `configure` reply look stale: the reconnect is then never even requested.
// The epoch belongs to the carrier, so it is retired with it.
func (a *app) retireLocalCarrier() {
	previous := a.client
	// Detach first: the old helper's exit is not a user-facing disconnect, and
	// its exit handler only speaks up while the app still points at it.
	a.client = nil
	if previous != nil {
		_ = previous.Close()
	}
	a.remoteGeneration = 0
	a.connected = false
}

// openLocalBridge starts the native client against the Host this process started.
func (a *app) openLocalBridge(local *localRuntime) {
	if err := a.bindLocalHelper(local, local.url); err != nil {
		a.failLocalRuntime(local, err.Error())
	}
}

// reloadLocalPage replaces the served page after a restart. The old web view's
// render process belonged to the Host that died, so it is destroyed rather than
// navigated.
func (a *app) reloadLocalPage(local *localRuntime) {
	mygo.RunOnMain(func() {
		if a.localRuntime != local {
			return
		}
		if page := local.page; page != nil {
			local.page = nil
			page.Destroy()
		}
		a.openLocalPage(local)
	})
}

// localSelection captures the Session the user was looking at, before a restart
// clears the catalog and the connection.
func (a *app) localSelection() (sessionID, workspaceID string) {
	state := a.localRuntimeState(a.localRuntime)
	return state.sessionID, state.workspaceID
}

// resumeLocalSession reopens that Session from the catalog the new Host
// reported, so a restart does not silently drop the user into an empty window.
// It waits for the fresh connect to settle and never overrides a Session the user
// opened meanwhile.
func (a *app) resumeLocalSession(local *localRuntime, sessionID string) {
	if sessionID == "" {
		return
	}
	go func() {
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			state := a.localRuntimeState(local)
			if state.err != "" || a.localRuntime != local {
				localDebugf("resume %q: abandoned (%q)", sessionID, state.err)
				return
			}
			if state.connected {
				// The catalog arrives after `connected`: a connect settles before
				// the workspace and session reads it triggers. Waiting for the row
				// keeps a restart from dropping the user into an empty window just
				// because the new Host answered faster than the catalog did.
				switch {
				case state.sessionID == sessionID:
					return
				case state.sessionID != "":
					localDebugf("resume %q: skipped, the user opened %q", sessionID, state.sessionID)
					return
				case a.localCatalogHas(local, sessionID):
					a.update(func() {
						if a.localRuntime != local || !a.connected || a.sessionID != "" {
							return
						}
						for _, row := range a.sessions {
							if row.ID == sessionID {
								localDebugf("resume %q: reopening", sessionID)
								a.chooseSession(row)
								return
							}
						}
					})
					return
				}
				localDebugf("resume %q: waiting for the new catalog (%d sessions)", sessionID, state.sessions)
			}
			time.Sleep(50 * time.Millisecond)
		}
		localDebugf("resume %q: timed out waiting for the reconnect", sessionID)
	}()
}

// localCatalogHas reports whether the shell's Session catalog carries one id,
// read on the UI thread so a goroutine never touches UI state directly.
func (a *app) localCatalogHas(local *localRuntime, sessionID string) bool {
	read := make(chan bool, 1)
	a.update(func() {
		found := false
		if a.localRuntime == local {
			for _, row := range a.sessions {
				if row.ID == sessionID {
					found = true
					break
				}
			}
		}
		read <- found
	})
	select {
	case found := <-read:
		return found
	case <-time.After(2 * time.Second):
		return false
	}
}

// localRuntimeState is one coherent read of the shell's runtime state from the
// UI thread. The recovery probe and the post-restart resume both read through it
// so they never touch UI state from a goroutine.
type localRuntimeState struct {
	connected   bool
	url         string
	status      string
	err         string
	restarts    int
	lastRestart string
	workspaces  int
	sessions    int
	sessionID   string
	workspaceID string
	hostPid     int
	helper      *bridge.Client
	phases      []string
	shellError  string
	detail      string
}

func (a *app) localRuntimeState(local *localRuntime) localRuntimeState {
	if local == nil {
		return localRuntimeState{}
	}
	read := make(chan localRuntimeState, 1)
	a.update(func() {
		state := localRuntimeState{
			connected:   a.connected,
			url:         local.url,
			status:      local.status,
			err:         local.err,
			restarts:    local.restarts,
			lastRestart: local.lastRestart,
			workspaces:  len(a.workspaces),
			sessions:    len(a.sessions),
			sessionID:   a.sessionID,
			workspaceID: a.workspaceID,
			hostPid:     local.hostPid,
			helper:      a.client,
			phases:      append([]string(nil), local.phases...),
			shellError:  a.error,
			detail:      a.detail,
		}
		if a.localRuntime != local {
			state.url, state.err, state.status = "", "", ""
		}
		read <- state
	})
	select {
	case state := <-read:
		return state
	case <-time.After(5 * time.Second):
		localDebugf("state read timed out: the UI thread did not run the update")
		return localRuntimeState{}
	}
}

// openLocalPage creates the web view for the served client. It runs on the main
// thread because the view belongs to the window.
func (a *app) openLocalPage(local *localRuntime) {
	mygo.RunOnMain(func() {
		if a.localRuntime != local || a.win == nil {
			return
		}
		a.closeCompat()
		a.closeWeb()
		view, err := a.win.NewWebView(mygo.WebViewOptions{
			URL: local.url,
			// The served application is not a native trusted page: it gets no
			// bindings, exactly like the untrusted Remote Web surface.
			Page:            mygo.PageOptions{Untrusted: true},
			BackgroundColor: webViewBackground(a.effectiveDark),
		})
		if err != nil {
			a.failLocalRuntime(local, "无法创建本地工作区视图："+err.Error())
			return
		}
		local.page = view
		if os.Getenv("NATIVE_DSH_LOCAL_DEBUG") != "" {
			log.Printf("local: created view for %s", local.url)
			view.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
				log.Printf("local: navigating to %s", e.URL)
			})
			view.Page().OnDidFinishLoad(func() {
				log.Printf("local: load finished")
				// A window capture can omit the hosted web content, so QA can also
				// ask for the web view's own snapshot.
				if shot := os.Getenv("NATIVE_DSH_LOCAL_SHOT"); shot != "" {
					go func() {
						time.Sleep(4 * time.Second)
						data, err := view.CapturePage()
						if err != nil {
							log.Printf("local: web capture: %v", err)
							return
						}
						if err := os.WriteFile(shot, data, 0o600); err != nil {
							log.Printf("local: web capture write: %v", err)
							return
						}
						log.Printf("local: web capture %s", shot)
					}()
				}
			})
		}
		view.Page().OnDidFailLoad(func(e *mygo.LoadError) {
			if a.localRuntime == local && local.page == view {
				a.error = "本地工作区加载失败：" + e.Description
				a.closeLocalRuntime()
			}
		})
		view.Page().OnRenderProcessGone(func(reason string) {
			if a.localRuntime == local && local.page == view {
				a.error = "本地工作区已停止（" + reason + "），可重新打开。"
				a.closeLocalRuntime()
			}
		})
		a.win.Invalidate()
	})
}

// closeLocalRuntime stops the Host and destroys the view. The Host is owned by
// this process, so closing the window terminates it.
func (a *app) closeLocalRuntime() {
	local := a.localRuntime
	if local == nil {
		return
	}
	a.localRuntime = nil
	page, host, supervisor := local.page, local.host, local.supervisor
	local.page, local.host, local.supervisor = nil, nil, nil
	if local.native && a.client != nil {
		_ = a.client.Close()
		a.client = nil
		a.connected = false
		a.status = "本地 Host 已停止"
	}
	if page != nil || a.win != nil {
		mygo.RunOnMain(func() {
			if page != nil {
				page.Destroy()
			}
			if a.win != nil {
				a.win.Invalidate()
			}
		})
	}
	// The supervisor is stopped first: stopping the current generation alone
	// would let a restart policy bring the Host straight back.
	if supervisor != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = supervisor.stop(ctx)
		}()
		return
	}
	if host != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = host.stop(ctx)
		}()
	}
}

// --- QA recovery probe ----------------------------------------------------
//
// `--recovery-probe <path>` exercises the recovery chain end to end: once the
// native client is connected, it SIGKILLs the Host, watches supervision replace
// it, waits for the client to reconnect on the new URL, writes what happened and
// quits. It only ever runs against an isolated DSH_HOME.

// runtimeRecoveryProbePath is the QA-only `--recovery-probe` destination.
var runtimeRecoveryProbePath string

const (
	// recoveryProbeDeadline bounds each wait inside the probe.
	recoveryProbeDeadline = 180 * time.Second
	// recoveryProbeSettleTime bounds the catalog waits around the seeded
	// Workspace and Session.
	recoveryProbeSettleTime = 60 * time.Second
)

// runtimeRecoveryEvidence is the probe's JSON. It records ports, counts and
// timings only: the launch token in the ready URL is never written, and no
// credential ever reaches this file.
type runtimeRecoveryEvidence struct {
	SchemaVersion    int      `json:"schemaVersion"`
	Kind             string   `json:"kind"`
	RecordedAt       string   `json:"recordedAt"`
	Mode             string   `json:"mode"`
	DSHHome          string   `json:"dshHome"`
	KillSignal       string   `json:"killSignal"`
	OldHost          string   `json:"oldHost"`
	OldHostPid       int      `json:"oldHostPid"`
	NewHost          string   `json:"newHost"`
	NewHostPid       int      `json:"newHostPid"`
	OldHostClosed    bool     `json:"oldHostClosed"`
	Restarts         int      `json:"restarts"`
	RestartReason    string   `json:"restartReason"`
	ReadyMs          int64    `json:"readyMs"`
	ReconnectMs      int64    `json:"reconnectMs"`
	ConnectedBefore  bool     `json:"connectedBefore"`
	ConnectedAfter   bool     `json:"connectedAfter"`
	HelperReplaced   bool     `json:"helperReplaced"`
	SeedWorkspace    bool     `json:"seedWorkspace"`
	SeedSession      bool     `json:"seedSession"`
	WorkspacesBefore int      `json:"workspacesBefore"`
	WorkspacesAfter  int      `json:"workspacesAfter"`
	SessionsBefore   int      `json:"sessionsBefore"`
	SessionsAfter    int      `json:"sessionsAfter"`
	SessionResumed   bool     `json:"sessionResumed"`
	Phases           []string `json:"phases"`
	Failure          string   `json:"failure"`
	DurationMs       int64    `json:"durationMs"`
	Passed           bool     `json:"passed"`
}

// startRecoveryProbe watches one Host get killed and replaced.
func (a *app) startRecoveryProbe(local *localRuntime, first runtimeReady) {
	path := runtimeRecoveryProbePath
	go func() {
		started := time.Now()
		evidence := runtimeRecoveryEvidence{
			SchemaVersion: 1,
			Kind:          "local-recovery",
			RecordedAt:    started.UTC().Format(time.RFC3339),
			Mode:          "local-native",
			DSHHome:       local.home,
			KillSignal:    "SIGKILL",
			OldHost:       hostPort(first.URL),
			OldHostPid:    first.Pid,
		}
		defer func() {
			evidence.DurationMs = time.Since(started).Milliseconds()
			evidence.Passed = evidence.Failure == "" && evidence.ConnectedAfter &&
				evidence.Restarts > 0 && evidence.OldHostClosed
			if err := writeRecoveryEvidence(path, evidence); err != nil {
				log.Printf("recovery probe: %v", err)
			}
			mygo.RunOnMain(func() { mygo.App.Quit() })
		}()

		if local.home == "" || samePath(local.home, sharedHarnessHome()) {
			evidence.Failure = "recovery probe 需要独立的 DSH_HOME：拒绝在共用 profile 上杀 Host"
			return
		}
		if _, ok := a.waitForLocal(local, recoveryProbeDeadline, func(state localRuntimeState) bool {
			return state.connected
		}); !ok {
			evidence.Failure = "原生客户端未在超时内连上本地 Host，未执行 SIGKILL"
			return
		}
		before := a.localRuntimeState(local)
		seedDir := filepath.Join(local.home, "recovery-probe-workspace")
		if err := os.MkdirAll(seedDir, 0o700); err == nil {
			a.seedRecoveryCatalog(local, seedDir, &evidence)
			before = a.localRuntimeState(local)
		}
		evidence.ConnectedBefore = before.connected
		evidence.WorkspacesBefore = before.workspaces
		evidence.SessionsBefore = before.sessions
		helperBefore := before.helper

		if err := syscall.Kill(first.Pid, syscall.SIGKILL); err != nil {
			evidence.Failure = "SIGKILL 未能送达 Host 进程：" + err.Error()
			return
		}
		killed := time.Now()
		localDebugf("probe: killed host pid=%d host=%s", first.Pid, evidence.OldHost)

		// The supervisor publishes a new ready URL on its own port.
		ready, ok := a.waitForLocal(local, recoveryProbeDeadline, func(state localRuntimeState) bool {
			return state.err != "" || (state.url != "" && state.url != first.URL)
		})
		if ready.err != "" {
			evidence.Failure = "重启后失败：" + ready.err
			return
		}
		if !ok {
			evidence.Failure = "超时：Host 被 SIGKILL 后没有被重启"
			return
		}
		evidence.NewHost = hostPort(ready.url)
		evidence.NewHostPid = ready.hostPid
		evidence.ReadyMs = time.Since(killed).Milliseconds()
		localDebugf("probe: restarted host=%s pid=%d after %dms", evidence.NewHost, ready.hostPid, evidence.ReadyMs)

		// Then the native client has to be re-pointed at that URL and settled.
		after, ok := a.waitForLocal(local, recoveryProbeDeadline, func(state localRuntimeState) bool {
			return state.err != "" || state.connected
		})
		evidence.ReconnectMs = time.Since(killed).Milliseconds()
		if after.err != "" {
			evidence.Failure = "重连失败：" + after.err
			return
		}
		if !ok {
			evidence.Failure = "超时：原生客户端没有在新 URL 上重新连上本地 Host"
			if detail := strings.TrimSpace(after.shellError + " " + after.detail); detail != "" {
				evidence.Failure += "（客户端报告：" + detail + "）"
			}
			return
		}
		evidence.ConnectedAfter = after.connected

		// A resumed Session means the catalog the new Host reported carries the
		// same Session the user was reading.
		if before.sessionID != "" {
			resumed, _ := a.waitForLocal(local, 15*time.Second, func(state localRuntimeState) bool {
				return state.sessionID == before.sessionID
			})
			evidence.SessionResumed = resumed.sessionID == before.sessionID && before.sessionID != ""
		}
		settled := a.localRuntimeState(local)
		localDebugf("probe: settled connected=%v helper=%v restarts=%d", settled.connected, settled.helper != nil, settled.restarts)
		evidence.Restarts = settled.restarts
		evidence.RestartReason = settled.lastRestart
		evidence.HelperReplaced = helperBefore != nil && settled.helper != nil && settled.helper != helperBefore
		evidence.Phases = settled.phases
		evidence.WorkspacesAfter = settled.workspaces
		evidence.SessionsAfter = settled.sessions
		evidence.OldHostClosed = !hostListenable(evidence.OldHost)
	}()
}

// seedRecoveryCatalog registers one Workspace and one Session so the catalogs
// the reconnect re-reads are not empty. It uses the same fenced mutation the
// "新建工作区" sheet does, one layer below the sheet's capability gate, because a
// freshly prepared profile can report no operations at all. Everything it writes
// stays inside the probe's own temporary home. A failure here is recorded, not
// fatal: the carrier recovery is what the probe has to prove.
func (a *app) seedRecoveryCatalog(local *localRuntime, directory string, evidence *runtimeRecoveryEvidence) {
	a.update(func() {
		if a.localRuntime != local || !a.connected {
			return
		}
		a.mutate("createWorkspace", map[string]any{"path": directory}, func(raw json.RawMessage) error {
			var result struct {
				Workspace struct {
					WorkspaceID string `json:"workspaceId"`
				} `json:"workspace"`
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				return err
			}
			id := result.Workspace.WorkspaceID
			if id == "" {
				return errors.New("主机未返回工作区标识")
			}
			a.refreshWorkspaces(func() {
				for _, row := range a.workspaces {
					if row.ID == id {
						a.selectWorkspace(id)
						return
					}
				}
			})
			return nil
		})
	})
	created, ok := a.waitForLocal(local, recoveryProbeSettleTime, func(state localRuntimeState) bool {
		return state.workspaces > 0 && state.workspaceID != ""
	})
	evidence.SeedWorkspace = ok && created.workspaces > 0
	if !evidence.SeedWorkspace {
		localDebugf("probe: seed workspace failed workspaces=%d workspaceId=%q error=%q",
			created.workspaces, created.workspaceID, created.shellError)
		return
	}
	a.update(func() {
		if a.localRuntime != local || !a.connected {
			return
		}
		a.createSession()
	})
	_, resolved := a.waitForLocal(local, recoveryProbeSettleTime, func(state localRuntimeState) bool {
		return state.sessionID != ""
	})
	evidence.SeedSession = resolved
}

// waitForLocal polls one coherent UI-thread read until done reports true.
func (a *app) waitForLocal(local *localRuntime, timeout time.Duration, done func(localRuntimeState) bool) (localRuntimeState, bool) {
	deadline := time.Now().Add(timeout)
	for {
		state := a.localRuntimeState(local)
		if done(state) {
			return state, true
		}
		if time.Now().After(deadline) {
			return state, false
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// hostPort keeps only the authority of a ready URL: the launch token it carries
// is a secret and must never reach evidence.
func hostPort(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host
}

// hostListenable reports whether something still accepts TCP on host:port.
func hostListenable(host string) bool {
	if host == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", host, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func writeRecoveryEvidence(path string, evidence runtimeRecoveryEvidence) error {
	data, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return os.WriteFile(path, data, 0o600)
}

// probeHostAlive checks that the Host answers HTTP at all. It deliberately does
// not consume the launch token: that token is single-use per launch and the web
// view still needs it, so the probe only looks for any response.
func probeHostAlive(rawURL string) error {
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Get(rawURL)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return nil
}

// hostReachable is a cheaper liveness check used for status text.
func hostReachable(rawURL string) bool {
	u := strings.TrimPrefix(strings.TrimPrefix(rawURL, "http://"), "https://")
	if index := strings.IndexAny(u, "/?#"); index >= 0 {
		u = u[:index]
	}
	conn, err := net.DialTimeout("tcp", u, 800*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

var _ = errors.Is

// stopLocalRuntimeForQuit stops the owned Host synchronously, so quitting
// reports shutdown-complete instead of killing it mid-task without notice.
func (a *app) stopLocalRuntimeForQuit() {
	local := a.localRuntime
	if local == nil {
		return
	}
	page, host, supervisor := local.page, local.host, local.supervisor
	a.localRuntime = nil
	local.page, local.host, local.supervisor = nil, nil, nil
	if local.native && a.client != nil {
		// Release the helper before the Host goes away: it owns the only
		// answering Peer, and its process exits when the transport does.
		_ = a.client.Close()
		a.client = nil
	}
	if page != nil {
		mygo.RunOnMain(func() { page.Destroy() })
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if supervisor != nil {
		// A quit is a requested shutdown: the supervisor must not restart the
		// Host it is being asked to stop.
		if err := supervisor.stop(ctx); err != nil {
			log.Printf("local: shutdown during quit: %v", err)
		}
		return
	}
	if host != nil {
		if err := host.stop(ctx); err != nil {
			log.Printf("local: shutdown during quit: %v", err)
		}
	}
}
