package main

// Update checks (M7a): the feed contract, the signature, version ordering, the
// menu entry, the offer dialog and the quiet notices.

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

// The fixture below is the output of the release tooling, not of this package:
//
//	node scripts/feed-sign.mjs keygen --out key.json
//	node scripts/feed-sign.mjs sign --key key.json --feed feed.json
//
// Committing the public half together with the signed document is what makes
// "the Go verifier and scripts/feed-sign.mjs agree" a test instead of a claim.
// It is a throwaway key pair: nothing trusts it, and the private half is not
// stored in the repository.
const (
	updateFixturePublicKey = "l5mIpAYGhkbQ40nmnLwYMcWrsv9NypsKDoj/TrmorcY="
	updateFixtureSignature = "HGro1Zg6Y51UeGjqdhNY1WiXaBhRJCEvBqObAQ1IKICuVJ9rs9SxhTMHVfLBQjuyQbvrdfAcYgmE2he1acLWCg=="
	updateFixtureFeed      = `{"schemaVersion":1,"channel":"nightly","releases":[{"version":"0.2.3","buildNumber":202611151800,"notes":"修复本地工作区恢复时的崩溃。","downloadURL":"https://updates.example.com/native-dsh/DeepSeek-Nativeness-0.2.3.zip","publishedAt":"2026-11-15T09:00:00Z"}]}`
)

// updateTestCurrent is the version this test bundle runs as.
func updateTestCurrent() updateVersion {
	return updateVersion{version: "0.2.2", build: 202611150900}
}

// pinUpdateRunningVersion makes this test binary report the version an .app
// bundle would carry, and restores the real reader afterwards.
func pinUpdateRunningVersion(t *testing.T) {
	t.Helper()
	previous := updateRunningVersion
	updateRunningVersion = updateTestCurrent
	t.Cleanup(func() { updateRunningVersion = previous })
}

func newUpdateTestKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generating an Ed25519 key: %v", err)
	}
	return publicKey, privateKey
}

func signUpdateTestFeed(privateKey ed25519.PrivateKey, feed []byte) []byte {
	return []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, feed)) + "\n")
}

// serveUpdateFeed serves one feed and its detached signature at the paths the
// checker asks for.
func serveUpdateFeed(t *testing.T, feed, signature []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/feed.json":
			_, _ = w.Write(feed)
		case "/feed.json" + updateSignatureSuffix:
			_, _ = w.Write(signature)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func updateTestConfig(serverURL string, publicKey ed25519.PublicKey) updateConfig {
	return updateConfig{feedURL: serverURL + "/feed.json", publicKey: publicKey, source: "test"}
}

func updateTestFeedJSON(t *testing.T, releases ...updateRelease) []byte {
	t.Helper()
	data, err := json.Marshal(updateFeed{SchemaVersion: updateFeedSchemaVersion, Channel: "nightly", Releases: releases})
	if err != nil {
		t.Fatalf("marshaling the test feed: %v", err)
	}
	return data
}

func updateTestRelease() updateRelease {
	return updateRelease{
		Version:                    "0.2.3",
		BuildNumber:                202611151800,
		MinimumRuntimeHostProtocol: 1,
		Notes:                      "修复本地工作区恢复时的崩溃。\n\n- 恢复失败后不再清空会话列表。",
		DownloadURL:                "https://updates.example.com/native-dsh/DeepSeek-Nativeness-0.2.3.zip",
		PublishedAt:                "2026-11-15T09:00:00Z",
	}
}

// setUpdateBuildConfig sets what a build would have injected, and restores it.
func setUpdateBuildConfig(t *testing.T, feedURL, publicKey string) {
	t.Helper()
	previousURL, previousKey, previousPrefs := updateFeedURL, updateFeedPublicKey, updatePrefs
	updateFeedURL, updateFeedPublicKey, updatePrefs = feedURL, publicKey, updatePreferenceState{}
	pinUpdateRunningVersion(t)
	updates.reset()
	t.Cleanup(func() {
		updateFeedURL, updateFeedPublicKey, updatePrefs = previousURL, previousKey, previousPrefs
		updates.reset()
	})
}

// setUpdateTestKey configures a build with a generated key, returning the private
// half for signing the served feed.
func setUpdateTestKey(t *testing.T, feedURL string) ed25519.PrivateKey {
	t.Helper()
	publicKey, privateKey := newUpdateTestKey(t)
	setUpdateBuildConfig(t, feedURL, base64.StdEncoding.EncodeToString(publicKey))
	return privateKey
}

// TestCompareUpdateVersions pins the ordering rule: the monotonic build number
// decides when both sides have one, semantic versions decide otherwise, and
// nothing that cannot be understood counts as newer.
func TestCompareUpdateVersions(t *testing.T) {
	for _, test := range []struct {
		name    string
		remote  updateVersion
		current updateVersion
		want    int
	}{
		{"newer build number wins", updateVersion{"0.2.2", 202611151800}, updateVersion{"0.2.2", 202611150900}, 1},
		{"equal build number is not newer, even with a higher marketing version", updateVersion{"0.2.9", 202611150900}, updateVersion{"0.2.2", 202611150900}, 0},
		{"lower build number is a downgrade", updateVersion{"0.2.9", 202611150800}, updateVersion{"0.2.2", 202611150900}, -1},
		{"missing build numbers compare marketing versions", updateVersion{"0.2.3", 0}, updateVersion{"0.2.2", 0}, 1},
		{"equal marketing versions", updateVersion{"0.2.2", 0}, updateVersion{"0.2.2", 0}, 0},
		{"release is newer than its prerelease", updateVersion{"0.2.2", 0}, updateVersion{"0.2.2-rc.3", 0}, 1},
		{"a later prerelease is newer", updateVersion{"0.2.2-rc.4", 0}, updateVersion{"0.2.2-rc.3", 0}, 1},
		{"numeric prerelease identifiers sort before alphanumeric", updateVersion{"0.2.2-1", 0}, updateVersion{"0.2.2-alpha", 0}, -1},
		{"build metadata is ignored", updateVersion{"0.2.2+local", 0}, updateVersion{"0.2.2", 0}, 0},
		{"an unparsable version is never newer", updateVersion{"nightly", 0}, updateVersion{"0.2.2", 0}, 0},
		{"an unknown running version never makes an update", updateVersion{"0.2.3", 0}, updateVersion{"", 0}, 0},
		{"two components compare as a prefix", updateVersion{"0.3", 0}, updateVersion{"0.2.9", 0}, 1},
	} {
		if got := compareUpdateVersions(test.remote, test.current); got != test.want {
			t.Errorf("%s: compare(%s, %s) = %d, want %d", test.name, test.remote, test.current, got, test.want)
		}
	}
}

// TestReleaseToolingSignatureVerifies is the contract with scripts/feed-sign.mjs:
// its signature verifies over the exact stored bytes, and neither a changed byte
// nor another key passes.
func TestReleaseToolingSignatureVerifies(t *testing.T) {
	feed := []byte(updateFixtureFeed)
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(updateFixtureSignature))
	if err != nil {
		t.Fatalf("the fixture signature is not base64: %v", err)
	}
	publicKey, err := decodeUpdatePublicKey(updateFixturePublicKey)
	if err != nil {
		t.Fatalf("the fixture public key does not decode: %v", err)
	}
	if !ed25519.Verify(publicKey, feed, signature) {
		t.Fatal("a signature from scripts/feed-sign.mjs does not verify")
	}
	tampered := append([]byte(nil), feed...)
	if len(tampered) == 0 {
		t.Fatal("the fixture feed is empty")
	}
	tampered[0] ^= 0x20
	if ed25519.Verify(publicKey, tampered, signature) {
		t.Error("a changed byte still verified")
	}
	otherKey, _ := newUpdateTestKey(t)
	if ed25519.Verify(otherKey, feed, signature) {
		t.Error("another public key verified the fixture signature")
	}
}

