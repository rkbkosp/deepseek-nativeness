package main

// Supervision of one local dsh Host process.
//
// The Go process never speaks Node's IPC channel: it starts
// `runtime/launcher.mjs`, which prepares the profile, forks the official
// `@deepseek-ai/dsh-desktop-host`, forwards the private credential handshake,
// and republishes the Host's events as JSON lines on stdout. Those lines are
// the only protocol this file has to understand.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

type runtimePhase string

const (
	runtimeIdle         runtimePhase = "idle"
	runtimePhaseStart   runtimePhase = "starting"
	runtimePhaseReady   runtimePhase = "ready"
	runtimePhaseRestart runtimePhase = "restarting"
	runtimePhaseStop    runtimePhase = "stopping"
	runtimePhaseStopped runtimePhase = "stopped"
	runtimePhaseFailed  runtimePhase = "failed"
)

const (
	runtimeReadyTimeout   = 180 * time.Second
	runtimeShutdownGrace  = 12 * time.Second
	runtimeTerminateGrace = 5 * time.Second
	// runtimeKillRetry is how often a teardown repeats SIGKILL while the
	// process is not reaped yet.
	runtimeKillRetry       = 150 * time.Millisecond
	runtimeDiagnosticBytes = 64 * 1024
	runtimeLineBytes       = 8 * 1024 * 1024
)

// runtimeLaunch describes how to start the launcher.
type runtimeLaunch struct {
	Command string
	Args    []string
	Env     []string
	Dir     string

	// ReadyTimeout bounds the wait for the Host's `ready` event. Zero uses the
	// package default.
	ReadyTimeout time.Duration
	// OnEvent receives every non-handshake message the launcher forwards.
	OnEvent func(json.RawMessage)
}

// runtimeReady is what the Host publishes once it is serving the web client.
type runtimeReady struct {
	URL        string `json:"url"`
	Injections []any  `json:"injections"`
	Pid        int    `json:"pid"`
	SeedName   string
	SeedValue  string
}

// runtimeHostEvent is one decoded launcher line.
type runtimeHostEvent struct {
	Type       string `json:"type"`
	Phase      string `json:"phase"`
	Stage      string `json:"stage"`
	Message    string `json:"message"`
	Diagnostic string `json:"diagnostic"`
	URL        string `json:"url"`
	Injections []any  `json:"injections"`
	Pid        int    `json:"pid"`
	Code       int    `json:"code"`
	Signal     string `json:"signal"`
	Ready      bool   `json:"ready"`
	Seed       struct {
		Name   string `json:"name"`
		Value  string `json:"value"`
		Domain string `json:"domain"`
		Path   string `json:"path"`
	} `json:"seed"`
	Event json.RawMessage `json:"event"`
}

// runtimeHost supervises one launcher process.
type runtimeHost struct {
	launch runtimeLaunch

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	phase  runtimePhase
	ready  runtimeReady
	pid    int
	stderr ringBuffer
	// failure is the first terminal failure this generation recorded;
	// failureStage names the launcher stage that reported it, so a restart
	// policy can tell a broken profile from a Host that went away.
	failure      string
	failureStage string
	detail       string
	history      []string
	exited       bool
	exitErr      error
	exitCode     int
	exitSignal   string
	// stopping records that someone asked this generation to shut down: our
	// stop() or a launcher `stopping`/`stopped` status. It is what separates a
	// requested shutdown from a crash, and therefore a restart from silence.
	stopping bool

	readyOnce  sync.Once
	readyCh    chan struct{}
	failedOnce sync.Once
	failedCh   chan struct{}
	done       chan struct{}
}

func newRuntimeHost(launch runtimeLaunch) *runtimeHost {
	if launch.ReadyTimeout <= 0 {
		launch.ReadyTimeout = runtimeReadyTimeout
	}
	return &runtimeHost{
		launch:   launch,
		phase:    runtimePhaseStart,
		readyCh:  make(chan struct{}),
		failedCh: make(chan struct{}),
		done:     make(chan struct{}),
		stderr:   ringBuffer{limit: runtimeDiagnosticBytes},
	}
}

