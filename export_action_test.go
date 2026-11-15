package main

// The Session archive export is a two-step chain: the local helper writes a ZIP
// beside itself and answers with its path, then this client streams that file to
// the place the user picks. The helper here is a real stdio process, so the
// method name and parameters cross the same carrier a real run uses, and the
// fixture archive is a real file, so the copy and the cleanup are real too.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"native-dsh/desktop/internal/bridge"
)

// sessionZipFixturePayload is not a valid archive: only the bytes matter here,
// and the receipt's size check compares them against the file on disk.
const sessionZipFixturePayload = "PK\x03\x04fixture-archive"

type sessionZipFixture struct {
	a       *app
	ctx     context.Context
	client  *bridge.Client
	updates chan func()
	logPath string
	zipPath string
	destDir string
	dest    string
	panels  int
	panelTo string
}

// sessionZipHelper is the fake helper: it records every request and answers with
// a real archive, or with a failure when told to.
func sessionZipHelper(logPath, zipPath string, fail bool) string {
	return fmt.Sprintf(`const fs = require("node:fs");
const readline = require("node:readline");
const logPath = %q, zipPath = %q, fail = %t;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(logPath, JSON.stringify({ method: request.method, params: request.params }) + "\n");
  if (fail) {
    process.stdout.write(JSON.stringify({ id: request.id, error: { code: "INTERNAL", message: "fixture host cannot write the archive" } }) + "\n");
    return;
  }
  fs.writeFileSync(zipPath, Buffer.from(%q, "utf8"));
  const bytes = fs.statSync(zipPath).size;
  process.stdout.write(JSON.stringify({ id: request.id, result: { status: "completed", path: zipPath, bytes: bytes, name: "dsh-session-fixture.zip" } }) + "\n");
});
`, logPath, zipPath, fail, sessionZipFixturePayload)
}

// newSessionZipFixture starts the helper and an app that owns its Host, so the
// export takes the local path it takes in a --local-native run.
func newSessionZipFixture(t *testing.T, fail bool) *sessionZipFixture {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required for the stdio helper fixture")
	}
	dir := t.TempDir()
	f := &sessionZipFixture{
		updates: make(chan func(), 32),
		logPath: filepath.Join(dir, "requests.jsonl"),
		zipPath: filepath.Join(dir, "dsh-session-fixture.zip"),
		destDir: filepath.Join(dir, "chosen"),
		dest:    filepath.Join(dir, "chosen", "dsh-session-fixture.zip"),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	client, err := bridge.Start(ctx, node, "-e", sessionZipHelper(f.logPath, f.zipPath, fail))
	if err != nil {
		t.Fatalf("start the fixture helper: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	a := newApp(false)
	t.Cleanup(a.cancel)
	a.client = client
	a.connected = true
	a.sessionID = "fixture-session"
	a.localRuntime = &localRuntime{native: true}
	a.current = snapshot{SessionID: a.sessionID}
	a.testDispatch = func(fn func()) { f.updates <- fn }
	f.a = a
	f.client = client
	f.ctx = ctx

	previousPanel, previousFallback := exportSessionZipSavePanel, exportSessionZipFallbackDir
	t.Cleanup(func() {
		exportSessionZipSavePanel, exportSessionZipFallbackDir = previousPanel, previousFallback
		exportSessionZipRunning.Store(false)
	})
	exportSessionZipSavePanel = func(_ *mygo.Window, name string) (string, error) {
		f.panels++
		f.panelTo = name
		return f.dest, nil
	}
	exportSessionZipFallbackDir = func() string { return f.destDir }
	return f
}

// wait runs the queued UI updates until the export has retired, then drains what
// is left so the assertions see the settled window state.
func (f *sessionZipFixture) wait(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) && exportSessionZipRunning.Load() {
		select {
		case fn := <-f.updates:
			fn()
		case <-time.After(5 * time.Millisecond):
		}
	}
	if exportSessionZipRunning.Load() {
		t.Fatal("the export never finished")
	}
	f.drain(t)
}

func (f *sessionZipFixture) drain(t *testing.T) {
	t.Helper()
	for {
		select {
		case fn := <-f.updates:
			fn()
		case <-time.After(50 * time.Millisecond):
			return
		case <-f.ctx.Done():
			t.Fatalf("fixture helper context: %v", f.ctx.Err())
		}
	}
}

// requests returns what the helper received, in order.
func (f *sessionZipFixture) requests(t *testing.T) []map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(f.logPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		t.Fatalf("read the helper log: %v", err)
	}
	var out []map[string]json.RawMessage
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line == "" {
			continue
		}
		var entry map[string]json.RawMessage
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("helper log line %q: %v", line, err)
		}
		out = append(out, entry)
	}
	return out
}

func assertGone(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err == nil {
		t.Errorf("%s should have been removed", path)
	}
}

