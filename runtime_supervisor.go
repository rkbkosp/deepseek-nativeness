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
	runtimeIdle        runtimePhase = "idle"
	runtimePhaseStart  runtimePhase = "starting"
	runtimePhaseReady  runtimePhase = "ready"
	runtimePhaseStop   runtimePhase = "stopping"
	runtimePhaseStopped runtimePhase = "stopped"
	runtimePhaseFailed runtimePhase = "failed"
)

const (
	runtimeReadyTimeout    = 180 * time.Second
	runtimeShutdownGrace   = 12 * time.Second
	runtimeTerminateGrace  = 5 * time.Second
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
	Type       string          `json:"type"`
	Phase      string          `json:"phase"`
	Stage      string          `json:"stage"`
	Message    string          `json:"message"`
	Diagnostic string          `json:"diagnostic"`
	URL        string          `json:"url"`
	Injections []any           `json:"injections"`
	Pid        int             `json:"pid"`
	Code       int             `json:"code"`
	Signal     string          `json:"signal"`
	Ready      bool            `json:"ready"`
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

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	phase   runtimePhase
	ready   runtimeReady
	failure string
	detail  string
	pid     int
	stderr  ringBuffer
	history []string
	exited  bool
	exitErr error

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
		unexpected := h.phase == runtimePhaseStart || h.phase == runtimePhaseReady
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
			h.setPhase(runtimePhaseStop)
		case "stopped":
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
	if h.phase == runtimePhaseStop || h.phase == runtimePhaseStopped || h.phase == runtimePhaseFailed {
		done := h.done
		h.mu.Unlock()
		select {
		case <-done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	h.phase = runtimePhaseStop
	stdin := h.stdin
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
	select {
	case <-h.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
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