// start launches the launcher and begins decoding its protocol.
func (h *runtimeHost) start() error {
	cmd := exec.Command(h.launch.Command, h.launch.Args...)
	cmd.Env = h.launch.Env
	cmd.Dir = h.launch.Dir
	// Own process group so a shutdown signal reaches the Host's children too.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	// Stderr goes straight into the ring buffer: exec copies it on its own
	// goroutine, which Wait() drains, so diagnostics cannot race the exit.
	cmd.Stderr = &h.stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	h.mu.Lock()
	h.cmd = cmd
	h.stdin = stdin
	h.pid = cmd.Process.Pid
	h.mu.Unlock()

	readers := sync.WaitGroup{}
	readers.Add(1)
	go func() {
		defer readers.Done()
		h.readStdout(stdout)
	}()
	go func() {
		// Wait only after the protocol reader saw EOF: Wait closes the pipe.
		readers.Wait()
		err := cmd.Wait()
		h.mu.Lock()
		h.exited = true
		h.exitErr = err
		// The launcher's own `exit` line carries the signal; fall back to the
		// wait status so the reason a restart happens is always explainable.
		if h.exitSignal == "" && h.exitCode == 0 {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					if status.Signaled() {
						h.exitSignal = status.Signal().String()
					} else if status.ExitStatus() != 0 {
						h.exitCode = status.ExitStatus()
					}
				}
			}
		}
		unexpected := !h.stopping
		if h.phase != runtimePhaseFailed {
			h.phase = runtimePhaseStopped
		}
		h.mu.Unlock()
		// A process that dies while it should be serving must not leave callers
		// waiting; a shutdown we asked for is not a failure.
		if unexpected {
			h.fail("进程退出", "", h.diagnosticsTail(8))
		}
		close(h.done)
	}()
	return nil
}

func (h *runtimeHost) readStdout(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), runtimeLineBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		h.handleLine(line)
	}
}

func (h *runtimeHost) handleLine(line string) {
	var event runtimeHostEvent
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		h.record("无法解析的启动器输出：" + clip(line, 200))
		return
	}
	switch event.Type {
	case "status":
		switch event.Phase {
		case "preparing", "starting":
			h.setPhase(runtimePhaseStart)
		case "stopping":
			// The launcher is shutting its Host down (our request, or a signal
			// the launcher itself received). That is not a crash.
			h.markStopping()
			h.setPhase(runtimePhaseStop)
		case "stopped":
			h.markStopping()
			h.setPhase(runtimePhaseStopped)
		case "failed":
			h.fail(event.Stage, event.Message, event.Diagnostic)
		}
	case "ready":
		h.mu.Lock()
		phase := h.phase
		h.ready = runtimeReady{
			URL:        event.URL,
			Injections: event.Injections,
			Pid:        event.Pid,
			SeedName:   event.Seed.Name,
			SeedValue:  event.Seed.Value,
		}
		if phase != runtimePhaseFailed {
			h.phase = runtimePhaseReady
		}
		h.mu.Unlock()
		if phase != runtimePhaseFailed {
			h.readyOnce.Do(func() { close(h.readyCh) })
		}
	case "exit":
		h.mu.Lock()
		h.exited = true
		h.exitCode = event.Code
		h.exitSignal = event.Signal
		if h.phase != runtimePhaseFailed {
			h.phase = runtimePhaseStopped
		}
		h.mu.Unlock()
	case "host-event":
		if h.launch.OnEvent != nil && len(event.Event) > 0 {
			h.launch.OnEvent(event.Event)
		}
	default:
		h.record(clip(line, 200))
	}
}

func (h *runtimeHost) setPhase(phase runtimePhase) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase == runtimePhaseFailed && phase != runtimePhaseStopped {
		return
	}
	h.phase = phase
}

// markStopping records that this generation's shutdown was requested, so the
// exit that follows is reported as a shutdown rather than a crash.
func (h *runtimeHost) markStopping() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stopping = true
}

// intentional reports whether someone asked this generation to shut down.
func (h *runtimeHost) intentional() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.stopping
}

// markStartupFailure records that this generation never reached ready, so a
// restart policy does not spend its budget waiting on the same deadline again.
func (h *runtimeHost) markStartupFailure() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.failureStage == "" {
		h.failureStage = "starting"
	}
}

