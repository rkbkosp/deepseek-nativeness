package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// fakeLauncher runs a shell script as the launcher, so the supervisor's protocol
// handling is tested without the 800 MiB runtime payload.
func fakeLauncher(t *testing.T, script string) *runtimeHost {
	t.Helper()
	host := newRuntimeHost(runtimeLaunch{
		Command:      "/bin/sh",
		Args:         []string{"-c", script},
		Dir:          t.TempDir(),
		ReadyTimeout: 5 * time.Second,
	})
	if err := host.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = host.stop(ctx)
	})
	return host
}

func TestRuntimeHostReachesReady(t *testing.T) {
	host := fakeLauncher(t, `
printf '%s\n' '{"type":"status","phase":"preparing"}'
printf '%s\n' '{"type":"status","phase":"starting","pid":1}'
printf '%s\n' '{"type":"ready","url":"http://127.0.0.1:1234/?token=abc","injections":[1,2],"pid":4242,"seed":{"name":"dsh-desktop-session","value":"x"}}'
cat > /dev/null
`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ready, err := host.waitReady(ctx)
	if err != nil {
		t.Fatalf("waitReady: %v", err)
	}
	if ready.URL != "http://127.0.0.1:1234/?token=abc" {
		t.Errorf("url = %q", ready.URL)
	}
	if ready.Pid != 4242 || ready.SeedName != "dsh-desktop-session" || ready.SeedValue != "x" {
		t.Errorf("ready = %+v", ready)
	}
	if len(ready.Injections) != 2 {
		t.Errorf("injections = %d", len(ready.Injections))
	}
	if host.phaseOf() != runtimePhaseReady {
		t.Errorf("phase = %q", host.phaseOf())
	}

	// Shutdown writes the protocol line and waits for the process to leave.
	drop := context.Background()
	if err := host.stop(drop); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if host.phaseOf() != runtimePhaseStopped {
		t.Errorf("phase after stop = %q", host.phaseOf())
	}
}

func TestRuntimeHostReportsFailure(t *testing.T) {
	host := fakeLauncher(t, `
printf '%s\n' '{"type":"status","phase":"failed","stage":"preparing","message":"profile 已损坏","diagnostic":"detail line"}'
cat > /dev/null
`)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := host.waitReady(ctx)
	if err == nil {
		t.Fatal("expected a failure")
	}
	message := err.Error()
	for _, want := range []string{"profile 已损坏", "detail line"} {
		if !strings.Contains(message, want) {
			t.Errorf("error %q does not mention %q", message, want)
		}
	}
	if host.phaseOf() != runtimePhaseFailed {
		t.Errorf("phase = %q", host.phaseOf())
	}
}

func TestRuntimeHostPrematureExitFails(t *testing.T) {
	host := fakeLauncher(t, `
printf '%s\n' '{"type":"status","phase":"starting"}'
echo "launcher exploded" >&2
exit 3
`)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_, err := host.waitReady(ctx)
	if err == nil {
		t.Fatal("expected a failure")
	}
	if !strings.Contains(err.Error(), "退出") {
		t.Errorf("error = %q", err.Error())
	}
	if !strings.Contains(err.Error(), "launcher exploded") {
		t.Errorf("stderr tail missing from %q", err.Error())
	}
}

func TestRuntimeHostReadyTimeout(t *testing.T) {
	host := newRuntimeHost(runtimeLaunch{
		Command:      "/bin/sh",
		Args:         []string{"-c", "printf '%s\\n' '{\"type\":\"status\",\"phase\":\"starting\"}'; sleep 30"},
		Dir:          t.TempDir(),
		ReadyTimeout: 300 * time.Millisecond,
	})
	if err := host.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	started := time.Now()
	if _, err := host.waitReady(ctx); err == nil {
		t.Fatal("expected a timeout")
	}
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Errorf("timeout took %s", elapsed)
	}
	if host.phaseOf() == runtimePhaseReady {
		t.Errorf("phase = %q", host.phaseOf())
	}
}

func TestRuntimeHostForwardsHostEvents(t *testing.T) {
	events := make(chan json.RawMessage, 4)
	host := newRuntimeHost(runtimeLaunch{
		Command: "/bin/sh",
		Args: []string{"-c", `
printf '%s\n' '{"type":"host-event","event":{"type":"platform-session","session":null}}'
printf '%s\n' '{"type":"ready","url":"http://127.0.0.1:9/","pid":1}'
cat > /dev/null
`},
		Dir:          t.TempDir(),
		ReadyTimeout: 5 * time.Second,
		OnEvent:      func(raw json.RawMessage) { events <- raw },
	})
	if err := host.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = host.stop(ctx)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := host.waitReady(ctx); err != nil {
		t.Fatalf("waitReady: %v", err)
	}
	select {
	case raw := <-events:
		if !strings.Contains(string(raw), "platform-session") {
			t.Errorf("event = %s", raw)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no host event forwarded")
	}
}

func TestRingBufferKeepsTail(t *testing.T) {
	buffer := ringBuffer{limit: 8}
	buffer.write([]byte("abcdefghij"))
	if got := buffer.tail(); got != "cdefghij" {
		t.Errorf("tail = %q", got)
	}
	buffer.write([]byte("12"))
	if got := buffer.tail(); got != "efghij12" {
		t.Errorf("tail = %q", got)
	}
}