// A completed export streams the helper's archive to the chosen place and drops
// the helper's temporary copy: the user keeps one file, where they asked.
func TestExportSessionZipStreamsTheArchiveAndDropsTheTemporaryCopy(t *testing.T) {
	f := newSessionZipFixture(t, false)
	f.a.exportSessionZip()
	f.wait(t)

	requests := f.requests(t)
	if len(requests) != 1 {
		t.Fatalf("helper requests = %d, want 1: %v", len(requests), requests)
	}
	var method, session string
	_ = json.Unmarshal(requests[0]["method"], &method)
	_ = json.Unmarshal(requests[0]["params"], &struct {
		SessionID *string `json:"sessionId"`
	}{SessionID: &session})
	if method != "exportSessionZip" {
		t.Errorf("helper method = %q, want exportSessionZip", method)
	}
	if session != "fixture-session" {
		t.Errorf("sessionId = %q", session)
	}

	copied, err := os.ReadFile(f.dest)
	if err != nil {
		t.Fatalf("the archive did not land at the chosen path: %v", err)
	}
	if string(copied) != sessionZipFixturePayload {
		t.Errorf("copied bytes = %q", copied)
	}
	assertGone(t, f.zipPath)
	if f.panels != 1 || f.panelTo != "dsh-session-fixture.zip" {
		t.Errorf("save panel = %d calls, name %q", f.panels, f.panelTo)
	}
	if f.a.error != "" {
		t.Errorf("successful export reported an error: %q", f.a.error)
	}
	if f.a.copyNotice != "会话日志已导出到 "+f.dest {
		t.Errorf("notice = %q", f.a.copyNotice)
	}
}

// A helper failure is visible, names the reason, and leaves the entry ready for
// another try: nothing of the user's is touched, not even the file the panel
// would have offered.
func TestExportSessionZipFailureIsVisibleAndKeepsTheUserFile(t *testing.T) {
	f := newSessionZipFixture(t, true)
	const userCopy = "the user's own file"
	if err := os.MkdirAll(filepath.Dir(f.dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.dest, []byte(userCopy), 0o644); err != nil {
		t.Fatal(err)
	}

	f.a.exportSessionZip()
	f.wait(t)

	if !strings.Contains(f.a.error, "无法导出会话日志") {
		t.Errorf("error banner = %q", f.a.error)
	}
	if !strings.Contains(f.a.error, "fixture host cannot write the archive") {
		t.Errorf("error banner lost the helper's reason: %q", f.a.error)
	}
	if f.a.copyNotice != "" {
		t.Errorf("failed export reported success: %q", f.a.copyNotice)
	}
	if f.panels != 0 {
		t.Errorf("the save panel opened for a failed export: %d", f.panels)
	}
	kept, err := os.ReadFile(f.dest)
	if err != nil {
		t.Fatalf("the user's file is gone: %v", err)
	}
	if string(kept) != userCopy {
		t.Errorf("the user's file changed: %q", kept)
	}
	// The retry is the same entry: nothing is left armed or disarmed.
	if exportSessionZipRunning.Load() {
		t.Error("a failed export kept the entry blocked")
	}
	if !f.a.canExportSessionZip() {
		t.Error("a failed export closed the only retry entry")
	}
}

// When the save panel itself cannot be shown, the archive still lands: in
// Downloads, under a name nothing else owns, with the notice naming it.
func TestExportSessionZipPanelFailureFallsBackToDownloads(t *testing.T) {
	f := newSessionZipFixture(t, false)
	exportSessionZipSavePanel = func(_ *mygo.Window, _ string) (string, error) {
		f.panels++
		return "", errors.New("fixture panel unavailable")
	}

	f.a.exportSessionZip()
	f.wait(t)

	if f.panels != 1 {
		t.Errorf("save panel calls = %d, want 1", f.panels)
	}
	landed := filepath.Join(f.destDir, "dsh-session-fixture.zip")
	copied, err := os.ReadFile(landed)
	if err != nil {
		t.Fatalf("the fallback copy is missing: %v", err)
	}
	if string(copied) != sessionZipFixturePayload {
		t.Errorf("fallback bytes = %q", copied)
	}
	if f.a.copyNotice != "会话日志已导出到 "+landed {
		t.Errorf("notice = %q", f.a.copyNotice)
	}
	if f.a.error != "" {
		t.Errorf("fallback reported an error: %q", f.a.error)
	}
	assertGone(t, f.zipPath)
}

// Closing the panel cancels the export, and the helper's copy still goes away:
// the temporary file is never the user's to keep or to find later.
func TestExportSessionZipCancelRemovesTheTemporaryCopy(t *testing.T) {
	f := newSessionZipFixture(t, false)
	exportSessionZipSavePanel = func(_ *mygo.Window, _ string) (string, error) {
		f.panels++
		return "", nil
	}

	f.a.exportSessionZip()
	f.wait(t)

	if f.panels != 1 {
		t.Errorf("save panel calls = %d, want 1", f.panels)
	}
	if f.a.copyNotice != "已取消导出会话日志" {
		t.Errorf("cancel notice = %q", f.a.copyNotice)
	}
	assertGone(t, f.zipPath)
	assertGone(t, f.dest)
}

// A launch that does not own its Host never reaches the helper: the entry stays
// disabled in the menus and the action says why instead of failing silently.
func TestExportSessionZipRefusesWithoutALocalHost(t *testing.T) {
	f := newSessionZipFixture(t, false)
	f.a.localRuntime = nil
	setLocalLaunch(t, false)

	f.a.exportSessionZip()
	f.drain(t)

	if !strings.Contains(f.a.error, "本地运行时未启动") {
		t.Errorf("error banner = %q", f.a.error)
	}
	if requests := f.requests(t); len(requests) != 0 {
		t.Errorf("the helper was asked for an archive anyway: %v", requests)
	}
	if exportSessionZipRunning.Load() {
		t.Error("a refused export kept the entry blocked")
	}
}

// A second click joins the export already running instead of starting another
// helper read behind the same panel.
func TestExportSessionZipJoinsTheExportAlreadyRunning(t *testing.T) {
	f := newSessionZipFixture(t, false)
	release := make(chan struct{})
	exportSessionZipSavePanel = func(_ *mygo.Window, _ string) (string, error) {
		f.panels++
		<-release
		return f.dest, nil
	}

	f.a.exportSessionZip()
	// Wait for the helper's answer, so the first export is inside the panel.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && len(f.requests(t)) == 0 {
		select {
		case fn := <-f.updates:
			fn()
		case <-time.After(5 * time.Millisecond):
		}
	}
	f.a.exportSessionZip() // the second click
	close(release)
	f.wait(t)

	if f.panels != 1 {
		t.Errorf("save panels = %d, want the one export", f.panels)
	}
	if requests := f.requests(t); len(requests) != 1 {
		t.Errorf("helper reads = %d, want 1: %v", len(requests), requests)
	}
}