// TestReleaseToolingFeedIsAccepted takes the fixture all the way through the
// check: the signed document is the schema this build understands.
func TestReleaseToolingFeedIsAccepted(t *testing.T) {
	server := serveUpdateFeed(t, []byte(updateFixtureFeed), []byte(updateFixtureSignature))
	publicKey, err := decodeUpdatePublicKey(updateFixturePublicKey)
	if err != nil {
		t.Fatalf("the fixture public key does not decode: %v", err)
	}
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateAvailable || result.Release == nil {
		t.Fatalf("fixture feed = %+v", result)
	}
	if result.Release.Version != "0.2.3" || result.Release.BuildNumber != 202611151800 {
		t.Errorf("offered %+v", *result.Release)
	}
	if result.Channel != "nightly" || result.Releases != 1 {
		t.Errorf("channel %q with %d releases", result.Channel, result.Releases)
	}
}

func TestPerformUpdateCheckOffersNewestNewerRelease(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	older := updateRelease{Version: "0.2.2", BuildNumber: 202611150900, DownloadURL: "https://updates.example.com/0.2.2.zip"}
	newest := updateTestRelease()
	feed := updateTestFeedJSON(t, older, newest, updateRelease{Version: "0.2.2", BuildNumber: 1, DownloadURL: "https://updates.example.com/old.zip"})
	server := httptest.NewServer(updateTestFeedHandler(t, privateKey, feed))
	t.Cleanup(server.Close)
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateAvailable || result.Release == nil {
		t.Fatalf("check = %+v", result)
	}
	if result.Release.Version != newest.Version || result.Release.BuildNumber != newest.BuildNumber {
		t.Errorf("offered %+v, want %+v", *result.Release, newest)
	}
	if result.Releases != 3 {
		t.Errorf("releases = %d, want 3", result.Releases)
	}
	if result.Duration <= 0 || result.CheckedAt.IsZero() {
		t.Errorf("check did not record when it ran: %+v", result)
	}
}

// updateTestFeedHandler serves one feed signed with privateKey; the public half
// must be the key the config carries.
func updateTestFeedHandler(t *testing.T, privateKey ed25519.PrivateKey, feed []byte) http.Handler {
	t.Helper()
	signature := signUpdateTestFeed(privateKey, feed)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/feed.json":
			_, _ = w.Write(feed)
		case "/feed.json" + updateSignatureSuffix:
			_, _ = w.Write(signature)
		default:
			http.NotFound(w, r)
		}
	})
}

