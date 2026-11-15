package main

// The Workspace row's own actions: its context menu, the inline rename, the
// confirmed delete and the archive/restore entries. The menu is built as data
// first, so the matrix below reads the same entries the window draws; the
// writes travel over a real stdio carrier (a fake Host process), so the method
// names, the payloads and the receipt fencing are the ones a real run uses.
//
// These are simulated peers, not a live Host: the helper, the mutation ledger
// and the UI dispatcher are real, the Host behind them is not.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
)

// sidebarActionsApp builds the headless app these surfaces act on. newApp(true)
// keeps the real preference file out of the test; demo mode is dropped at once
// so the fenced mutation path is live.
func sidebarActionsApp(t *testing.T, local bool) *app {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.demo = false
	if local {
		a.localRuntime = &localRuntime{native: true}
	}
	return a
}

func sidebarActionCaps(capable bool) map[string]operationCapability {
	caps := map[string]operationCapability{}
	for _, method := range []string{"createSession", "createWorkspace", "renameWorkspace", "deleteWorkspace", "archiveSession", "unarchiveSession"} {
		caps[method] = operationCapability{Supported: capable}
	}
	return caps
}

func findWorkspaceMenuEntry(entries []workspaceMenuEntry, command string) (workspaceMenuEntry, bool) {
	for _, e := range entries {
		if e.Command == command && !e.Separator {
			return e, true
		}
	}
	return workspaceMenuEntry{}, false
}

func visibleWorkspaceMenuCommands(entries []workspaceMenuEntry) []string {
	var out []string
	for _, e := range entries {
		if e.Visible && !e.Separator {
			out = append(out, e.Command)
		}
	}
	return out
}

// TestWorkspaceMenuMatrix pins the menu in every combination the surface can be
// in: a local Host or a Remote one, connected or not, and with or without each
// Host capability. A disabled entry must name its reason; a hidden one offers
// nothing at all.
func TestWorkspaceMenuMatrix(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/project"}
	sessions := []session{
		{ID: "s1", Title: "进行中的会话", WorkspaceID: "w1", Running: true, UpdatedAt: 2000},
		{ID: "s2", Title: "已归档的会话", WorkspaceID: "w1", Archived: true, UpdatedAt: 1000},
	}
	for _, local := range []bool{false, true} {
		for _, connected := range []bool{false, true} {
			for _, capable := range []bool{false, true} {
				name := fmt.Sprintf("local=%v connected=%v capable=%v", local, connected, capable)
				t.Run(name, func(t *testing.T) {
					a := sidebarActionsApp(t, local)
					a.connected = connected
					if connected {
						a.hostID = "fixture-host"
					}
					a.operationCaps = sidebarActionCaps(capable)
					a.workspaces = []workspace{ws}
					a.sessions = sessions

					entries := a.workspaceMenuEntries(ws)
					known := map[string]bool{}
					for _, e := range entries {
						if !e.Visible {
							continue
						}
						known[e.Command] = true
						if e.Separator {
							continue
						}
						if !e.Enabled && e.Detail == "" {
							t.Errorf("%s is disabled without a reason", e.Command)
						}
					}
					for _, command := range []string{workspaceCommandNewSession, workspaceCommandRename, workspaceCommandArchive, workspaceCommandUnarchive, workspaceCommandDelete} {
						if !known[command] {
							t.Errorf("%s is missing from the menu", command)
						}
					}

					wantHostAction := connected && capable
					for _, command := range []string{workspaceCommandNewSession, workspaceCommandRename, workspaceCommandDelete, workspaceCommandArchive, workspaceCommandUnarchive} {
						entry, ok := findWorkspaceMenuEntry(entries, command)
						if !ok {
							t.Fatalf("%s is missing", command)
						}
						if !entry.Visible {
							t.Errorf("%s is hidden on a real Workspace", command)
						}
						if entry.Enabled != wantHostAction {
							t.Errorf("%s enabled = %v, want %v", command, entry.Enabled, wantHostAction)
						}
					}

					// The Finder entry needs this Mac's filesystem: a Remote
					// Host's path names a directory on another machine, so the
					// entry is absent there and present-but-gated here.
					reveal, ok := findWorkspaceMenuEntry(entries, workspaceCommandReveal)
					if !ok {
						t.Fatal("the Finder entry is missing")
					}
					if reveal.Visible != local {
						t.Errorf("Finder entry visible = %v, want %v", reveal.Visible, local)
					}
					if local && !reveal.Enabled {
						t.Error("the Finder entry is disabled for a local Workspace")
					}
					if !local && reveal.Visible {
						t.Error("the Finder entry is offered for a Remote Host path")
					}

					archive, _ := findWorkspaceMenuEntry(entries, workspaceCommandArchive)
					if len(archive.Children) != 1 || archive.Children[0].SessionID != "s1" {
						t.Errorf("archive submenu = %+v, want the running Session s1", archive.Children)
					}
					if archive.Children[0].Subtitle != "运行中" {
						t.Errorf("running Session subtitle = %q", archive.Children[0].Subtitle)
					}
					archived, _ := findWorkspaceMenuEntry(entries, workspaceCommandUnarchive)
					if len(archived.Children) != 1 || archived.Children[0].SessionID != "s2" {
						t.Errorf("restore submenu = %+v, want the archived Session s2", archived.Children)
					}
					for _, child := range append(append([]workspaceMenuEntry{}, archive.Children...), archived.Children...) {
						if child.Enabled != wantHostAction {
							t.Errorf("submenu item %q enabled = %v, want %v", child.Label, child.Enabled, wantHostAction)
						}
					}
				})
			}
		}
	}
}

