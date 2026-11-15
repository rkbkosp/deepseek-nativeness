package main

// Recovery behaviour: an unexpected Host exit is restarted under a bounded
// backoff, a requested shutdown is not restarted at all, and every restart
// re-points the native client at the Host's new ready URL.
//
// The launcher is a shell script and the Host's HTTP surface is a test server, so
// none of this needs the 800 MiB runtime payload.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// recoveryLauncher runs a shell script as the launcher, with the fake URLs the
// script publishes.
func recoveryLauncher(t *testing.T, dir, script string, env ...string) runtimeLaunch {
	t.Helper()
	return runtimeLaunch{
		Command:      "/bin/sh",
		Args:         []string{"-c", script},
		Dir:          dir,
		Env:          append(os.Environ(), env...),
		ReadyTimeout: 15 * time.Second,
	}
}

// fastRecovery keeps the backoff shape of the production policy but short
// enough that a test does not wait 15 seconds for it.
func fastRecovery(attempts int) runtimeRecovery {
	return runtimeRecovery{
		MaxAttempts: attempts,
		BaseDelay:   5 * time.Millisecond,
		MaxDelay:    20 * time.Millisecond,
		HealthyFor:  time.Hour, // never refresh the budget mid-test
	}
}

// countPath is the file the fake launcher increments once per generation.
func countPath(dir string) string { return filepath.Join(dir, "count") }

// launcherRuns reports how many times the launcher was started.
func launcherRuns(t *testing.T, dir string) int {
	t.Helper()
	raw, err := os.ReadFile(countPath(dir))
	if err != nil {
		return 0
	}
	n := 0
	if _, err := fmt.Sscanf(strings.TrimSpace(string(raw)), "%d", &n); err != nil {
		t.Fatalf("launcher counter is unreadable: %v", err)
	}
	return n
}

// crashOnceThenServe kills itself on the first generation and serves on the
// second, which is what an unexpected Host exit looks like to the supervisor.
func crashOnceThenServe(dir string) string {
	return "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
if [ "$n" -eq 1 ]; then
  printf '%s\n' '{"type":"status","phase":"starting"}'
  printf '%s\n' "{\"type\":\"ready\",\"url\":\"$FAKE_URL1\",\"pid\":$$}"
  sleep 0.2
  kill -9 $$
fi
printf '%s\n' "{\"type\":\"ready\",\"url\":\"$FAKE_URL2\",\"pid\":$$}"
cat > /dev/null
`
}

// serveUntilStopped reports ready once and waits for the supervisor's shutdown.
func serveUntilStopped(dir string) string {
	return "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
printf '%s\n' "{\"type\":\"ready\",\"url\":\"$FAKE_URL1\",\"pid\":$$}"
cat > /dev/null
`
}