func TestPerformUpdateCheckRefusesDowngrades(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateRelease{Version: "0.2.1", BuildNumber: 202611141200, DownloadURL: "https://updates.example.com/0.2.1.zip"})
	server := httptest.NewServer(updateTestFeedHandler(t, privateKey, feed))
	t.Cleanup(server.Close)
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateCurrent || result.Release != nil {
		t.Fatalf("a downgrade was offered: %+v", result)
	}
	if result.Failure != updateFailureNone {
		t.Errorf("an up-to-date check reported a failure: %+v", result)
	}
}

func TestPerformUpdateCheckKeepsTheBuildWhenOnlyTheMarketingVersionMoves(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateRelease{Version: "0.2.9", BuildNumber: updateTestCurrent().build, DownloadURL: "https://updates.example.com/0.2.9.zip"})
	server := httptest.NewServer(updateTestFeedHandler(t, privateKey, feed))
	t.Cleanup(server.Close)
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateCurrent {
		t.Fatalf("an equal build number was offered as newer: %+v", result)
	}
}

func TestPerformUpdateCheckRejectsATamperedFeed(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateTestRelease())
	signature := signUpdateTestFeed(privateKey, feed)
	tampered := append([]byte(nil), feed...)
	tampered[10] ^= 0x01
	server := serveUpdateFeed(t, tampered, signature)
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureSignature {
		t.Fatalf("a tampered feed = %+v", result)
	}
	if result.Release != nil {
		t.Error("a tampered feed offered a release")
	}
	if result.Reason != "signature-mismatch" {
		t.Errorf("reason = %q", result.Reason)
	}
	if result.Message != updateFailureNotices[updateFailureSignature] {
		t.Errorf("message = %q", result.Message)
	}
}

func TestPerformUpdateCheckRejectsAnotherKey(t *testing.T) {
	_, signingKey := newUpdateTestKey(t)
	trustedKey, _ := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateTestRelease())
	server := serveUpdateFeed(t, feed, signUpdateTestFeed(signingKey, feed))
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, trustedKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureSignature {
		t.Fatalf("a feed signed by another key = %+v", result)
	}
}

func TestPerformUpdateCheckRequiresASignature(t *testing.T) {
	publicKey, _ := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateTestRelease())
	// The feed is served, its signature is not.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/feed.json" {
			_, _ = w.Write(feed)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureSignature {
		t.Fatalf("a feed without a signature = %+v", result)
	}
	if result.Reason != "signature-unavailable" {
		t.Errorf("reason = %q", result.Reason)
	}
}

func TestPerformUpdateCheckRejectsAMalformedSignature(t *testing.T) {
	publicKey, _ := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateTestRelease())
	for _, signature := range [][]byte{[]byte("not base64\n"), []byte(base64.StdEncoding.EncodeToString([]byte("short")) + "\n")} {
		server := serveUpdateFeed(t, feed, signature)
		result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
		if result.State != updateStateFailed || result.Failure != updateFailureSignature || result.Reason != "signature-malformed" {
			t.Errorf("signature %q = %+v", signature, result)
		}
	}
}

func TestPerformUpdateCheckRejectsBadFeeds(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	for _, test := range []struct {
		name   string
		feed   []byte
		reason string
	}{
		{"not JSON", []byte("}"), "json"},
		{"wrong schema version", []byte(`{"schemaVersion":2,"releases":[]}`), "schema-version"},
		{"no releases", []byte(`{"schemaVersion":1,"releases":[]}`), "no-releases"},
		{"release without a download URL", []byte(`{"schemaVersion":1,"releases":[{"version":"0.2.3"}]}`), "incomplete-release"},
		{"release without a version", []byte(`{"schemaVersion":1,"releases":[{"downloadURL":"https://updates.example.com/x.zip"}]}`), "incomplete-release"},
		{"plain HTTP download URL", []byte(`{"schemaVersion":1,"releases":[{"version":"0.2.3","downloadURL":"http://updates.example.com/x.zip"}]}`), "download-url"},
		{"upstream download URL", []byte(`{"schemaVersion":1,"releases":[{"version":"0.2.3","downloadURL":"https://download.deepseek.com/x.zip"}]}`), "download-url"},
	} {
		server := serveUpdateFeed(t, test.feed, signUpdateTestFeed(privateKey, test.feed))
		result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
		if result.State != updateStateFailed || result.Failure != updateFailureFormat {
			t.Errorf("%s = %+v", test.name, result)
			continue
		}
		if result.Reason != test.reason {
			t.Errorf("%s: reason = %q, want %q", test.name, result.Reason, test.reason)
		}
		if result.Message != updateFailureNotices[updateFailureFormat] {
			t.Errorf("%s: message = %q", test.name, result.Message)
		}
	}
}