// The 未分组 pseudo-row carries no Workspace ID, so every entry would be a
// no-op: none of them may be offered.
func TestWorkspaceMenuOffersNothingForUngrouped(t *testing.T) {
	a := sidebarActionsApp(t, true)
	a.connected = true
	a.operationCaps = sidebarActionCaps(true)
	a.sessions = []session{{ID: "s1", Title: "游离会话", UpdatedAt: 1}}
	entries := a.workspaceMenuEntries(workspace{Name: "未分组"})
	if commands := visibleWorkspaceMenuCommands(entries); len(commands) != 0 {
		t.Fatalf("未分组 offered %v", commands)
	}
}

// A Workspace with no Sessions still has the destructive group, and the menu
// never starts or ends with a separator. This is read through MyGo's own menu
// tester, which drives the same ContextMenu the window uses.
func TestWorkspaceMenuDrawsTheSameEntriesItEvaluates(t *testing.T) {
	a := sidebarActionsApp(t, true)
	a.connected = true
	a.hostID = "fixture-host"
	a.operationCaps = sidebarActionCaps(true)
	a.workspaces = []workspace{{ID: "w1", Name: "项目甲", Path: "/tmp"}}
	a.sessions = []session{{ID: "s1", Title: "唯一会话", WorkspaceID: "w1", UpdatedAt: 1}}

	tt := ui.NewTester(a.sidebarView, 320, 700)
	if err := tt.RightClick("项目甲"); err != nil {
		t.Fatalf("open the Workspace menu: %v", err)
	}
	labels := tt.Menu()
	want := []string{"新建会话", "重命名工作区", "在 Finder 中显示", "归档会话", "删除工作区…"}
	got := map[string]bool{}
	for _, label := range labels {
		got[label] = true
	}
	for _, label := range want {
		if !got[label] {
			t.Errorf("menu is missing %q: %v", label, labels)
		}
	}
	if labels[0] == "-" || labels[len(labels)-1] == "-" {
		t.Errorf("menu starts or ends with a separator: %v", labels)
	}
	if err := tt.ChooseMenuItem("重命名工作区"); err != nil {
		t.Fatalf("choose rename: %v", err)
	}
	tt.Frame()
	rename := a.activeWorkspaceRename()
	if rename == nil || rename.WorkspaceID != "w1" || rename.Title != "项目甲" {
		t.Fatalf("the inline editor did not open: %+v", rename)
	}
	// The editor lives in the row, not in a sheet: it takes the keyboard focus
	// while the sidebar keeps drawing.
	if active, _ := tt.TextInputActive(); !active {
		t.Error("the inline rename did not take focus")
	}
	if err := tt.Click("取消重命名"); err != nil {
		t.Fatalf("cancel the inline rename: %v", err)
	}
	if a.activeWorkspaceRename() != nil {
		t.Error("the cancel entry left the inline editor open")
	}
}

// A disabled entry is visible and cannot be chosen: MyGo reports it disabled
// rather than running a no-op.
func TestWorkspaceMenuRefusesADisabledEntry(t *testing.T) {
	a := sidebarActionsApp(t, true)
	a.operationCaps = sidebarActionCaps(true) // not connected
	a.workspaces = []workspace{{ID: "w1", Name: "项目甲", Path: "/tmp"}}
	a.sessions = []session{{ID: "s1", Title: "唯一会话", WorkspaceID: "w1", UpdatedAt: 1}}

	tt := ui.NewTester(a.sidebarView, 320, 700)
	if err := tt.RightClick("项目甲"); err != nil {
		t.Fatalf("open the Workspace menu: %v", err)
	}
	err := tt.ChooseMenuItem("删除工作区…")
	if err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("a disconnected delete was chooseable: %v", err)
	}
	tt.CloseMenu()
	if a.workspaceRenaming("w1") {
		t.Fatal("a disabled rename still opened the editor")
	}
}