// serveThenExit leaves right after reporting ready, every time.
func serveThenExit(dir string) string {
	return "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
printf '%s\n' "{\"type\":\"ready\",\"url\":\"http://127.0.0.1:31$n/?token=x$n\",\"pid\":$$}"
exit 0
`
}

// recorder collects what one supervisor published. readyCh closes once the
// expected number of generations reported ready.
type recorder struct {
	mu      sync.Mutex
	status  []runtimeStatus
	urls    []string
	restart []bool
	readyCh chan struct{}
	want    int
	once    sync.Once
}

func newRecorder(want int) *recorder {
	return &recorder{readyCh: make(chan struct{}), want: want}
}

func (r *recorder) onStatus(status runtimeStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.status = append(r.status, status)
}

func (r *recorder) onReady(ready runtimeReady, restarted bool) error {
	r.mu.Lock()
	r.urls = append(r.urls, ready.URL)
	r.restart = append(r.restart, restarted)
	enough := len(r.urls) >= r.want
	r.mu.Unlock()
	if enough {
		r.once.Do(func() { close(r.readyCh) })
	}
	return nil
}

func (r *recorder) readies() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.urls...)
}

func (r *recorder) phases() []runtimeStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]runtimeStatus(nil), r.status...)
}

// runSupervisor starts supervision and fails the test if it does not stop.
func runSupervisor(t *testing.T, supervisor *runtimeSupervisor) (func() error, <-chan error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	done := make(chan error, 1)
	go func() { done <- supervisor.run(ctx) }()
	return func() error {
		defer cancel()
		stopCtx, stopDone := context.WithTimeout(context.Background(), 20*time.Second)
		defer stopDone()
		return supervisor.stop(stopCtx)
	}, done
}

func waitForRun(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(30 * time.Second):
		t.Fatal("supervision did not return")
		return nil
	}
}

// TestRecoveryRestartsAfterUnexpectedExit is the core chain: the Host dies on its
// own, the supervisor publishes a restart with attempt and reason, then brings a
// new generation up on a different ready URL.
func TestRecoveryRestartsAfterUnexpectedExit(t *testing.T) {
	dir := t.TempDir()
	record := newRecorder(2)
	supervisor := newRuntimeSupervisor(recoveryLauncher(t, dir, crashOnceThenServe(dir),
		"FAKE_URL1=http://127.0.0.1:24001/?token=one",
		"FAKE_URL2=http://127.0.0.1:24002/?token=two",
	), fastRecovery(3))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	stop, done := runSupervisor(t, supervisor)
	select {
	case <-record.readyCh:
	case <-time.After(30 * time.Second):
		t.Fatal("the supervisor never reported both ready URLs")
	}
	if err := stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := waitForRun(t, done); err != nil {
		t.Fatalf("run after a recovered restart: %v", err)
	}

	readies := record.readies()
	if len(readies) != 2 {
		t.Fatalf("ready URLs = %v", readies)
	}
	if readies[0] == readies[1] {
		t.Fatalf("the restart reused the dead URL: %v", readies)
	}
	if flags := record.restart; len(flags) != 2 || flags[0] || !flags[1] {
		t.Fatalf("restart flags = %v", flags)
	}
	var restartStatus *runtimeStatus
	for _, status := range record.phases() {
		if status.Phase == runtimePhaseRestart {
			copied := status
			restartStatus = &copied
		}
	}
	if restartStatus == nil {
		t.Fatal("no restarting phase was published")
	}
	if restartStatus.Attempt != 1 {
		t.Errorf("restart attempt = %d, want 1", restartStatus.Attempt)
	}
	if !strings.Contains(restartStatus.Reason, "信号") {
		t.Errorf("restart reason = %q, want the signal that ended the Host", restartStatus.Reason)
	}
	if runs := launcherRuns(t, dir); runs != 2 {
		t.Errorf("launcher ran %d times, want 2", runs)
	}
}

// TestRecoveryIgnoresRequestedShutdown is the other half of the rule: stopping a
// local runtime (closing the workspace, quitting, or the app's own stop) must not
// come back to life.
func TestRecoveryIgnoresRequestedShutdown(t *testing.T) {
	dir := t.TempDir()
	record := newRecorder(1)
	supervisor := newRuntimeSupervisor(recoveryLauncher(t, dir, serveUntilStopped(dir),
		"FAKE_URL1=http://127.0.0.1:24003/?token=one",
	), fastRecovery(3))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	stop, done := runSupervisor(t, supervisor)
	select {
	case <-record.readyCh:
	case <-time.After(30 * time.Second):
		t.Fatal("the Host never became ready")
	}
	if err := stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := waitForRun(t, done); err != nil {
		t.Fatalf("run after a requested shutdown: %v", err)
	}
	// Give a wrongly-scheduled restart time to show up.
	time.Sleep(150 * time.Millisecond)
	if runs := launcherRuns(t, dir); runs != 1 {
		t.Fatalf("launcher ran %d times after a requested shutdown", runs)
	}
	for _, status := range record.phases() {
		if status.Phase == runtimePhaseRestart {
			t.Fatalf("a requested shutdown published a restart: %+v", status)
		}
	}
}

// TestRecoveryIgnoresLauncherShutdown covers the other way a shutdown is
// requested: the launcher is signalled and reports `stopping` itself.
func TestRecoveryIgnoresLauncherShutdown(t *testing.T) {
	dir := t.TempDir()
	script := "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
trap 'printf "%s\n" "{\"type\":\"status\",\"phase\":\"stopping\"}"; exit 0' TERM
printf '%s\n' "{\"type\":\"ready\",\"url\":\"$FAKE_URL1\",\"pid\":$$}"
while :; do sleep 0.05; done
`
	record := newRecorder(1)
	supervisor := newRuntimeSupervisor(recoveryLauncher(t, dir, script,
		"FAKE_URL1=http://127.0.0.1:24004/?token=one",
	), fastRecovery(3))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	_, done := runSupervisor(t, supervisor)
	select {
	case <-record.readyCh:
	case <-time.After(30 * time.Second):
		t.Fatal("the Host never became ready")
	}
	supervisor.current().signal(syscall.SIGTERM)
	if err := waitForRun(t, done); err != nil {
		t.Fatalf("run after the launcher shut its Host down: %v", err)
	}
	time.Sleep(150 * time.Millisecond)
	if runs := launcherRuns(t, dir); runs != 1 {
		t.Fatalf("launcher ran %d times after a launcher-requested shutdown", runs)
	}
}