func TestPerformUpdateCheckRejectsAnOversizedFeed(t *testing.T) {
	publicKey, _ := newUpdateTestKey(t)
	oversized := make([]byte, updateFeedMaxBytes+1)
	server := serveUpdateFeed(t, oversized, []byte("unused"))
	result := performUpdateCheck(context.Background(), updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureFormat || result.Reason != "feed-too-large" {
		t.Fatalf("oversized feed = %+v", result)
	}
}

func TestPerformUpdateCheckReportsUnreachableHosts(t *testing.T) {
	publicKey, _ := newUpdateTestKey(t)
	server := httptest.NewServer(http.NotFoundHandler())
	unreachable := server.URL
	server.Close()
	result := performUpdateCheck(context.Background(), updateTestConfig(unreachable, publicKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureNetwork {
		t.Fatalf("an unreachable host = %+v", result)
	}
	if result.Message != updateFailureNotices[updateFailureNetwork] || result.Reason != "unreachable" {
		t.Errorf("message %q reason %q", result.Message, result.Reason)
	}
}

func TestPerformUpdateCheckTimesOut(t *testing.T) {
	publicKey, privateKey := newUpdateTestKey(t)
	feed := updateTestFeedJSON(t, updateTestRelease())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		updateTestFeedHandler(t, privateKey, feed).ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	result := performUpdateCheck(ctx, updateTestConfig(server.URL, publicKey), updateTestCurrent())
	if result.State != updateStateFailed || result.Failure != updateFailureNetwork {
		t.Fatalf("a timing-out check = %+v", result)
	}
	if result.Reason != "timeout" || result.Message != updateTimeoutNotice {
		t.Errorf("message %q reason %q", result.Message, result.Reason)
	}
}

func TestResolveUpdateConfig(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize))
	for _, test := range []struct {
		name     string
		buildURL string
		prefsURL string
		key      string
		wantURL  string
		wantErr  bool
	}{
		{name: "no build feed", key: validKey, wantErr: true},
		{name: "no key", buildURL: "https://updates.example.com/feed.json", wantErr: true},
		{name: "invalid key", buildURL: "https://updates.example.com/feed.json", key: "AAAA", wantErr: true},
		{name: "https feed", buildURL: "https://updates.example.com/feed.json", key: validKey, wantURL: "https://updates.example.com/feed.json"},
		{name: "loopback HTTP feed", buildURL: "http://127.0.0.1:8080/feed.json", key: validKey, wantURL: "http://127.0.0.1:8080/feed.json"},
		{name: "plain HTTP feed", buildURL: "http://updates.example.com/feed.json", key: validKey, wantErr: true},
		{name: "upstream feed", buildURL: "https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly.yml", key: validKey, wantErr: true},
		{name: "relative feed", buildURL: "/feed.json", key: validKey, wantErr: true},
		{name: "preferences override the build", buildURL: "https://build.example.com/feed.json", prefsURL: "https://settings.example.com/feed.json", key: validKey, wantURL: "https://settings.example.com/feed.json"},
		{name: "preferences are validated too", buildURL: "https://build.example.com/feed.json", prefsURL: "http://settings.example.com/feed.json", key: validKey, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			setUpdateBuildConfig(t, test.buildURL, test.key)
			updatePrefs.FeedURL = test.prefsURL
			config, err := resolveUpdateConfig()
			if test.wantErr {
				if err == nil {
					t.Fatalf("resolved %+v, want an error", config)
				}
				if updateCheckConfigured() {
					t.Error("an unusable configuration reported itself as configured")
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveUpdateConfig: %v", err)
			}
			if config.feedURL != test.wantURL {
				t.Errorf("feed = %q, want %q", config.feedURL, test.wantURL)
			}
			if !updateCheckConfigured() {
				t.Error("a usable configuration reported itself as unconfigured")
			}
		})
	}
}

func TestDecodeUpdatePublicKeyAcceptsPaddedAndRawBase64(t *testing.T) {
	key := make([]byte, ed25519.PublicKeySize)
	for index := range key {
		key[index] = byte(index + 1)
	}
	raw := base64.RawStdEncoding.EncodeToString(key)
	padded := base64.StdEncoding.EncodeToString(key)
	for _, encoded := range []string{raw, padded, " " + padded[:4] + "\n" + padded[4:] + " "} {
		decoded, err := decodeUpdatePublicKey(encoded)
		if err != nil {
			t.Fatalf("decoding %q: %v", encoded, err)
		}
		if string(decoded) != string(key) {
			t.Errorf("decoding %q gave another key", encoded)
		}
	}
}

// TestApplicationMenuOffersUpdateCheckOnlyWithAFeed is the "no fake button"
// rule: the entry exists exactly when this launch could check.
func TestApplicationMenuOffersUpdateCheckOnlyWithAFeed(t *testing.T) {
	setLocalLaunch(t, false)
	setUpdateBuildConfig(t, "", "")
	if item := findMenuItem((&app{}).applicationMenu().Items(), updateMenuID); item != nil {
		t.Fatalf("a build without a feed offers %q", item.Label)
	}
	validKey := base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize))
	setUpdateBuildConfig(t, "https://updates.example.com/native-dsh/feed.json", validKey)
	items := (&app{}).applicationMenu().Items()
	item := findMenuItem(items, updateMenuID)
	if item == nil {
		t.Fatal("a build with a feed has no update entry")
	}
	if item.Label != "检查更新…" {
		t.Errorf("label = %q", item.Label)
	}
	if item.Click == nil {
		t.Error("the update entry has no action")
	}
	if item.Accelerator != "" {
		t.Errorf("accelerator = %q, want none", item.Accelerator)
	}
	if item.ToolTip == "" {
		t.Error("the update entry has no tooltip")
	}
	// Directly under About, before the first separator.
	appSubmenu := items[0].Submenu
	if len(appSubmenu) < 2 || appSubmenu[0].ID != "about" || appSubmenu[1].ID != updateMenuID {
		t.Fatalf("update entry is not directly under About: %v", menuIDs(appSubmenu))
	}
}