// --- stdio Host -------------------------------------------------------------

// sidebarHostOptions is what the fake Host starts with.
type sidebarHostOptions struct {
	local      bool
	workspaces []workspace
	sessions   []session
	caps       []string
	rejects    []string
	broken     []string
}

// sidebarHost is a real bridge.Client over a fake Host process. Every request
// is logged, so a test can prove which writes were sent, with what payload.
type sidebarHost struct {
	a       *app
	ctx     context.Context
	client  *bridge.Client
	updates chan func()
	logPath string
}

// sidebarHelperScript is the fake Host: it answers the two catalogs, applies
// archive and delete to its own state, and refuses the methods it was told to
// refuse with a definitively rejected receipt.
func sidebarHelperScript(logPath string, opts sidebarHostOptions) string {
	// JSON has no "nil slice": an absent list must still be an array here, or
	// the helper's own bookkeeping would fail.
	workspaces, sessions, rejects, broken := opts.workspaces, opts.sessions, opts.rejects, opts.broken
	if workspaces == nil {
		workspaces = []workspace{}
	}
	if sessions == nil {
		sessions = []session{}
	}
	if rejects == nil {
		rejects = []string{}
	}
	if broken == nil {
		broken = []string{}
	}
	state, err := json.Marshal(map[string]any{
		"workspaces": workspaces,
		"sessions":   sessions,
		"rejects":    rejects,
		"broken":     broken,
	})
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf(`const fs = require("node:fs");
const readline = require("node:readline");
const logPath = %q;
let state = %s;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const p = req.params || {};
  fs.appendFileSync(logPath, JSON.stringify({ method: req.method, params: p }) + "\n");
  const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  if (state.broken.includes(req.method)) {
    write({ id: req.id, error: { code: "INTERNAL", delivery: "rejected", message: "fixture read failure: " + req.method } });
    return;
  }
  if (req.method === "workspaces") { write({ id: req.id, result: { items: state.workspaces } }); return; }
  if (req.method === "sessions") { write({ id: req.id, result: { items: state.sessions } }); return; }
  if (state.rejects.includes(req.method)) {
    write({ id: req.id, error: { code: "INVALID_ARGUMENT", delivery: "rejected", message: "fixture refusal: " + req.method } });
    return;
  }
  if (req.method === "archiveSession" || req.method === "unarchiveSession") {
    const archived = req.method === "archiveSession";
    for (const s of state.sessions) if (s.id === p.sessionId) s.archived = archived;
  }
  if (req.method === "createSession") {
    state.sessions.push({ id: "created-session", title: "新会话", workspaceId: p.workspaceId, updatedAt: 9000 });
    const scope = p.clientScope || {};
    write({ id: req.id, result: { requestId: p.requestId, hostId: scope.hostId, connectionGeneration: scope.generation, status: "accepted", value: { sessionId: "created-session" } } });
    return;
  }
  if (req.method === "openSession") { write({ id: req.id, result: { sessionId: p.sessionId } }); return; }
  if (req.method === "deleteWorkspace") {
    state.workspaces = state.workspaces.filter((w) => w.id !== p.workspaceId);
    state.sessions = state.sessions.map((s) => s.workspaceId === p.workspaceId ? { ...s, workspaceId: "" } : s);
  }
  const scope = p.clientScope || {};
  write({ id: req.id, result: { requestId: p.requestId, hostId: scope.hostId, connectionGeneration: scope.generation, status: "accepted", value: {} } });
});
`, logPath, state)
}