// restartable reports whether this generation's failure is worth retrying. A
// profile that cannot be prepared, a credential handshake the Host refused and a
// launcher that cannot be spawned all fail the same way every time; the Host
// process going away does not.
func (h *runtimeHost) restartable() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch h.failureStage {
	case "preparing", "starting", "authentication", "spawn":
		return false
	}
	return true
}

// finished reports whether the process has been reaped.
func (h *runtimeHost) finished() bool {
	select {
	case <-h.done:
		return true
	default:
		return false
	}
}

// exitReason describes why this generation's process is gone, for the status the
// supervisor publishes before it restarts.
func (h *runtimeHost) exitReason() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch {
	case h.exitSignal != "":
		return "Host 进程被信号 " + h.exitSignal + " 终止"
	case h.exitCode != 0:
		return fmt.Sprintf("Host 启动器退出码 %d", h.exitCode)
	case h.failure != "":
		return strings.Join(strings.Fields(h.failure), " ")
	}
	return "Host 进程已退出"
}

// killIfAlive sends SIGKILL to this generation's process group unless it has
// already been reaped: a reaped pid can be reused, and killing a reused process
// group would hit unrelated processes.
func (h *runtimeHost) killIfAlive() {
	h.mu.Lock()
	cmd, exited := h.cmd, h.exited
	h.mu.Unlock()
	if cmd == nil || cmd.Process == nil || exited {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

// fail records the first terminal failure. Later failures keep the first reason
// so the message a user sees is the original cause, not its shutdown echo.
func (h *runtimeHost) fail(stage, message, diagnostic string) {
	// Read the diagnostic sources before taking h.mu: both accessors lock, and
	// taking h.mu first would deadlock against them.
	stderrTail := h.stderr.tail()
	h.mu.Lock()
	already := h.phase == runtimePhaseFailed
	if !already {
		h.phase = runtimePhaseFailed
		h.failureStage = stage
		h.failure = stageLabel(stage, message)
		h.detail = strings.TrimSpace(strings.Join(nonEmpty(
			diagnostic, stderrTail, strings.Join(h.history, "\n")), "\n"))
	}
	h.mu.Unlock()
	if !already {
		h.failedOnce.Do(func() { close(h.failedCh) })
	}
}

func stageLabel(stage, message string) string {
	switch stage {
	case "preparing":
		return "准备 profile 失败：" + message
	case "starting":
		return "启动 Host 失败：" + message
	case "authentication":
		return "凭据握手失败：" + message
	case "spawn":
		return "启动器无法执行：" + message
	case "host":
		return "Host 终止：" + message
	case "进程退出":
		return "启动器提前退出" + message
	}
	if message == "" {
		return "本地运行时启动失败"
	}
	return message
}

func nonEmpty(values ...string) []string {
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			kept = append(kept, value)
		}
	}
	return kept
}

func (h *runtimeHost) record(line string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.history = append(h.history, line)
	if len(h.history) > 32 {
		h.history = h.history[len(h.history)-32:]
	}
}

func (h *runtimeHost) historyTail() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return strings.Join(h.history, "\n")
}

func clip(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}

func (h *runtimeHost) diagnosticsTail(lines int) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	tail := strings.Split(strings.TrimSpace(h.stderr.tail()), "\n")
	if len(tail) > lines {
		tail = tail[len(tail)-lines:]
	}
	return strings.Join(tail, "\n")
}

// waitReady blocks until the Host is serving, fails, or the context ends.
func (h *runtimeHost) waitReady(ctx context.Context) (runtimeReady, error) {
	timeout := time.NewTimer(h.launch.ReadyTimeout)
	defer timeout.Stop()
	select {
	case <-h.readyCh:
		h.mu.Lock()
		ready := h.ready
		h.mu.Unlock()
		return ready, nil
	case <-h.failedCh:
		return runtimeReady{}, errors.New(h.error())
	case <-h.done:
		return runtimeReady{}, errors.New(h.error())
	case <-timeout.C:
		// A Host that never came up is not a crash to retry: it would take the
		// same time again. Record it as a startup failure and report it once.
		h.markStartupFailure()
		h.kill()
		return runtimeReady{}, fmt.Errorf("本地运行时在 %s 内未就绪\n%s", h.launch.ReadyTimeout, h.error())
	case <-ctx.Done():
		return runtimeReady{}, ctx.Err()
	}
}

