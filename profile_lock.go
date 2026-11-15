package main

// Profile ownership checks.
//
// The client deliberately keeps the official `desktop` profile name so that
// sessions, settings, credentials and installed plugins carry over with no
// migration. The cost is that two Hosts must never run against one profile:
// the official shell relied on its single-instance lock, and the Host itself
// takes no lock. These helpers make that exclusive in practice.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// errProfileBusy means another process is preparing or serving this profile.
var errProfileBusy = errors.New("profile 正在被另一个 Harness 进程使用")

// originalBundleExecutable is the installed application's main binary, used to
// detect that the original app is running against the same profile.
const originalBundleExecutable = "DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"

// profileLockOwner reports the PID recorded in the profile lock, when a lock
// exists and its owner is still alive. The lock only covers profile
// preparation, not the Host lifetime, so a stale file is not an error.
func profileLockOwner(home string) (int, bool) {
	path := filepath.Join(home, "profiles", "desktop", "lock")
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	if err := syscall.Kill(pid, 0); err != nil && !errors.Is(err, syscall.EPERM) {
		return pid, false
	}
	return pid, true
}

// originalHarnessPID reports a running installed application, if any.
//
// A bounded `pgrep` is used instead of AppKit so the check needs no cgo and
// cannot hang a launch: on any error it reports "not running" and the caller
// proceeds, because a false negative only costs a clearer error later.
func originalHarnessPID() (int, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	output, err := exec.CommandContext(ctx, "pgrep", "-f", originalBundleExecutable).Output()
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		pid, err := strconv.Atoi(strings.TrimSpace(line))
		if err == nil && pid > 0 && pid != os.Getpid() {
			return pid, true
		}
	}
	return 0, false
}

// ensureProfileAvailable refuses to start when this profile is already owned.
//
// The installed application is only a conflict for the shared Harness home: an
// isolated DSH_HOME (used by tests and QA) never touches its profile.
func ensureProfileAvailable(home string) error {
	if pid, active := profileLockOwner(home); active {
		return fmt.Errorf("%w：profile 锁被 PID %d 持有，请先退出那个进程", errProfileBusy, pid)
	}
	if !samePath(home, sharedHarnessHome()) {
		return nil
	}
	if pid, running := originalHarnessPID(); running {
		return fmt.Errorf("%w：原版 DeepSeek Harness（PID %d）正在运行，二者共用 ~/.dsh/profiles/desktop，"+
			"请先退出原版再启动本地运行时", errProfileBusy, pid)
	}
	return nil
}

// sharedHarnessHome is the home the installed application uses.
func sharedHarnessHome() string {
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, ".dsh")
}

// samePath reports whether two paths name the same directory, resolving
// symlinks when possible so /var and /private/var compare equal on macOS.
func samePath(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	if a, err := filepath.EvalSymlinks(left); err == nil {
		left = a
	}
	if b, err := filepath.EvalSymlinks(right); err == nil {
		right = b
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