func newSidebarHost(t *testing.T, opts sidebarHostOptions) *sidebarHost {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required for the stdio Host fixture")
	}
	f := &sidebarHost{updates: make(chan func(), 64), logPath: filepath.Join(t.TempDir(), "requests.jsonl")}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	client, err := bridge.Start(ctx, node, "-e", sidebarHelperScript(f.logPath, opts))
	if err != nil {
		t.Fatalf("start the fixture Host: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	a := sidebarActionsApp(t, opts.local)
	a.ctx = ctx
	a.client = client
	a.connected = true
	a.hostID = "fixture-host"
	a.accountScope = "fixture/account"
	a.remoteGeneration = 7
	a.operationCaps = sidebarActionCaps(false)
	for _, method := range opts.caps {
		a.operationCaps[method] = operationCapability{Supported: true}
	}
	a.workspaces = append([]workspace(nil), opts.workspaces...)
	a.sessions = append([]session(nil), opts.sessions...)
	a.testDispatch = func(fn func()) { f.updates <- fn }
	f.a, f.client, f.ctx = a, client, ctx
	return f
}

// settle runs the queued UI updates until no request or mutation is left, then
// takes one quiet turn so a reply that arrived late is not missed.
func (f *sidebarHost) settle(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		if len(f.a.mutations) == 0 && f.a.pendingRequests == 0 {
			select {
			case fn := <-f.updates:
				fn()
				continue
			case <-time.After(20 * time.Millisecond):
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("requests never settled: pending=%d mutations=%d", f.a.pendingRequests, len(f.a.mutations))
		}
		select {
		case fn := <-f.updates:
			fn()
		case <-time.After(5 * time.Millisecond):
		case <-f.ctx.Done():
			t.Fatalf("fixture Host context: %v", f.ctx.Err())
		}
	}
}

// sidebarRequest is one line of the fake Host's log.
type sidebarRequest struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

func (f *sidebarHost) requests(t *testing.T) []sidebarRequest {
	t.Helper()
	raw, err := os.ReadFile(f.logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatalf("read the Host log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	var out []sidebarRequest
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var request sidebarRequest
		if err := json.Unmarshal([]byte(line), &request); err != nil {
			if i == len(lines)-1 {
				// The fake Host may still be appending this line.
				break
			}
			t.Fatalf("Host log line %q: %v", line, err)
		}
		out = append(out, request)
	}
	return out
}

func (f *sidebarHost) requestsFor(t *testing.T, method string) []sidebarRequest {
	t.Helper()
	var out []sidebarRequest
	for _, request := range f.requests(t) {
		if request.Method == method {
			out = append(out, request)
		}
	}
	return out
}

func sidebarHasSession(a *app, id string) bool {
	for _, row := range a.sidebarRows() {
		if row.Kind == "session" && row.Session.ID == id {
			return true
		}
	}
	return false
}

// --- rename -----------------------------------------------------------------

func TestWorkspaceRenameUpdatesAtOnceAndSendsTheTypedTitle(t *testing.T) {
	ws := workspace{ID: "w1", Name: "旧名称", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{caps: []string{"renameWorkspace"}, workspaces: []workspace{ws}})

	f.a.beginWorkspaceRename(ws)
	rename := f.a.activeWorkspaceRename()
	if rename == nil {
		t.Fatal("the inline editor did not open")
	}
	if rename.Title != "旧名称" {
		t.Errorf("editor started at %q", rename.Title)
	}
	rename.Title = "  新名称  "
	f.a.commitWorkspaceRename()

	// The row changes before the Host answers: that is the optimistic update.
	if got := f.a.workspaces[0].Name; got != "新名称" {
		t.Fatalf("optimistic name = %q", got)
	}
	if f.a.activeWorkspaceRename() != nil {
		t.Fatal("the editor stayed open after a commit")
	}
	f.settle(t)

	if f.a.error != "" {
		t.Fatalf("successful rename reported %q", f.a.error)
	}
	if got := f.a.workspaces[0].Name; got != "新名称" {
		t.Errorf("name after the receipt = %q", got)
	}
	sent := f.requestsFor(t, "renameWorkspace")
	if len(sent) != 1 {
		t.Fatalf("renameWorkspace requests = %d, want 1", len(sent))
	}
	if sent[0].Params["workspaceId"] != "w1" || sent[0].Params["title"] != "新名称" {
		t.Errorf("rename payload = %v", sent[0].Params)
	}
	if id, _ := sent[0].Params["requestId"].(string); id == "" {
		t.Error("the rename carried no requestId")
	}
	if len(f.a.mutations) != 0 {
		t.Errorf("the mutation ledger still holds %d intents", len(f.a.mutations))
	}
}

func TestWorkspaceRenameRollsBackWhenTheHostRefuses(t *testing.T) {
	ws := workspace{ID: "w1", Name: "旧名称", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{caps: []string{"renameWorkspace"}, workspaces: []workspace{ws}, rejects: []string{"renameWorkspace"}})

	f.a.beginWorkspaceRename(ws)
	f.a.activeWorkspaceRename().Title = "重名"
	f.a.commitWorkspaceRename()
	if got := f.a.workspaces[0].Name; got != "重名" {
		t.Fatalf("the rename was not applied optimistically: %q", got)
	}
	f.settle(t)

	if got := f.a.workspaces[0].Name; got != "旧名称" {
		t.Fatalf("a refused rename did not roll back: %q", got)
	}
	if !strings.Contains(f.a.error, "重命名工作区失败") || !strings.Contains(f.a.error, "fixture refusal") {
		t.Errorf("error banner = %q", f.a.error)
	}
	if len(f.a.mutations) != 0 {
		t.Error("a definitively refused rename stayed locked and cannot be retried")
	}
}

func TestWorkspaceRenameRequiresANameAndSendsNothing(t *testing.T) {
	ws := workspace{ID: "w1", Name: "旧名称", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{caps: []string{"renameWorkspace"}, workspaces: []workspace{ws}})

	f.a.beginWorkspaceRename(ws)
	f.a.activeWorkspaceRename().Title = "   "
	f.a.commitWorkspaceRename()
	f.settle(t)

	if f.a.error == "" {
		t.Fatal("a blank name was accepted")
	}
	if sent := f.requestsFor(t, "renameWorkspace"); len(sent) != 0 {
		t.Fatalf("a blank name reached the Host: %v", sent)
	}
	if got := f.a.workspaces[0].Name; got != "旧名称" {
		t.Errorf("the name changed on a refused commit: %q", got)
	}
}

// The reply is applied by the UI dispatcher, not by the request goroutine:
// until the queued update runs, a refused rename has not rolled back.
func TestWorkspaceRenameRepliesRunOnTheUIThread(t *testing.T) {
	ws := workspace{ID: "w1", Name: "旧名称", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{caps: []string{"renameWorkspace"}, workspaces: []workspace{ws}, rejects: []string{"renameWorkspace"}})

	f.a.beginWorkspaceRename(ws)
	f.a.activeWorkspaceRename().Title = "重名"
	f.a.commitWorkspaceRename()

	// Wait for the Host to answer without draining the dispatcher.
	deadline := time.Now().Add(10 * time.Second)
	for len(f.requestsFor(t, "renameWorkspace")) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	if got := f.a.workspaces[0].Name; got != "重名" {
		t.Fatalf("the reply was applied off the UI thread: name = %q", got)
	}
	if f.a.error != "" {
		t.Fatalf("the error banner was written off the UI thread: %q", f.a.error)
	}
	f.settle(t)
	if got := f.a.workspaces[0].Name; got != "旧名称" {
		t.Fatalf("after the queued update the name is %q", got)
	}
	if !strings.Contains(f.a.error, "重命名工作区失败") {
		t.Errorf("after the queued update the banner is %q", f.a.error)
	}
}

// --- delete -----------------------------------------------------------------

// workspaceDeleteAnswers installs the answer the confirmation gives and
// returns a counter of the prompts.
func workspaceDeleteAnswers(t *testing.T, button int) *int {
	t.Helper()
	calls := 0
	previous := workspaceDeleteDialog
	t.Cleanup(func() { workspaceDeleteDialog = previous })
	workspaceDeleteDialog = func(options mygo.MessageOptions) (mygo.MessageResult, error) {
		calls++
		if !strings.Contains(options.Detail, "不删除磁盘文件") {
			t.Errorf("confirmation copy lost the file promise: %q", options.Detail)
		}
		if !strings.Contains(options.Detail, "解除会话归属") {
			t.Errorf("confirmation copy lost the ownership promise: %q", options.Detail)
		}
		if options.DefaultButton != 0 {
			t.Errorf("default button = %d, want cancel", options.DefaultButton)
		}
		if len(options.DestructiveButtons) != 1 || options.DestructiveButtons[0] != 1 {
			t.Errorf("destructive buttons = %v", options.DestructiveButtons)
		}
		if len(options.Buttons) != 2 {
			t.Errorf("buttons = %v", options.Buttons)
		}
		return mygo.MessageResult{Button: button}, nil
	}
	return &calls
}

func TestWorkspaceDeleteSendsNothingUntilConfirmed(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"s1"}}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"deleteWorkspace"},
		workspaces: []workspace{ws},
		sessions:   []session{{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1}},
	})
	calls := workspaceDeleteAnswers(t, 0)

	f.a.confirmDeleteWorkspace(f.a.workspaces[0])
	f.settle(t)

	if *calls != 1 {
		t.Fatalf("confirmation prompts = %d, want 1", *calls)
	}
	if sent := f.requestsFor(t, "deleteWorkspace"); len(sent) != 0 {
		t.Fatalf("a cancelled delete reached the Host: %v", sent)
	}
	if f.a.error != "" {
		t.Errorf("a cancelled delete reported %q", f.a.error)
	}
	if len(f.a.workspaces) != 1 {
		t.Error("a cancelled delete removed the row")
	}
}