func menuIDs(items []*mygo.MenuItem) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.Type == mygo.MenuItemSeparator {
			ids = append(ids, "---")
			continue
		}
		ids = append(ids, item.ID)
	}
	return ids
}

func TestCheckingDisablesTheMenuEntry(t *testing.T) {
	setLocalLaunch(t, false)
	setUpdateBuildConfig(t, "https://updates.example.com/feed.json", base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize)))
	item := findMenuItem((&app{}).applicationMenu().Items(), updateMenuID)
	if item == nil {
		t.Fatal("no update entry")
	}
	setUpdateMenuItem(item)
	t.Cleanup(func() { setUpdateMenuItem(nil) })
	setUpdateMenuEnabled(false)
	if item.IsEnabled() {
		t.Error("a check in flight left the entry clickable")
	}
	setUpdateMenuEnabled(true)
	if !item.IsEnabled() {
		t.Error("the finished check did not restore the entry")
	}
}

// updateTestApp is an app that runs UI work inline and never writes preferences.
func updateTestApp() *app {
	return &app{demo: true, testDispatch: func(fn func()) { fn() }}
}

// setUpdatableDialog replaces the dialog and records what it was asked.
func setUpdatableDialog(t *testing.T) chan mygo.MessageOptions {
	t.Helper()
	shown := make(chan mygo.MessageOptions, 4)
	previous := updateDialog
	updateDialog = func(options mygo.MessageOptions) (mygo.MessageResult, error) {
		shown <- options
		return mygo.MessageResult{Button: 2}, nil
	}
	t.Cleanup(func() { updateDialog = previous })
	return shown
}

func setUpdatableOpener(t *testing.T) chan string {
	t.Helper()
	opened := make(chan string, 4)
	previous := updateOpenExternal
	updateOpenExternal = func(url string) error {
		opened <- url
		return nil
	}
	t.Cleanup(func() { updateOpenExternal = previous })
	return opened
}

func setUpdatableClipboard(t *testing.T) chan string {
	t.Helper()
	written := make(chan string, 4)
	previous := updateClipboardWrite
	updateClipboardWrite = func(text string) error {
		written <- text
		return nil
	}
	t.Cleanup(func() { updateClipboardWrite = previous })
	return written
}

func waitForUpdateChannel[T any](t *testing.T, channel chan T) T {
	t.Helper()
	select {
	case value := <-channel:
		return value
	case <-time.After(10 * time.Second):
		t.Fatal("the check never reported back")
	}
	var zero T
	return zero
}

// TestCheckForUpdatesOffersTheDownloadPage runs the whole M7a path once: a
// signed feed newer than this build produces the dialog, and the download page
// is really opened.
func TestCheckForUpdatesOffersTheDownloadPage(t *testing.T) {
	release := updateTestRelease()
	feed := updateTestFeedJSON(t, release)
	a := updateTestApp()
	privateKey := setUpdateTestKey(t, "")
	server := httptest.NewServer(updateTestFeedHandler(t, privateKey, feed))
	t.Cleanup(server.Close)
	updateFeedURL = server.URL + "/feed.json"
	shown, opened := setUpdatableDialog(t), setUpdatableOpener(t)
	setUpdatableClipboard(t)
	a.checkForUpdates()
	options := waitForUpdateChannel(t, shown)
	if !strings.Contains(options.Message, "0.2.3") {
		t.Errorf("dialog message = %q", options.Message)
	}
	if !strings.Contains(options.Detail, "修复本地工作区恢复时的崩溃") {
		t.Errorf("dialog detail = %q", options.Detail)
	}
	if !strings.Contains(options.Detail, "手动安装") {
		t.Errorf("dialog detail does not say the install is manual: %q", options.Detail)
	}
	if strings.Join(options.Buttons, "|") != "稍后|复制链接|打开下载页" {
		t.Errorf("buttons = %v", options.Buttons)
	}
	if options.DefaultButton != 2 || options.CancelButton != 0 {
		t.Errorf("default/cancel = %d/%d", options.DefaultButton, options.CancelButton)
	}
	if url := waitForUpdateChannel(t, opened); url != release.DownloadURL {
		t.Errorf("opened %q, want %q", url, release.DownloadURL)
	}
	snapshot := updates.snapshot()
	if snapshot.State != updateStateAvailable || snapshot.Release == nil || snapshot.Release.Version != release.Version {
		t.Errorf("state after the check = %+v", snapshot)
	}
	if snapshot.CheckedAt.IsZero() {
		t.Error("the check did not record when it ran")
	}
	record := updatePrefs.LastCheck
	if record == nil {
		t.Fatal("the check was not recorded in the preferences")
	}
	if record.State != string(updateStateAvailable) || record.Version != release.Version || record.Build != release.BuildNumber {
		t.Errorf("preferences record = %+v", record)
	}
	if _, err := time.Parse(time.RFC3339, record.CheckedAt); err != nil {
		t.Errorf("recorded time %q: %v", record.CheckedAt, err)
	}
	if a.copyNotice != "" {
		t.Errorf("an offered update also toasted %q", a.copyNotice)
	}
}