// A receipt is only trusted once it names a complete archive: the status, the
// file behind the path, and the size the helper reported all have to agree, and
// a name can never point outside the place the user picks.
func TestSessionZipReceiptRejectsIncompleteAnswers(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "dsh-session-a.zip")
	if err := os.WriteFile(archive, []byte("PK\x03\x04abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	notArchive := filepath.Join(dir, "not-a-zip.zip")
	if err := os.WriteFile(notArchive, []byte("<html>error page</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	answer := func(fields map[string]any) json.RawMessage {
		raw, err := json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	for _, bad := range []struct {
		name string
		raw  json.RawMessage
		err  error
	}{
		{name: "helper error", raw: answer(map[string]any{}), err: errors.New("fixture failure")},
		{name: "not JSON", raw: json.RawMessage(`{`), err: nil},
		{name: "no status", raw: answer(map[string]any{"path": archive, "bytes": 7}), err: nil},
		{name: "not completed", raw: answer(map[string]any{"status": "pending", "path": archive, "bytes": 7}), err: nil},
		{name: "no path", raw: answer(map[string]any{"status": "completed", "bytes": 7}), err: nil},
		{name: "missing file", raw: answer(map[string]any{"status": "completed", "path": filepath.Join(dir, "gone.zip"), "bytes": 7}), err: nil},
		{name: "size mismatch", raw: answer(map[string]any{"status": "completed", "path": archive, "bytes": 9}), err: nil},
		{name: "not a zip", raw: answer(map[string]any{"status": "completed", "path": notArchive}), err: nil},
	} {
		t.Run(bad.name, func(t *testing.T) {
			if _, err := sessionZipReceiptFrom(bad.raw, bad.err); err == nil {
				t.Fatal("an incomplete answer was accepted")
			} else if !strings.HasPrefix(err.Error(), "无法导出会话日志：") {
				t.Errorf("error %q is not readable", err)
			}
		})
	}

	receipt, err := sessionZipReceiptFrom(answer(map[string]any{
		"status": "completed", "path": archive, "bytes": 7, "name": "../../etc/passwd",
	}), nil)
	if err != nil {
		t.Fatalf("a complete answer was refused: %v", err)
	}
	if receipt.Name != "passwd.zip" {
		t.Errorf("name = %q, want the last element only", receipt.Name)
	}
	if receipt.Path != archive || receipt.Bytes != 7 {
		t.Errorf("receipt = %+v", receipt)
	}
	// An answer without a name falls back to the archive's own file name.
	receipt, err = sessionZipReceiptFrom(answer(map[string]any{"status": "completed", "path": archive}), nil)
	if err != nil {
		t.Fatalf("an answer without bytes or name was refused: %v", err)
	}
	if receipt.Name != "dsh-session-a.zip" || receipt.Bytes != 7 {
		t.Errorf("receipt = %+v", receipt)
	}
}