func TestWorkspaceDeleteAfterConfirmationRefreshesBothCatalogs(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"s1"}}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"deleteWorkspace"},
		workspaces: []workspace{ws},
		sessions:   []session{{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1}},
	})
	calls := workspaceDeleteAnswers(t, 1)
	f.a.workspaceID = "w1"

	f.a.confirmDeleteWorkspace(f.a.workspaces[0])
	f.settle(t)

	if *calls != 1 {
		t.Fatalf("confirmation prompts = %d, want 1", *calls)
	}
	sent := f.requestsFor(t, "deleteWorkspace")
	if len(sent) != 1 {
		t.Fatalf("deleteWorkspace requests = %d, want 1", len(sent))
	}
	if sent[0].Params["workspaceId"] != "w1" {
		t.Errorf("delete payload = %v", sent[0].Params)
	}
	if len(f.a.workspaces) != 0 {
		t.Fatalf("the deleted Workspace is still in the catalog: %+v", f.a.workspaces)
	}
	if f.a.workspaceID == "w1" {
		t.Error("the deleted Workspace stayed selected")
	}
	// The Host detached the Session, and the refreshed rows put it under 未分组.
	var group string
	found := false
	for _, row := range f.a.sidebarRows() {
		if row.Kind == "workspace" {
			group = row.Workspace.Name
		}
		if row.Kind == "session" && row.Session.ID == "s1" {
			found = true
			if group != "未分组" {
				t.Errorf("the detached Session is under %q", group)
			}
		}
	}
	if !found {
		t.Error("the detached Session is missing from the sidebar")
	}
	if f.a.error != "" {
		t.Errorf("a confirmed delete reported %q", f.a.error)
	}
}