// TestCheckForUpdatesKeepsLaterQuiet covers the two outcomes that must not
// interrupt: an up-to-date build and a failed check.
func TestCheckForUpdatesKeepsLaterQuiet(t *testing.T) {
	t.Run("up to date", func(t *testing.T) {
		feed := updateTestFeedJSON(t, updateRelease{Version: "0.2.2", BuildNumber: 202611150900, DownloadURL: "https://updates.example.com/0.2.2.zip"})
		a := updateTestApp()
		privateKey := setUpdateTestKey(t, "")
		server := httptest.NewServer(updateTestFeedHandler(t, privateKey, feed))
		t.Cleanup(server.Close)
		updateFeedURL = server.URL + "/feed.json"
		shown, opened := setUpdatableDialog(t), setUpdatableOpener(t)
		a.checkForUpdates()
		waitForUpdateState(t, updateStateCurrent)
		if a.copyNotice == "" || !strings.Contains(a.copyNotice, "已是最新版本") {
			t.Errorf("notice = %q", a.copyNotice)
		}
		select {
		case <-shown:
			t.Error("an up-to-date check opened a dialog")
		case <-opened:
			t.Error("an up-to-date check opened a page")
		default:
		}
		if record := updatePrefs.LastCheck; record == nil || record.State != string(updateStateCurrent) {
			t.Errorf("preferences record = %+v", record)
		}
	})
	t.Run("failed", func(t *testing.T) {
		a := updateTestApp()
		setUpdateTestKey(t, "")
		server := httptest.NewServer(http.NotFoundHandler())
		unreachable := server.URL
		server.Close()
		updateFeedURL = unreachable + "/feed.json"
		shown := setUpdatableDialog(t)
		a.checkForUpdates()
		waitForUpdateState(t, updateStateFailed)
		if a.copyNotice != updateFailureNotices[updateFailureNetwork] {
			t.Errorf("notice = %q", a.copyNotice)
		}
		select {
		case <-shown:
			t.Error("a failed check opened a dialog")
		default:
		}
		if record := updatePrefs.LastCheck; record == nil || record.Failure != string(updateFailureNetwork) {
			t.Errorf("preferences record = %+v", record)
		}
	})
}

// waitForUpdateState waits for a background check to publish its outcome.
func waitForUpdateState(t *testing.T, state updateState) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if updates.snapshot().State == state {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("state = %q, want %q", updates.snapshot().State, state)
}

func TestCheckForUpdatesWithoutConfigurationOnlyNotices(t *testing.T) {
	a := &app{testDispatch: func(fn func()) { fn() }}
	setUpdateBuildConfig(t, "", "")
	shown := setUpdatableDialog(t)
	a.checkForUpdates()
	if a.copyNotice != errUpdateFeedNotConfigured.Error() {
		t.Errorf("notice = %q", a.copyNotice)
	}
	if state := updates.snapshot().State; state != updateStateIdle {
		t.Errorf("state = %q, want idle", state)
	}
	select {
	case <-shown:
		t.Error("an unconfigured check opened a dialog")
	default:
	}
}

func TestSecondCheckWhileCheckingIsIgnored(t *testing.T) {
	a := updateTestApp()
	setUpdateTestKey(t, "https://updates.example.com/feed.json")
	shown, opened := setUpdatableDialog(t), setUpdatableOpener(t)
	if !updates.begin() {
		t.Fatal("the first check did not start")
	}
	a.checkForUpdates()
	if state := updates.snapshot().State; state != updateStateChecking {
		t.Errorf("state = %q, want checking", state)
	}
	select {
	case <-shown:
		t.Error("a second click opened a dialog")
	case <-opened:
		t.Error("a second click opened a page")
	default:
	}
}

