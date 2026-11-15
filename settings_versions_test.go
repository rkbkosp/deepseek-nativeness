package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestAppVersionSummaryNamesTheBuildItRunsFrom(t *testing.T) {
	if got := (appVersionInfo{}).summary(); got != "开发构建（未从打包应用运行）" {
		t.Fatalf("bare binary summary = %q", got)
	}
	full := appVersionInfo{AppVersion: "0.3.1", BuildNumber: "202611151800", RuntimeVersion: "2026.11.15", Bundled: true}
	got := full.summary()
	for _, want := range []string{"当前版本 0.3.1（构建 202611151800）", "运行时 2026.11.15"} {
		if !strings.Contains(got, want) {
			t.Fatalf("summary %q missing %q", got, want)
		}
	}
	if minimal := (appVersionInfo{Bundled: true}).summary(); !strings.Contains(minimal, "当前版本 未知") {
		t.Fatalf("manifest without a version = %q", minimal)
	}
}

func TestSettingsVersionRowMergesUpdateStateWithTheBundle(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	previous := settingsVersionSource
	settingsVersionSource = func() appVersionInfo {
		return appVersionInfo{AppVersion: "1.2.3", BuildNumber: "42", RuntimeVersion: "2026.11.15", Bundled: true}
	}
	defer func() { settingsVersionSource = previous }()
	line := a.settingsVersionDescription()
	if !strings.Contains(line, "当前版本 1.2.3（构建 42）") || !strings.Contains(line, "运行时 2026.11.15") {
		t.Fatalf("version row = %q", line)
	}
}

// The control opens the file when it exists and its folder while it does not;
// when neither is reachable it reports that instead of doing nothing.
func TestRevealSettingsConfigOpensTheFileOrItsFolder(t *testing.T) {
	target := preferencePath()
	if target == "" {
		t.Skip("no preference path on this platform")
	}
	previousExists, previousReveal, previousOpen := settingsConfigExists, settingsRevealConfigItem, settingsOpenConfigFolder
	defer func() {
		settingsConfigExists, settingsRevealConfigItem, settingsOpenConfigFolder = previousExists, previousReveal, previousOpen
	}()
	var revealed, opened string
	settingsRevealConfigItem = func(path string) { revealed = path }
	settingsOpenConfigFolder = func(path string) error { opened = path; return nil }

	settingsConfigExists = func(path string) bool { return path == target }
	if ok, notice := revealSettingsConfig(); !ok || revealed != target || opened != "" {
		t.Fatalf("existing file: ok=%v notice=%q revealed=%q opened=%q", ok, notice, revealed, opened)
	}
	revealed, opened = "", ""
	directory := filepath.Dir(target)
	settingsConfigExists = func(path string) bool { return path == directory }
	if ok, notice := revealSettingsConfig(); !ok || opened != directory || revealed != "" {
		t.Fatalf("missing file: ok=%v notice=%q revealed=%q opened=%q", ok, notice, revealed, opened)
	}
	revealed, opened = "", ""
	settingsConfigExists = func(string) bool { return false }
	if ok, notice := revealSettingsConfig(); ok || notice == "" || revealed != "" || opened != "" {
		t.Fatalf("unreachable: ok=%v notice=%q revealed=%q opened=%q", ok, notice, revealed, opened)
	}
}

// The General section shows this bundle's version and the four read-only
// references; a value that cannot be read says so instead of looking empty.
func TestGeneralSettingsShowsVersionAndReferenceSections(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	previous := settingsVersionSource
	settingsVersionSource = func() appVersionInfo {
		return appVersionInfo{AppVersion: "9.9.9", BuildNumber: "202601010000", RuntimeVersion: "2026.11.15", Bundled: true}
	}
	defer func() { settingsVersionSource = previous }()
	a.settingsOpen = true
	a.settingsSection = "general"
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.settingsView(c) }, 1280, 1400)
	tt.Frame()
	for _, want := range []string{
		"版本与更新",
		"当前版本 9.9.9（构建 202601010000）",
		"运行时 2026.11.15",
		"安全与隐私",
		"文件与搜索",
		"通知",
		"快捷键",
	} {
		if !tt.HasText(want) {
			t.Fatalf("settings page missing %q", want)
		}
	}
	// The language row stays absent: this build ships Chinese only, and a
	// selector for one option promises a choice that does not exist.
	if tt.HasText("语言") {
		t.Fatal("a language control is back in General settings")
	}
}

func TestShortcutReferenceOnlyListsBoundKeys(t *testing.T) {
	seen := map[string]bool{}
	for _, row := range settingsShortcutRows {
		if row[0] == "" || row[1] == "" {
			t.Fatalf("shortcut row %v is incomplete", row)
		}
		seen[row[0]] = true
	}
	for _, want := range []string{"⌘B", "⌘K", "⌘,", "Esc", "Enter"} {
		if !seen[want] {
			t.Fatalf("shortcut table lost %q", want)
		}
	}
	a := newApp(true)
	defer a.cancel()
	a.settingsOpen = true
	a.settingsSection = "shortcuts"
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.settingsView(c) }, 900, 800)
	tt.Frame()
	if !tt.HasText("⌘B") || !tt.HasText("展开或收起侧边栏") {
		t.Fatalf("shortcuts page does not render the shared table: %v", tt.Texts())
	}
	if tt.HasText("⌘R") {
		t.Fatal("shortcuts page advertises a key this build does not bind")
	}
}