func TestWorkspaceDeleteFailureIsReadableAndRetryable(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"deleteWorkspace"},
		workspaces: []workspace{ws},
		rejects:    []string{"deleteWorkspace"},
	})
	workspaceDeleteAnswers(t, 1)

	f.a.confirmDeleteWorkspace(f.a.workspaces[0])
	f.settle(t)

	if !strings.Contains(f.a.error, "删除工作区失败") || !strings.Contains(f.a.error, "fixture refusal") {
		t.Fatalf("error banner = %q", f.a.error)
	}
	if len(f.a.workspaces) != 1 {
		t.Error("a refused delete removed the row")
	}
	if len(f.a.mutations) != 0 {
		t.Error("a definitively refused delete stayed locked and cannot be retried")
	}
}

// --- archive / restore ------------------------------------------------------

func TestArchiveHidesTheSessionAndTheMenuRestoresIt(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"s1"}}
	sessions := []session{{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1}}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"archiveSession", "unarchiveSession"},
		workspaces: []workspace{ws},
		sessions:   sessions,
	})

	if !sidebarHasSession(f.a, "s1") {
		t.Fatal("the Session is not in the default list before archiving")
	}
	f.a.setSessionArchived(f.a.sessions[0], true)
	f.settle(t)

	if sidebarHasSession(f.a, "s1") {
		t.Fatal("the archived Session stayed in the default list")
	}
	// The archived row is hidden from the list but still reachable: the
	// Workspace menu offers it as the restore entry.
	entries := f.a.workspaceMenuEntries(ws)
	restore, ok := findWorkspaceMenuEntry(entries, workspaceCommandUnarchive)
	if !ok || !restore.Visible || !restore.Enabled {
		t.Fatalf("no usable restore entry: %+v", restore)
	}
	if len(restore.Children) != 1 || restore.Children[0].SessionID != "s1" {
		t.Fatalf("restore submenu = %+v", restore.Children)
	}
	archive, _ := findWorkspaceMenuEntry(entries, workspaceCommandArchive)
	if len(archive.Children) != 0 {
		t.Errorf("the archive entry still lists the archived Session: %+v", archive.Children)
	}

	// Choosing the restore entry is the same path the menu runs.
	f.a.runWorkspaceCommand(workspaceCommandUnarchive, ws, "s1")
	f.settle(t)

	if !sidebarHasSession(f.a, "s1") {
		t.Fatal("the restored Session did not come back to the default list")
	}
	archivedRequests := f.requestsFor(t, "archiveSession")
	restoredRequests := f.requestsFor(t, "unarchiveSession")
	if len(archivedRequests) != 1 || len(restoredRequests) != 1 {
		t.Fatalf("archive=%d restore=%d, want one each", len(archivedRequests), len(restoredRequests))
	}
	if archivedRequests[0].Params["stopActivity"] != false {
		t.Errorf("archiving stopped the Session's activity: %v", archivedRequests[0].Params)
	}
	if _, ok := restoredRequests[0].Params["stopActivity"]; ok {
		t.Errorf("unarchive carried a parameter its Host descriptor does not accept: %v", restoredRequests[0].Params)
	}
	if f.a.error != "" {
		t.Errorf("archive/restore reported %q", f.a.error)
	}
}