func TestOfferUpdateRespectsLaterAndCopy(t *testing.T) {
	release := updateTestRelease()
	for _, test := range []struct {
		name   string
		button int
		open   bool
		clip   bool
		notice string
	}{
		{name: "later does nothing", button: 0},
		{name: "copy link copies it", button: 1, clip: true, notice: "下载链接已复制。"},
		{name: "open page opens it", button: 2, open: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := updateTestApp()
			previous := updateDialog
			updateDialog = func(mygo.MessageOptions) (mygo.MessageResult, error) {
				return mygo.MessageResult{Button: test.button}, nil
			}
			t.Cleanup(func() { updateDialog = previous })
			opened := setUpdatableOpener(t)
			written := setUpdatableClipboard(t)
			a.offerUpdate(release)
			if test.open {
				if url := waitForUpdateChannel(t, opened); url != release.DownloadURL {
					t.Errorf("opened %q", url)
				}
			} else {
				select {
				case url := <-opened:
					t.Errorf("opened %q", url)
				default:
				}
			}
			if test.clip {
				if text := waitForUpdateChannel(t, written); text != release.DownloadURL {
					t.Errorf("copied %q", text)
				}
			} else {
				select {
				case text := <-written:
					t.Errorf("copied %q", text)
				default:
				}
			}
			if a.copyNotice != test.notice {
				t.Errorf("notice = %q, want %q", a.copyNotice, test.notice)
			}
		})
	}
}

func TestOpenDownloadPageFallsBackToCopying(t *testing.T) {
	release := updateTestRelease()
	a := updateTestApp()
	previous := updateOpenExternal
	updateOpenExternal = func(string) error { return os.ErrPermission }
	t.Cleanup(func() { updateOpenExternal = previous })
	written := setUpdatableClipboard(t)
	a.openUpdateDownloadPage(release)
	if text := waitForUpdateChannel(t, written); text != release.DownloadURL {
		t.Errorf("copied %q", text)
	}
	if a.copyNotice != "无法打开下载页，下载链接已复制。" {
		t.Errorf("notice = %q", a.copyNotice)
	}
}

func TestUpdateOfferDetailShowsVersionsAndTrimmedNotes(t *testing.T) {
	long := strings.Repeat("很长的更新说明。", 200)
	detail := updateOfferDetail(updateRelease{Version: "0.2.3", Notes: long, PublishedAt: "2026-11-15T09:00:00Z"}, updateTestCurrent())
	if !strings.Contains(detail, "0.2.2（构建 202611150900）") {
		t.Errorf("detail does not name the running version: %q", detail)
	}
	if !strings.Contains(detail, "…") {
		t.Error("long notes were not trimmed")
	}
	if runes := len([]rune(updateNotesSummary(long))); runes > updateNotesLimit+1 {
		t.Errorf("notes summary is %d runes, want at most %d", runes, updateNotesLimit+1)
	}
	if empty := updateOfferDetail(updateRelease{Version: "0.2.3"}, updateTestCurrent()); strings.HasPrefix(empty, "\n") {
		t.Errorf("empty notes left a blank first line: %q", empty)
	}
	if summary := updateNotesSummary("  \r\n "); summary != "" {
		t.Errorf("blank notes summarized as %q", summary)
	}
}

// TestPreferencesKeepTheUpdateSection is the only file this milestone adds
// fields to: an older file loads, and the new section round-trips.
func TestPreferencesKeepTheUpdateSection(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "preferences.json")
	setUpdateBuildConfig(t, "", "")
	updatePrefs = updatePreferenceState{
		FeedURL:   "https://updates.example.com/native-dsh/feed.json",
		LastCheck: &updateCheckRecord{CheckedAt: "2026-11-15T11:00:00Z", State: "available", Version: "0.2.3", Build: 202611151800},
	}
	(&app{}).savePreferencesTo(path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the preferences: %v", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatalf("the preferences are not JSON: %v", err)
	}
	if _, ok := document["update"]; !ok {
		t.Fatalf("the update section is missing: %s", data)
	}
	updatePrefs = updatePreferenceState{}
	restored := &app{}
	restored.loadPreferencesFrom(path)
	if updatePrefs.FeedURL != "https://updates.example.com/native-dsh/feed.json" {
		t.Errorf("feed override = %q", updatePrefs.FeedURL)
	}
	if record := updatePrefs.LastCheck; record == nil || record.State != "available" || record.Build != 202611151800 {
		t.Errorf("record = %+v", updatePrefs.LastCheck)
	}
	// A file written before M7a keeps loading, with no update section.
	older := filepath.Join(directory, "older.json")
	if err := os.WriteFile(older, []byte(`{"serverUrl":"https://dsh.rkbkosp.cn","ui":{"fontSize":14}}`), 0o600); err != nil {
		t.Fatalf("writing the older preferences: %v", err)
	}
	updatePrefs = updatePreferenceState{FeedURL: "https://stale.example.com/feed.json"}
	legacy := &app{}
	legacy.loadPreferencesFrom(older)
	if updatePrefs.FeedURL != "" || updatePrefs.LastCheck != nil {
		t.Errorf("an older file restored update state: %+v", updatePrefs)
	}
	// And a preferences file that never checked stays as small as it was.
	setUpdateBuildConfig(t, "", "")
	(&app{}).savePreferencesTo(path)
	data, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the rewritten preferences: %v", err)
	}
	if strings.Contains(string(data), `"update"`) {
		t.Errorf("an untouched client grew an update section: %s", data)
	}
}