// TestRecoveryStopsAfterBoundedAttempts pins the bound: a Host that keeps dying
// is restarted exactly MaxAttempts times, then reported with actionable copy.
func TestRecoveryStopsAfterBoundedAttempts(t *testing.T) {
	dir := t.TempDir()
	record := newRecorder(1)
	supervisor := newRuntimeSupervisor(recoveryLaunchForExhaustion(t, dir), fastRecovery(2))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	_, done := runSupervisor(t, supervisor)
	err := waitForRun(t, done)
	if err == nil {
		t.Fatal("supervision must fail once the restart budget is spent")
	}
	message := err.Error()
	for _, want := range []string{"连续 2 次", "已停止自动重启", "重新加载工作区"} {
		if !strings.Contains(message, want) {
			t.Errorf("error %q does not mention %q", message, want)
		}
	}
	// The first generation plus two restarts.
	if runs := launcherRuns(t, dir); runs != 3 {
		t.Errorf("launcher ran %d times, want 3", runs)
	}
	if readies := record.readies(); len(readies) != 3 {
		t.Errorf("ready generations = %d, want 3", len(readies))
	}
	published := record.phases()
	failed := 0
	for _, status := range published {
		if status.Phase == runtimePhaseFailed {
			failed++
			if status.Attempt != 2 {
				t.Errorf("failed attempt = %d, want 2", status.Attempt)
			}
		}
	}
	if failed != 1 {
		t.Errorf("failed phases = %d, want 1", failed)
	}
}

// recoveryLaunchForExhaustion serves and leaves, so every generation consumes a
// restart attempt.
func recoveryLaunchForExhaustion(t *testing.T, dir string) runtimeLaunch {
	t.Helper()
	return recoveryLauncher(t, dir, serveThenExit(dir), "FAKE_URL1=http://127.0.0.1:24005/")
}