// The Session row menu keeps both directions too: an archived row offers 取消归档
// and an active one offers 归档会话.
func TestSessionMenuOffersArchiveAndRestore(t *testing.T) {
	a := sidebarActionsApp(t, false)
	a.connected = true
	a.operationCaps = sidebarActionCaps(true)
	for _, tc := range []struct {
		name  string
		state session
		label string
	}{
		{"active", session{ID: "s1", Title: "会话一"}, "归档会话"},
		{"archived", session{ID: "s1", Title: "会话一", Archived: true}, "取消归档"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a.sessions = []session{tc.state}
			tt := ui.NewTester(func(c *ui.Context) { a.sessionRow(c, sidebarRow{Key: "s:s1", Kind: "session", Session: tc.state}) }, 320, 200)
			if err := tt.RightClick("会话 " + tc.state.Title); err != nil {
				t.Fatalf("open the Session menu: %v", err)
			}
			if labels := tt.Menu(); !strings.Contains(strings.Join(labels, "|"), tc.label) {
				t.Fatalf("menu = %v, want %q", labels, tc.label)
			}
		})
	}
}

// --- new session ------------------------------------------------------------

// "新建会话" on a Workspace row creates the Session in that Workspace, not in
// whichever one happens to be selected.
func TestWorkspaceMenuNewSessionTargetsItsWorkspace(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1"}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"createSession"},
		workspaces: []workspace{ws},
	})

	f.a.runWorkspaceCommand(workspaceCommandNewSession, ws, "")
	f.settle(t)

	created := f.requestsFor(t, "createSession")
	if len(created) != 1 {
		t.Fatalf("createSession requests = %d, want 1", len(created))
	}
	if created[0].Params["workspaceId"] != "w1" {
		t.Errorf("createSession payload = %v", created[0].Params)
	}
	if f.a.error != "" {
		t.Errorf("creating a Session reported %q", f.a.error)
	}
	if f.a.sessionID != "created-session" {
		t.Errorf("the new Session did not open: %q", f.a.sessionID)
	}
}

// --- copy and reveal --------------------------------------------------------

// The confirmation must not claim more than it does, and it must name where the
// directory and its logs remain: this Mac or the Host.
func TestDeleteWorkspaceConfirmationNamesWhereTheFilesStay(t *testing.T) {
	for _, tc := range []struct {
		name  string
		local bool
		where string
	}{
		{"local host", true, "这台 Mac"},
		{"remote host", false, "主机"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := sidebarActionsApp(t, tc.local)
			options := a.deleteWorkspaceConfirmation(workspace{ID: "w1", Name: "项目甲"})
			if !strings.Contains(options.Message, "项目甲") {
				t.Errorf("the prompt does not name the Workspace: %q", options.Message)
			}
			for _, promise := range []string{"只从列表移除", "解除会话归属", "不删除磁盘文件", "未分组"} {
				if !strings.Contains(options.Detail, promise) {
					t.Errorf("the prompt lost %q: %q", promise, options.Detail)
				}
			}
			if !strings.Contains(options.Detail, tc.where) {
				t.Errorf("the prompt does not say the files stay on %q: %q", tc.where, options.Detail)
			}
			if options.Type != mygo.MessageWarning {
				t.Errorf("prompt type = %q", options.Type)
			}
		})
	}
}

// Revealing a Workspace is a local-filesystem action: it runs on this Mac, and
// a Remote Host's path must not be opened here.
func TestRevealWorkspaceOnlyTouchesThisMacsFinder(t *testing.T) {
	dir := t.TempDir()
	var shown []string
	previous := workspaceShowInFinder
	t.Cleanup(func() { workspaceShowInFinder = previous })
	workspaceShowInFinder = func(path string) { shown = append(shown, path) }

	local := sidebarActionsApp(t, true)
	local.revealWorkspace(workspace{ID: "w1", Name: "项目甲", Path: dir})
	if len(shown) != 1 || shown[0] != dir {
		t.Fatalf("the local Finder was not asked to reveal the Workspace: %v", shown)
	}
	if local.error != "" {
		t.Errorf("a local reveal reported %q", local.error)
	}

	// A directory that no longer exists is reported instead of opening its
	// former parent.
	missing := filepath.Join(dir, "gone")
	local.revealWorkspace(workspace{ID: "w1", Name: "项目甲", Path: missing})
	if len(shown) != 1 {
		t.Error("a missing directory was revealed")
	}
	if !strings.Contains(local.error, "已不存在") {
		t.Errorf("a missing directory reported %q", local.error)
	}

	remote := sidebarActionsApp(t, false)
	remote.revealWorkspace(workspace{ID: "w1", Name: "项目甲", Path: dir})
	if len(shown) != 1 {
		t.Error("a Remote Host's path was revealed in this Mac's Finder")
	}
	if remote.error == "" {
		t.Error("a Remote Host's path was revealed without saying why it cannot be")
	}
	if remote.workspaceRevealAvailable(workspace{ID: "w1", Name: "项目甲", Path: dir}) {
		t.Error("the Finder entry is offered for a Remote Host path")
	}
}