func TestUpdateSettingsDescriptionNamesTheState(t *testing.T) {
	setUpdateBuildConfig(t, "https://updates.example.com/feed.json", base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize)))
	a := updateTestApp()
	if description := a.updateSettingsDescription(); !strings.Contains(description, "尚未检查更新") {
		t.Errorf("description = %q", description)
	}
	updates.apply(updateResult{State: updateStateAvailable, Current: updateTestCurrent(), Release: func() *updateRelease { release := updateTestRelease(); return &release }(), CheckedAt: time.Now()})
	if description := a.updateSettingsDescription(); !strings.Contains(description, "发现新版本 0.2.3") {
		t.Errorf("description = %q", description)
	}
	if description := a.updateSettingsDescription(); !strings.Contains(description, "上次检查") {
		t.Errorf("description does not say when the check ran: %q", description)
	}
}

// TestRunUpdateCheckOnceWritesEvidence covers the QA entry point that
// scripts/probe-update-check.mjs drives: no window, one JSON file.
func TestRunUpdateCheckOnceWritesEvidence(t *testing.T) {
	publicKey, _ := newUpdateTestKey(t)
	setUpdateBuildConfig(t, "http://127.0.0.1:9/feed.json", base64.StdEncoding.EncodeToString(publicKey))
	path := filepath.Join(t.TempDir(), "evidence", "check.json")
	if code := runUpdateCheckOnce(path); code != 0 {
		t.Fatalf("runUpdateCheckOnce = %d", code)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the evidence: %v", err)
	}
	var evidence updateCheckEvidence
	if err := json.Unmarshal(data, &evidence); err != nil {
		t.Fatalf("the evidence is not JSON: %v", err)
	}
	if !evidence.DevBuild || evidence.Phase != "check-only" {
		t.Errorf("evidence = %+v", evidence)
	}
	if evidence.State != string(updateStateFailed) || evidence.Failure != string(updateFailureNetwork) {
		t.Errorf("evidence state = %q failure = %q", evidence.State, evidence.Failure)
	}
	if evidence.Feed.URL != "http://127.0.0.1:9/feed.json" || evidence.Feed.Source != "build" {
		t.Errorf("evidence feed = %+v", evidence.Feed)
	}
	if evidence.CheckedAt == "" || evidence.DurationMS < 0 {
		t.Errorf("evidence timing = %+v", evidence)
	}
}

func TestUpdateFailureNoticesAreCalmAndDistinct(t *testing.T) {
	seen := map[string]updateFailure{}
	for _, failure := range []updateFailure{updateFailureConfig, updateFailureNetwork, updateFailureSignature, updateFailureFormat} {
		notice := updateNoticeFor(failure)
		if notice == "" {
			t.Errorf("%q has no notice", failure)
		}
		for _, alarming := range []string{"错误", "失败原因", "危险", "严重", "损坏"} {
			if strings.Contains(notice, alarming) {
				t.Errorf("%q notice sounds alarming: %q", failure, notice)
			}
		}
		if previous, ok := seen[notice]; ok {
			t.Errorf("%q and %q share the notice %q", failure, previous, notice)
		}
		seen[notice] = failure
	}
	if unknown := updateNoticeFor("weird"); unknown == "" || unknown == updateFailureNotices[updateFailureNetwork] {
		t.Errorf("an unknown failure class got %q", unknown)
	}
}

// A launch that cannot read its own version (a bare `go run`, a stripped bundle)
// must not claim it is up to date, and must not offer anything either.
func TestCheckForUpdatesWithoutAVersionOnlyNotices(t *testing.T) {
	a := updateTestApp()
	validKey := base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize))
	setUpdateBuildConfig(t, "https://updates.example.com/feed.json", validKey)
	updateRunningVersion = func() updateVersion { return updateVersion{} }
	shown, opened := setUpdatableDialog(t), setUpdatableOpener(t)
	a.checkForUpdates()
	if a.copyNotice != updateUnknownVersionNotice {
		t.Errorf("notice = %q", a.copyNotice)
	}
	if state := updates.snapshot().State; state != updateStateIdle {
		t.Errorf("state = %q, want idle", state)
	}
	select {
	case <-shown:
		t.Error("a check without a running version opened a dialog")
	case <-opened:
		t.Error("a check without a running version opened a page")
	default:
	}
}

func TestRunUpdateCheckOnceNeedsAVersion(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, ed25519.PublicKeySize))
	setUpdateBuildConfig(t, "https://updates.example.com/feed.json", validKey)
	updateRunningVersion = func() updateVersion { return updateVersion{} }
	path := filepath.Join(t.TempDir(), "check.json")
	if code := runUpdateCheckOnce(path); code != 0 {
		t.Fatalf("runUpdateCheckOnce = %d", code)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading the evidence: %v", err)
	}
	var evidence updateCheckEvidence
	if err := json.Unmarshal(data, &evidence); err != nil {
		t.Fatalf("the evidence is not JSON: %v", err)
	}
	if evidence.State != string(updateStateFailed) || evidence.Failure != string(updateFailureConfig) || evidence.Reason != "unknown-version" {
		t.Errorf("evidence = %+v", evidence)
	}
	if evidence.Message != updateUnknownVersionNotice {
		t.Errorf("message = %q", evidence.Message)
	}
}