// TestRecoveryRestartsWhenTheLauncherDiesBeforeReady covers a crash during
// startup: nothing was serving yet, but the exit was still nobody's request.
func TestRecoveryRestartsWhenTheLauncherDiesBeforeReady(t *testing.T) {
	dir := t.TempDir()
	script := "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
if [ "$n" -eq 1 ]; then
  printf '%s\n' '{"type":"status","phase":"starting"}'
  echo "boom" >&2
  exit 4
fi
printf '%s\n' "{\"type\":\"ready\",\"url\":\"$FAKE_URL2\",\"pid\":$$}"
cat > /dev/null
`
	record := newRecorder(1)
	supervisor := newRuntimeSupervisor(recoveryLauncher(t, dir, script,
		"FAKE_URL2=http://127.0.0.1:24006/?token=two",
	), fastRecovery(2))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	stop, done := runSupervisor(t, supervisor)
	select {
	case <-record.readyCh:
	case <-time.After(30 * time.Second):
		t.Fatal("the Host was not restarted after a startup crash")
	}
	if err := stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := waitForRun(t, done); err != nil {
		t.Fatalf("run: %v", err)
	}
	if runs := launcherRuns(t, dir); runs != 2 {
		t.Errorf("launcher ran %d times, want 2", runs)
	}
}

// TestRecoveryDoesNotRestartDeterministicFailure keeps a broken profile from
// being retried five times: only the Host going away is a recovery case.
func TestRecoveryDoesNotRestartDeterministicFailure(t *testing.T) {
	dir := t.TempDir()
	script := "count_file=" + countPath(dir) + `
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
printf '%s\n' '{"type":"status","phase":"failed","stage":"preparing","message":"profile 已损坏","diagnostic":"detail"}'
cat > /dev/null
`
	record := newRecorder(1)
	supervisor := newRuntimeSupervisor(recoveryLauncher(t, dir, script), fastRecovery(3))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	_, done := runSupervisor(t, supervisor)
	err := waitForRun(t, done)
	if err == nil || !strings.Contains(err.Error(), "profile 已损坏") {
		t.Fatalf("failure = %v, want the profile error", err)
	}
	if runs := launcherRuns(t, dir); runs != 1 {
		t.Fatalf("launcher ran %d times, want 1", runs)
	}
	for _, status := range record.phases() {
		if status.Phase == runtimePhaseRestart {
			t.Fatalf("a deterministic failure was retried: %+v", status)
		}
	}
}

// TestRecoveryDoesNotRetryAReadyTimeout keeps the budget for real crashes: a Host
// that never comes up would only take the same deadline again.
func TestRecoveryDoesNotRetryAReadyTimeout(t *testing.T) {
	dir := t.TempDir()
	record := newRecorder(1)
	launch := recoveryLauncher(t, dir, "count_file="+countPath(dir)+`
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
printf '%s\n' '{"type":"status","phase":"starting"}'
sleep 30
`)
	launch.ReadyTimeout = 300 * time.Millisecond
	supervisor := newRuntimeSupervisor(launch, fastRecovery(3))
	supervisor.OnStatus = record.onStatus
	supervisor.OnReady = record.onReady

	_, done := runSupervisor(t, supervisor)
	err := waitForRun(t, done)
	if err == nil || !strings.Contains(err.Error(), "未就绪") {
		t.Fatalf("failure = %v, want the ready timeout", err)
	}
	if runs := launcherRuns(t, dir); runs != 1 {
		t.Fatalf("launcher ran %d times after a ready timeout, want 1", runs)
	}
	for _, status := range record.phases() {
		if status.Phase == runtimePhaseRestart {
			t.Fatalf("a ready timeout was retried: %+v", status)
		}
	}
}

// TestRecoveryBackoffGrowsAndCaps pins the published shape: 1s, 2s, 4s, 8s, then
// the cap, for at most five restarts.
func TestRecoveryBackoffGrowsAndCaps(t *testing.T) {
	policy := defaultRuntimeRecovery
	if policy.MaxAttempts != 5 {
		t.Errorf("default MaxAttempts = %d, want 5", policy.MaxAttempts)
	}
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 8 * time.Second, 8 * time.Second}
	for index, expected := range want {
		if got := policy.delay(index + 1); got != expected {
			t.Errorf("delay(%d) = %s, want %s", index+1, got, expected)
		}
	}
	if policy.delay(0) != time.Second {
		t.Errorf("delay(0) = %s, want the base delay", policy.delay(0))
	}
	disabled := runtimeRecovery{MaxAttempts: 0}
	if got := disabled.delay(3); got != 0 {
		t.Errorf("disabled policy delay = %s, want 0", got)
	}
}

// TestLocalSupervisorRebindsTheHelperToTheNewURL covers the shell half of the
// chain: the restart's new ready URL is handed to the helper, and the state the
// user sees explains the interruption.
func TestLocalSupervisorRebindsTheHelperToTheNewURL(t *testing.T) {
	dir := t.TempDir()
	serve := func(body string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(body))
		}))
	}
	first, second := serve("first"), serve("second")
	defer first.Close()
	defer second.Close()

	a := newApp(false)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true, payload: &runtimePayload{}}
	a.localRuntime = local

	var mu sync.Mutex
	var bound []string
	var restartCopy string
	boundTwice := make(chan struct{})
	var once sync.Once
	local.bind = func(url string) error {
		mu.Lock()
		bound = append(bound, url)
		count := len(bound)
		if count == 2 {
			restartCopy = local.status
		}
		mu.Unlock()
		if count == 2 {
			once.Do(func() { close(boundTwice) })
		}
		return nil
	}

	supervisor := a.newLocalSupervisor(local, recoveryLauncher(t, dir, crashOnceThenServe(dir),
		"FAKE_URL1="+first.URL,
		"FAKE_URL2="+second.URL,
	))
	supervisor.recovery = fastRecovery(2)

	stop, done := runSupervisor(t, supervisor)
	select {
	case <-boundTwice:
	case <-time.After(30 * time.Second):
		t.Fatal("the helper was never re-pointed at the restarted Host")
	}
	if err := stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := waitForRun(t, done); err != nil {
		t.Fatalf("run: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(bound) != 2 {
		t.Fatalf("helper binds = %v", bound)
	}
	if bound[0] != first.URL {
		t.Errorf("first bind = %q, want %q", bound[0], first.URL)
	}
	if bound[1] != second.URL {
		t.Errorf("rebind = %q, want the restarted URL %q", bound[1], second.URL)
	}
	_ = restartCopy
	if local.restarts < 1 {
		t.Errorf("restarts = %d, want at least 1", local.restarts)
	}
	if local.lastRestart == "" {
		t.Error("the restart reason was not recorded")
	}
}

// TestRebindRetiresTheConnectionEpoch pins the epoch rule. A replacement carrier
// starts its own generation counter at zero, so the watermark the dead carrier
// advanced (it kept retrying while its Host was down) must not outlive it.
// Without this the new carrier's `configure` reply looks stale, the reconnect is
// never requested, and the window stays disconnected with no error to explain it.
func TestRebindRetiresTheConnectionEpoch(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true, payload: &runtimePayload{}}
	a.localRuntime = local
	a.remoteGeneration = 7
	a.connected = true
	a.client = nil

	var bound string
	local.bind = func(url string) error {
		bound = url
		return nil
	}
	const next = "http://127.0.0.1:24010/?token=x"
	if err := a.bindLocalHelper(local, next); err != nil {
		t.Fatalf("bindLocalHelper: %v", err)
	}
	if bound != next {
		t.Fatalf("helper was not re-pointed at %q: %q", next, bound)
	}
	if a.remoteGeneration != 0 {
		t.Errorf("connection epoch survived the carrier: %d", a.remoteGeneration)
	}
	if a.connected {
		t.Error("the shell still claims the dead carrier's connection")
	}
}

// TestApplyLocalStatusPublishesRestartCopy pins the text a restart shows: an
// explained interruption, not a silent disconnect, and an actionable failure once
// the budget is spent.
func TestApplyLocalStatusPublishesRestartCopy(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true}
	a.localRuntime = local
	a.connected = true

	a.applyLocalStatus(local, runtimeStatus{
		Phase:   runtimePhaseRestart,
		Attempt: 2,
		Reason:  "Host 进程被信号 SIGKILL 终止",
	})
	if !strings.Contains(local.status, "第 2 次") || !strings.Contains(local.status, "SIGKILL") {
		t.Errorf("restart status = %q, want the attempt and the reason", local.status)
	}
	if a.status != "本地 Host 已重启，正在恢复" {
		t.Errorf("shell status = %q", a.status)
	}
	if a.connected {
		t.Error("the shell must not claim a connection while the Host is gone")
	}

	a.applyLocalStatus(local, runtimeStatus{Phase: runtimePhaseReady})
	if local.status != "" {
		t.Errorf("status after ready = %q, want cleared", local.status)
	}

	a.applyLocalStatus(local, runtimeStatus{
		Phase:   runtimePhaseFailed,
		Message: fmt.Sprintf(runtimeRecoveryExhausted, 5, "Host 进程被信号 SIGKILL 终止"),
	})
	if local.err == "" || !strings.Contains(local.err, "重新加载工作区") {
		t.Errorf("terminal message = %q, want the actionable retry hint", local.err)
	}
}

// TestCloseLocalRuntimeStopsWithoutRestart exercises the app's own shutdown path:
// closing the local runtime must end supervision, not feed it a restart.
func TestCloseLocalRuntimeStopsWithoutRestart(t *testing.T) {
	dir := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	a := newApp(false)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true, payload: &runtimePayload{}}
	a.localRuntime = local
	bound := make(chan string, 4)
	local.bind = func(url string) error {
		bound <- url
		return nil
	}

	supervisor := a.newLocalSupervisor(local, recoveryLauncher(t, dir, serveUntilStopped(dir),
		"FAKE_URL1="+server.URL,
	))
	supervisor.recovery = fastRecovery(3)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- supervisor.run(ctx) }()

	select {
	case <-bound:
	case <-time.After(30 * time.Second):
		t.Fatal("the Host never became ready")
	}
	a.closeLocalRuntime()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run after closeLocalRuntime: %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("supervision did not stop when the local runtime closed")
	}
	time.Sleep(150 * time.Millisecond)
	if runs := launcherRuns(t, dir); runs != 1 {
		t.Fatalf("launcher ran %d times after the local runtime closed", runs)
	}
}

// A reconnect publishes `connected` before the catalog it triggered has been
// read back. Resume must wait for the row instead of giving up on the first
// empty catalog, or a restart drops the user into an empty window.
func TestResumeWaitsForTheSessionCatalog(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true}
	a.localRuntime = local
	a.connected = true
	a.sessions = nil
	a.sessionID = ""

	a.resumeLocalSession(local, "session-1")
	time.Sleep(200 * time.Millisecond)
	if a.sessionID != "" {
		t.Fatalf("resumed before the catalog carried the session: %q", a.sessionID)
	}

	a.sessions = []session{{ID: "session-1"}}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && a.sessionID != "session-1" {
		time.Sleep(20 * time.Millisecond)
	}
	if a.sessionID != "session-1" {
		t.Fatal("resume never opened the session once the catalog carried it")
	}
}

// The user's choice wins: a session opened while the resume waits is not
// replaced by the pre-restart selection.
func TestResumeDoesNotOverrideANewerSelection(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true}
	a.localRuntime = local
	a.connected = true
	a.sessions = []session{{ID: "session-1"}, {ID: "session-2"}}
	a.sessionID = ""

	a.resumeLocalSession(local, "session-1")
	// The user opens another Session before the goroutine looks.
	a.sessionID = "session-2"
	time.Sleep(300 * time.Millisecond)
	if a.sessionID != "session-2" {
		t.Fatalf("resume overrode the user's selection: %q", a.sessionID)
	}
}