// A catalog read that arrives late or fails must not resurrect a row the Host
// already accepted a delete for: the acceptance itself removes it.
func TestWorkspaceDeleteAppliesWithoutAWorkingCatalogRefresh(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"s1"}}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"deleteWorkspace"},
		workspaces: []workspace{ws},
		sessions:   []session{{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1}},
		broken:     []string{"workspaces", "sessions"},
	})
	workspaceDeleteAnswers(t, 1)

	f.a.confirmDeleteWorkspace(f.a.workspaces[0])
	f.settle(t)

	if len(f.a.workspaces) != 0 {
		t.Fatalf("the accepted delete left the row behind: %+v", f.a.workspaces)
	}
	for _, row := range f.a.sidebarRows() {
		if row.Kind == "workspace" && row.Workspace.ID == "w1" {
			t.Error("the deleted Workspace is still drawn")
		}
		if row.Kind == "session" && row.Session.ID == "s1" && row.Workspace.ID != "" {
			t.Errorf("the detached Session is still drawn under %q", row.Workspace.Name)
		}
	}
	if f.a.error == "" {
		t.Error("the failed catalog refresh was not reported")
	}
}

// The same for archive: the accepted write hides the row at once, even when the
// list read that follows cannot be answered.
func TestArchiveHidesTheSessionWithoutAWorkingListRefresh(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"s1"}}
	f := newSidebarHost(t, sidebarHostOptions{
		caps:       []string{"archiveSession", "unarchiveSession"},
		workspaces: []workspace{ws},
		sessions:   []session{{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1}},
		broken:     []string{"sessions"},
	})

	f.a.setSessionArchived(f.a.sessions[0], true)
	f.settle(t)

	if sidebarHasSession(f.a, "s1") {
		t.Fatal("an accepted archive stayed in the default list")
	}
	if f.a.error == "" {
		t.Error("the failed list refresh was not reported")
	}
}

// The per-Session submenus list what the sidebar draws: an empty Session that
// is not the one on screen stays out, and the open one is included like its row.
func TestWorkspaceMenuSkipsEmptySessionsTheListHides(t *testing.T) {
	ws := workspace{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"blank", "s1"}}
	a := sidebarActionsApp(t, true)
	a.connected = true
	a.operationCaps = sidebarActionCaps(true)
	a.workspaces = []workspace{ws}
	a.sessions = []session{
		{ID: "blank", Title: "新会话", WorkspaceID: "w1", Blank: true, UpdatedAt: 2},
		{ID: "s1", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 1},
	}

	archive, _ := findWorkspaceMenuEntry(a.workspaceMenuEntries(ws), workspaceCommandArchive)
	if len(archive.Children) != 1 || archive.Children[0].SessionID != "s1" {
		t.Fatalf("archive submenu = %+v, want only the drawn Session", archive.Children)
	}

	a.sessionID = "blank"
	archive, _ = findWorkspaceMenuEntry(a.workspaceMenuEntries(ws), workspaceCommandArchive)
	if len(archive.Children) != 2 {
		t.Fatalf("the open empty Session is missing from the menu: %+v", archive.Children)
	}
}

// The Session row's archive entry is gated by the same capability as the
// Workspace menu: without it the item is drawn disabled and cannot be chosen.
func TestSessionMenuArchiveEntryFollowsCapability(t *testing.T) {
	for _, capable := range []bool{false, true} {
		name := fmt.Sprintf("capable=%v", capable)
		t.Run(name, func(t *testing.T) {
			a := sidebarActionsApp(t, false)
			a.connected = true
			a.operationCaps = sidebarActionCaps(capable)
			s := session{ID: "s1", Title: "会话一"}
			a.sessions = []session{s}
			tt := ui.NewTester(func(c *ui.Context) {
				a.sessionRow(c, sidebarRow{Key: "s:s1", Kind: "session", Session: s})
			}, 320, 200)
			if err := tt.RightClick("会话 会话一"); err != nil {
				t.Fatalf("open the Session menu: %v", err)
			}
			err := tt.ChooseMenuItem("归档会话")
			if capable {
				if err != nil {
					t.Errorf("an available archive entry was refused: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), "disabled") {
				t.Errorf("an unavailable archive entry was chooseable: %v", err)
			}
			tt.CloseMenu()
		})
	}
}