// error renders the recorded failure with its bounded diagnostics.
func (h *runtimeHost) error() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.phase == runtimePhaseFailed {
		if h.detail != "" {
			return strings.TrimSpace(h.failure + "\n" + h.detail)
		}
		return strings.TrimSpace(h.failure)
	}
	if h.exited {
		message := "本地运行时已退出"
		if h.exitErr != nil {
			message += "：" + h.exitErr.Error()
		}
		if tail := strings.TrimSpace(h.stderr.tail()); tail != "" {
			message += "\n" + tail
		}
		return message
	}
	return ""
}

// stop asks the launcher to shut the Host down, then escalates.
func (h *runtimeHost) stop(ctx context.Context) error {
	h.mu.Lock()
	// Every shutdown this process asks for is intentional: the supervisor must
	// never treat it as a crash and restart the Host afterwards.
	h.stopping = true
	phase := h.phase
	done, exited, stdin := h.done, h.exited, h.stdin
	if phase == runtimePhaseStop || phase == runtimePhaseStopped || phase == runtimePhaseFailed {
		h.mu.Unlock()
		// A failed or already-stopping generation can still be alive (a
		// launcher that reported a fatal Host but kept running), so make sure
		// it leaves instead of lingering past its supervision.
		for !exited {
			// A descendant forked around the signal can outlive the first
			// SIGKILL and keep the pipes Wait() drains open, so the kill is
			// repeated until the process is actually reaped.
			h.killIfAlive()
			h.mu.Lock()
			exited = h.exited
			h.mu.Unlock()
			if exited {
				break
			}
			select {
			case <-done:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(runtimeKillRetry):
			}
		}
		select {
		case <-done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	h.phase = runtimePhaseStop
	h.mu.Unlock()

	if stdin != nil {
		_, _ = io.WriteString(stdin, "{\"type\":\"shutdown\"}\n")
		_ = stdin.Close()
	}
	select {
	case <-h.done:
		return nil
	case <-time.After(runtimeShutdownGrace):
	}
	h.signal(syscall.SIGTERM)
	select {
	case <-h.done:
		return nil
	case <-time.After(runtimeTerminateGrace):
	}
	h.kill()
	for {
		select {
		case <-h.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(runtimeKillRetry):
			// Repeat the kill: a descendant forked around the first signal can
			// still be holding the pipes Wait() is draining.
			h.killIfAlive()
		}
	}
}

func (h *runtimeHost) signal(sig syscall.Signal) {
	h.mu.Lock()
	cmd := h.cmd
	h.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	// The launcher runs its Host in the same process group.
	_ = syscall.Kill(-cmd.Process.Pid, sig)
}

func (h *runtimeHost) kill() {
	h.mu.Lock()
	cmd := h.cmd
	h.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

// phaseOf reports the current phase for the shell's status text.
func (h *runtimeHost) phaseOf() runtimePhase {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.phase
}

// --- recovery -------------------------------------------------------------
//
// A Host that dies on its own (a crash, the OOM killer, a SIGKILL from outside)
// leaves the native client pointed at a dead port with a single-use token that
// can never be replayed. Restarting the launcher produces a new port and a new
// token, so recovery is two steps: bring a new Host up, then re-point the client
// at the new `ready` URL.
//
// A shutdown this process asked for is not a crash. Every generation therefore
// carries an intentional flag (see runtimeHost.stopping) and the supervisor only
// restarts a generation that exited without it.

// runtimeRecovery bounds the restarts one supervision run may perform.
type runtimeRecovery struct {
	// MaxAttempts bounds consecutive restarts. Zero disables recovery.
	MaxAttempts int
	// BaseDelay is the wait before the first restart; each further attempt
	// doubles it up to MaxDelay.
	BaseDelay time.Duration
	MaxDelay  time.Duration
	// HealthyFor is how long a generation must have served before its exit
	// starts a fresh attempt budget, so a Host that crashes once a day does not
	// exhaust a launch-long budget. Zero keeps one budget for the whole run.
	HealthyFor time.Duration
}

// defaultRuntimeRecovery is 1s, 2s, 4s, 8s, then give up: five restarts.
var defaultRuntimeRecovery = runtimeRecovery{
	MaxAttempts: 5,
	BaseDelay:   time.Second,
	MaxDelay:    8 * time.Second,
	HealthyFor:  60 * time.Second,
}

// delay is the backoff before restart attempt (1-based).
func (r runtimeRecovery) delay(attempt int) time.Duration {
	if r.BaseDelay <= 0 {
		return 0
	}
	delay := r.BaseDelay
	for step := 1; step < attempt; step++ {
		if r.MaxDelay > 0 && delay >= r.MaxDelay {
			return r.MaxDelay
		}
		delay *= 2
	}
	if r.MaxDelay > 0 && delay > r.MaxDelay {
		return r.MaxDelay
	}
	return delay
}

// runtimeRecoveryExhausted is the terminal message after the last restart: it
// names what happened and what the user can do about it.
const runtimeRecoveryExhausted = "本地 Host 连续 %d 次异常退出，已停止自动重启。" +
	"请用菜单「工作区 → 重新加载工作区」（⌘R）重试；若反复失败，请检查 profile 是否损坏、" +
	"是否有另一个 Harness 进程占用同一 profile，或磁盘空间是否充足。最近一次原因：%s"

// runtimeStatus is one phase change the supervisor publishes, including the
// restarts that the Host's own phases cannot describe.
type runtimeStatus struct {
	Phase   runtimePhase
	Attempt int
	Reason  string
	Message string
	URL     string
}

// runtimeSupervisor keeps one Host alive.
//
// It owns the process generations rather than the host owning its own restarts,
// so a restart is a fresh runtimeHost with fresh channels: nothing from the dead
// generation (its ready URL, its failure, its exit) can be mistaken for the new
// one.
type runtimeSupervisor struct {
	launch   runtimeLaunch
	recovery runtimeRecovery

	// OnHost receives each generation as it starts, for shell bookkeeping.
	OnHost func(host *runtimeHost)
	// OnStatus receives every phase, including restarting and the terminal
	// failure. It is called from the supervision goroutine.
	OnStatus func(status runtimeStatus)
	// OnReady receives each generation's ready URL. restarted is false for the
	// first generation. A returned error ends supervision with that message.
	OnReady func(ready runtimeReady, restarted bool) error

	mu       sync.Mutex
	host     *runtimeHost
	stopping bool
	stopCh   chan struct{}
	stopOnce sync.Once
}

func newRuntimeSupervisor(launch runtimeLaunch, recovery runtimeRecovery) *runtimeSupervisor {
	return &runtimeSupervisor{launch: launch, recovery: recovery, stopCh: make(chan struct{})}
}

// generationOutcome is why one supervised process stopped being supervised.
type generationOutcome int

const (
	// generationStopped means supervision was asked to stop.
	generationStopped generationOutcome = iota
	// generationFatal means the failure is not worth retrying.
	generationFatal
	// generationExited means the Host went away on its own.
	generationExited
)

// run starts the Host and restarts it after an unexpected exit, until it is
// stopped, fails permanently, or the restart budget is spent.
func (s *runtimeSupervisor) run(ctx context.Context) error {
	attempt := 0
	for {
		outcome, reason, fatal := s.generation(ctx, &attempt)
		if outcome != generationExited {
			return fatal
		}
		if attempt >= s.recovery.MaxAttempts {
			reason = strings.TrimSpace(reason)
			if reason == "" {
				reason = "未知原因"
			}
			message := fmt.Sprintf(runtimeRecoveryExhausted, attempt, reason)
			s.publish(runtimeStatus{Phase: runtimePhaseFailed, Attempt: attempt, Reason: reason, Message: message})
			return errors.New(message)
		}
		attempt++
		delay := s.recovery.delay(attempt)
		s.publish(runtimeStatus{
			Phase:   runtimePhaseRestart,
			Attempt: attempt,
			Reason:  reason,
			Message: fmt.Sprintf("本地 Host 已异常退出（%s），%s 后第 %d/%d 次重启。",
				strings.TrimSpace(reason), delay.Round(time.Millisecond), attempt, s.recovery.MaxAttempts),
		})
		if !s.sleep(ctx, delay) {
			return nil
		}
	}
}

// generation starts one Host process and waits until it is ready and gone again.
func (s *runtimeSupervisor) generation(ctx context.Context, attempt *int) (generationOutcome, string, error) {
	host := newRuntimeHost(s.launch)
	s.adopt(host)
	defer s.adopt(nil)
	if s.OnHost != nil {
		s.OnHost(host)
	}
	if s.stopped() {
		return generationStopped, "", nil
	}
	if err := host.start(); err != nil {
		// The launcher itself cannot be executed; a retry cannot help.
		return generationFatal, "", fmt.Errorf("启动器无法执行：%v", err)
	}
	if s.stopped() || ctx.Err() != nil {
		s.terminate(host)
		return generationStopped, "", nil
	}
	ready, waitErr := host.waitReady(ctx)
	serving := time.Time{}
	switch {
	case waitErr == nil:
		serving = time.Now()
		s.publish(runtimeStatus{Phase: runtimePhaseReady, Attempt: *attempt, URL: ready.URL})
		if s.OnReady != nil {
			if err := s.OnReady(ready, *attempt > 0); err != nil {
				s.terminate(host)
				return generationFatal, "", err
			}
		}
	case s.stopped() || ctx.Err() != nil || host.intentional():
		// A shutdown we asked for, including one requested while the Host was
		// still starting, is not a recovery case.
		s.terminate(host)
		return generationStopped, "", nil
	case !host.restartable():
		s.terminate(host)
		return generationFatal, "", waitErr
	}
	reason, exited := s.waitExit(host, ctx)
	switch {
	case !exited || s.stopped() || host.intentional():
		s.terminate(host)
		return generationStopped, "", nil
	case host.restartable():
		// Only a generation that actually served for a while refreshes the
		// budget; a Host that dies immediately keeps it shrinking.
		if s.recovery.HealthyFor > 0 && !serving.IsZero() && time.Since(serving) >= s.recovery.HealthyFor {
			*attempt = 0
		}
		return generationExited, reason, nil
	default:
		s.terminate(host)
		return generationFatal, "", errors.New(host.error())
	}
}

// waitExit blocks until this generation's process is gone, supervision is asked
// to stop, or the context ends. exited is false when the wait was interrupted.
func (s *runtimeSupervisor) waitExit(host *runtimeHost, ctx context.Context) (string, bool) {
	select {
	case <-host.done:
		return host.exitReason(), true
	case <-s.stopCh:
		return "", false
	case <-ctx.Done():
		return "", false
	}
}

// sleep waits out one backoff, returning false if supervision was stopped.
func (s *runtimeSupervisor) sleep(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		select {
		case <-s.stopCh:
			return false
		case <-ctx.Done():
			return false
		default:
			return true
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-s.stopCh:
		return false
	case <-ctx.Done():
		return false
	}
}

// stop ends supervision and shuts the current Host down.
func (s *runtimeSupervisor) stop(ctx context.Context) error {
	s.mu.Lock()
	host := s.host
	s.stopping = true
	s.mu.Unlock()
	s.stopOnce.Do(func() { close(s.stopCh) })
	if host == nil {
		return nil
	}
	return host.stop(ctx)
}

// stopped reports whether supervision was asked to end.
func (s *runtimeSupervisor) stopped() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopping
}

// current is the generation being supervised, if any.
func (s *runtimeSupervisor) current() *runtimeHost {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.host
}

func (s *runtimeSupervisor) adopt(host *runtimeHost) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.host = host
}

func (s *runtimeSupervisor) publish(status runtimeStatus) {
	if s.OnStatus != nil {
		s.OnStatus(status)
	}
}

// terminate shuts one generation down without waiting on the caller's context.
func (s *runtimeSupervisor) terminate(host *runtimeHost) {
	if host == nil || host.finished() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), runtimeShutdownGrace+runtimeTerminateGrace+time.Second)
	defer cancel()
	_ = host.stop(ctx)
}

// ringBuffer keeps the last `limit` bytes written to it.
type ringBuffer struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

// Write implements io.Writer so exec can copy the child's stderr directly.
func (r *ringBuffer) Write(chunk []byte) (int, error) {
	r.write(chunk)
	return len(chunk), nil
}

func (r *ringBuffer) write(chunk []byte) {
	if r.limit <= 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data = append(r.data, chunk...)
	if len(r.data) > r.limit {
		r.data = append(r.data[:0], r.data[len(r.data)-r.limit:]...)
	}
}

func (r *ringBuffer) tail() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return string(r.data)
}

// ensure the payload type is referenced from this file's documentation helpers
var _ = os.Getenv
