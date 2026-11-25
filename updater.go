package main

// Update checks (M7a): fetch one small signed feed, verify it, and tell the
// person whether a newer build exists.
//
// What this file deliberately does not do is download, unpack, replace or
// restart anything. M7a ends at "here is a newer version, here is its download
// page"; M7b owns everything that touches the installed bundle.
//
// The trust anchor is an Ed25519 public key compiled into the binary. A feed
// whose signature does not verify over the exact bytes fetched is not used at
// all: it is a failed check, never a "new version" offer. The feed location may
// be overridden at run time from the preferences file, the key may not.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

const (
	// updateCheckTimeout bounds one check, signature fetch included.
	updateCheckTimeout = 15 * time.Second
	// updateFeedMaxBytes caps the feed this client reads: a feed is a few
	// hundred bytes, and an unbounded read is an attack surface.
	updateFeedMaxBytes = 1 << 20
	// updateSignatureMaxBytes caps the detached signature.
	updateSignatureMaxBytes = 4 << 10
	// updateNotesLimit keeps the release notes readable in a dialog.
	updateNotesLimit = 480
	// updateMenuID identifies the application-menu entry.
	updateMenuID = "app.checkUpdates"
	// updateFeedSchemaVersion is the only feed format this build understands.
	updateFeedSchemaVersion = 1
	// updateSignatureSuffix names the detached signature beside the feed.
	updateSignatureSuffix = ".sig"
)

// Build-time defaults, injected with -ldflags -X by scripts/build-app.sh. Both
// stay empty in a build without an update feed, which is what hides the menu
// entry instead of showing a button that cannot work.
var (
	updateFeedURL       string
	updateFeedPublicKey string
)

// originalUpdateFeedHost serves the upstream Electron application. Pointing an
// update check at it would offer to replace this client with the original app,
// so that host is refused everywhere, whatever the configuration says.
const originalUpdateFeedHost = "download.deepseek.com"

// updateVersion is the pair an update check compares. build is
// CFBundleVersion, the monotonic stamp M7-0 introduced; version is
// CFBundleShortVersionString, the dsh release's numeric core.
type updateVersion struct {
	version string
	build   int64
}

// known reports whether anything at all is known about the version. A build
// with no app-version.json (a bare `go run`) knows nothing, and then a check
// cannot claim a newer release.
func (v updateVersion) known() bool { return v.version != "" || v.build > 0 }

func (v updateVersion) String() string {
	switch {
	case v.version != "" && v.build > 0:
		return fmt.Sprintf("%s（构建 %d）", v.version, v.build)
	case v.version != "":
		return v.version
	case v.build > 0:
		return fmt.Sprintf("构建 %d", v.build)
	}
	return "未知版本"
}

// compareUpdateVersions orders two versions: >0 when a is newer than b.
//
// CFBundleVersion is the identity when both builds are known, because it is the
// monotonic stamp every release moves. Only when one side has no build number
// do the marketing versions compare as semantic versions. A version that
// cannot be parsed never counts as newer, so a malformed feed cannot claim an
// update.
func compareUpdateVersions(a, b updateVersion) int {
	if a.build > 0 && b.build > 0 {
		switch {
		case a.build > b.build:
			return 1
		case a.build < b.build:
			return -1
		}
		return 0
	}
	return compareSemanticVersions(a.version, b.version)
}

// semanticVersion is a parsed marketing version: up to three numeric components
// and the prerelease identifiers, with build metadata dropped.
type semanticVersion struct {
	numbers []int64
	pre     []string
}

// parseSemanticVersion parses MAJOR[.MINOR[.PATCH]][-PRERELEASE][+METADATA]. It
// accepts fewer components than semver requires because the upstream runtime
// versions are what they are, and reports failure instead of guessing.
func parseSemanticVersion(raw string) (semanticVersion, bool) {
	var parsed semanticVersion
	text := strings.TrimSpace(raw)
	if text == "" {
		return parsed, false
	}
	if index := strings.IndexByte(text, '+'); index >= 0 {
		text = text[:index]
	}
	core := text
	if index := strings.IndexByte(text, '-'); index >= 0 {
		core = text[:index]
		for _, id := range strings.Split(text[index+1:], ".") {
			if id == "" {
				return semanticVersion{}, false
			}
			parsed.pre = append(parsed.pre, id)
		}
	}
	parts := strings.Split(core, ".")
	if len(parts) > 3 {
		return semanticVersion{}, false
	}
	for _, part := range parts {
		if part == "" {
			return semanticVersion{}, false
		}
		for i := 0; i < len(part); i++ {
			if part[i] < '0' || part[i] > '9' {
				return semanticVersion{}, false
			}
		}
		number, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			return semanticVersion{}, false
		}
		parsed.numbers = append(parsed.numbers, number)
	}
	return parsed, true
}

// compareSemanticVersions compares two marketing versions; an unparsable side
// makes them equal, which means "no update offered".
func compareSemanticVersions(a, b string) int {
	parsedA, okA := parseSemanticVersion(a)
	parsedB, okB := parseSemanticVersion(b)
	if !okA || !okB {
		return 0
	}
	for i := 0; i < 3; i++ {
		var left, right int64
		if i < len(parsedA.numbers) {
			left = parsedA.numbers[i]
		}
		if i < len(parsedB.numbers) {
			right = parsedB.numbers[i]
		}
		switch {
		case left > right:
			return 1
		case left < right:
			return -1
		}
	}
	// A release is newer than any prerelease of the same numbers.
	switch {
	case len(parsedA.pre) == 0 && len(parsedB.pre) == 0:
		return 0
	case len(parsedA.pre) == 0:
		return 1
	case len(parsedB.pre) == 0:
		return -1
	}
	for i := 0; i < len(parsedA.pre) && i < len(parsedB.pre); i++ {
		left, right := parsedA.pre[i], parsedB.pre[i]
		leftNumber, leftErr := strconv.ParseInt(left, 10, 64)
		rightNumber, rightErr := strconv.ParseInt(right, 10, 64)
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNumber != rightNumber {
				if leftNumber > rightNumber {
					return 1
				}
				return -1
			}
		case leftErr == nil:
			// Numeric identifiers have lower precedence than alphanumeric ones.
			return -1
		case rightErr == nil:
			return 1
		default:
			if left != right {
				if left > right {
					return 1
				}
				return -1
			}
		}
	}
	switch {
	case len(parsedA.pre) > len(parsedB.pre):
		return 1
	case len(parsedA.pre) < len(parsedB.pre):
		return -1
	}
	return 0
}

// updateRelease is one entry of the feed. Every field is optional to parse so
// the check can report a malformed feed as such instead of silently ignoring
// the entry.
type updateRelease struct {
	Version                    string `json:"version"`
	BuildNumber                int64  `json:"buildNumber,omitempty"`
	MinimumRuntimeHostProtocol int    `json:"minimumRuntimeHostProtocol,omitempty"`
	Notes                      string `json:"notes,omitempty"`
	DownloadURL                string `json:"downloadURL"`
	PublishedAt                string `json:"publishedAt,omitempty"`
}

// updateFeed is the document feed.json.sig signs.
type updateFeed struct {
	SchemaVersion int             `json:"schemaVersion"`
	Channel       string          `json:"channel,omitempty"`
	Releases      []updateRelease `json:"releases"`
}

// updateState is the state machine the menu, the settings row and the QA
// evidence read.
type updateState string

const (
	updateStateIdle      updateState = "idle"
	updateStateChecking  updateState = "checking"
	updateStateCurrent   updateState = "current"
	updateStateAvailable updateState = "available"
	updateStateFailed    updateState = "failed"
)

// updateFailure is why a check failed. The notices are deliberately calm: a
// failed check leaves the person on the build they have, which is safe.
type updateFailure string

const (
	updateFailureNone      updateFailure = ""
	updateFailureConfig    updateFailure = "config"
	updateFailureNetwork   updateFailure = "network"
	updateFailureSignature updateFailure = "signature"
	updateFailureFormat    updateFailure = "format"
)

// updateFailureNotices is the one line each failure class shows.
var updateFailureNotices = map[updateFailure]string{
	updateFailureConfig:    "还没有配置更新源，暂时无法检查更新。",
	updateFailureNetwork:   "暂时连不上更新服务器，请稍后再试。",
	updateFailureSignature: "这次更新信息没有通过校验，暂不使用它。",
	updateFailureFormat:    "更新信息格式不正确，暂时无法检查更新。",
}

// updateTimeoutNotice replaces the network line when the deadline expired,
// because "timed out" is the actionable part.
const updateTimeoutNotice = "检查更新超时了，请检查网络后再试。"

// updateUnknownVersionNotice is what a launch without app-version.json says: it
// has nothing to compare with, so it cannot honestly report "up to date".
const updateUnknownVersionNotice = "这个构建没有版本信息，暂时无法检查更新。"

// updateNoticeFor is the text for a failure class.
func updateNoticeFor(failure updateFailure) string {
	if notice, ok := updateFailureNotices[failure]; ok {
		return notice
	}
	return "这次检查没有完成，请稍后再试。"
}

// updateResult is one finished check, with everything the UI and the evidence
// need.
type updateResult struct {
	State   updateState
	Current updateVersion
	Release *updateRelease
	Failure updateFailure
	Message string
	// Reason is a short machine-readable detail for evidence and logs; it is
	// never shown to the person.
	Reason    string
	Channel   string
	Releases  int
	FeedBytes int
	CheckedAt time.Time
	Duration  time.Duration
}

// updateStatus is this process's last check. A single window owns it, so one
// value is enough; tests reset it.
type updateStatus struct {
	mu        sync.Mutex
	state     updateState
	current   updateVersion
	release   *updateRelease
	failure   updateFailure
	message   string
	checkedAt time.Time
}

var updates = &updateStatus{state: updateStateIdle}

// updateSnapshot is a copy safe to read from any goroutine.
type updateSnapshot struct {
	State     updateState
	Current   updateVersion
	Release   *updateRelease
	Failure   updateFailure
	Message   string
	CheckedAt time.Time
}

func (s *updateStatus) snapshot() updateSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot := updateSnapshot{State: s.state, Current: s.current, Failure: s.failure, Message: s.message, CheckedAt: s.checkedAt}
	if s.release != nil {
		release := *s.release
		snapshot.Release = &release
	}
	return snapshot
}

// begin marks a check as running. It returns false when one already is, so a
// second click cannot start a parallel check.
func (s *updateStatus) begin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == updateStateChecking {
		return false
	}
	s.state = updateStateChecking
	s.release = nil
	s.failure = updateFailureNone
	s.message = ""
	return true
}

func (s *updateStatus) apply(result updateResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = result.State
	s.current = result.Current
	s.release = result.Release
	s.failure = result.Failure
	s.message = result.Message
	s.checkedAt = result.CheckedAt
}

// reset restores the initial state; tests use it.
func (s *updateStatus) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = updateStateIdle
	s.current = updateVersion{}
	s.release = nil
	s.failure = updateFailureNone
	s.message = ""
	s.checkedAt = time.Time{}
}

// Summary is the one line the settings row shows.
func (s updateSnapshot) Summary() string {
	switch s.State {
	case updateStateChecking:
		return "正在检查更新…"
	case updateStateCurrent:
		return "已是最新版本"
	case updateStateAvailable:
		if s.Release != nil {
			return "发现新版本 " + s.Release.Version
		}
		return "发现新版本"
	case updateStateFailed:
		if s.Message != "" {
			return s.Message
		}
		return updateNoticeFor(s.Failure)
	}
	return "尚未检查更新"
}

// updatePreferenceState is the updater's own part of the preferences file: an
// update source configured at run time over the build's, and the last check's
// time and outcome. It is the only thing M7a adds to that file.
type updatePreferenceState struct {
	FeedURL   string             `json:"feedUrl,omitempty"`
	LastCheck *updateCheckRecord `json:"lastCheck,omitempty"`
	Mandatory *updateRelease     `json:"mandatoryUpdate,omitempty"`
}

// updateCheckRecord is what the last check concluded, as preferences keep it.
type updateCheckRecord struct {
	// CheckedAt is RFC 3339 in UTC.
	CheckedAt string `json:"checkedAt"`
	State     string `json:"state"`
	Version   string `json:"version,omitempty"`
	Build     int64  `json:"buildNumber,omitempty"`
	Failure   string `json:"failure,omitempty"`
	Message   string `json:"message,omitempty"`
}

// updatePrefs is that state: the updater reads it, the preferences file writes
// it. The rest of the preferences live on the app struct.
var updatePrefs updatePreferenceState

// empty reports whether there is nothing to persist yet, so a preferences file
// written before any check keeps its shape.
func (p updatePreferenceState) empty() bool { return p.FeedURL == "" && p.LastCheck == nil }

// normalize trims what a hand-edited file may have padded.
func (p *updatePreferenceState) normalize() {
	p.FeedURL = strings.TrimSpace(p.FeedURL)
	if p.LastCheck != nil {
		p.LastCheck.CheckedAt = strings.TrimSpace(p.LastCheck.CheckedAt)
		p.LastCheck.State = strings.TrimSpace(p.LastCheck.State)
		p.LastCheck.Version = strings.TrimSpace(p.LastCheck.Version)
		p.LastCheck.Failure = strings.TrimSpace(p.LastCheck.Failure)
	}
}

// updateConfig is the resolved feed and the key its signature must verify with.
type updateConfig struct {
	feedURL   string
	publicKey ed25519.PublicKey
	// source is "preferences" or "build", for evidence only.
	source string
}

// errUpdateFeedNotConfigured is the config failure of a build (and a
// preferences file) without a feed.
var errUpdateFeedNotConfigured = errors.New(updateFailureNotices[updateFailureConfig])

// resolveUpdateConfig reads the effective feed. The URL may come from the
// preferences; the public key only ever comes from the build, so a settings
// file cannot widen what this binary trusts.
func resolveUpdateConfig() (updateConfig, error) {
	feed := strings.TrimSpace(updatePrefs.FeedURL)
	source := "preferences"
	if feed == "" {
		feed = strings.TrimSpace(updateFeedURL)
		source = "build"
	}
	if feed == "" {
		return updateConfig{}, errUpdateFeedNotConfigured
	}
	key := strings.TrimSpace(updateFeedPublicKey)
	if key == "" {
		return updateConfig{}, errors.New("这个构建没有更新公钥，暂时无法检查更新。")
	}
	publicKey, err := decodeUpdatePublicKey(key)
	if err != nil {
		return updateConfig{}, errors.New("这个构建的更新公钥无效，暂时无法检查更新。")
	}
	if err := validateUpdateFeedURL(feed); err != nil {
		return updateConfig{}, err
	}
	return updateConfig{feedURL: feed, publicKey: publicKey, source: source}, nil
}

// updateCheckConfigured reports whether this launch could check at all, which
// is what decides whether the menu entry exists.
func updateCheckConfigured() bool {
	_, err := resolveUpdateConfig()
	return err == nil
}

// decodeUpdatePublicKey reads the base64 Ed25519 public key injected at build
// time: standard or unpadded base64 of the 32 raw bytes.
func decodeUpdatePublicKey(encoded string) (ed25519.PublicKey, error) {
	compact := strings.Join(strings.Fields(encoded), "")
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		decoded, err := encoding.DecodeString(compact)
		if err != nil {
			continue
		}
		if len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("public key is %d bytes, want %d", len(decoded), ed25519.PublicKeySize)
		}
		return ed25519.PublicKey(decoded), nil
	}
	return nil, errors.New("public key is not base64")
}

// isLoopbackHost reports whether host names this machine, where plain HTTP
// cannot leave the box. QA feeds run there; anything else must be HTTPS.
func isLoopbackHost(host string) bool {
	name := strings.ToLower(strings.TrimSuffix(host, "."))
	if name == "localhost" {
		return true
	}
	ip := net.ParseIP(name)
	return ip != nil && ip.IsLoopback()
}

// isOriginalUpdateHost reports whether host is the upstream Electron feed.
func isOriginalUpdateHost(host string) bool {
	name := strings.ToLower(strings.TrimSuffix(host, "."))
	return name == originalUpdateFeedHost || strings.HasSuffix(name, "."+originalUpdateFeedHost)
}

// validateUpdateFeedURL accepts one absolute HTTPS URL, or plain HTTP on the
// loopback interface for local QA.
func validateUpdateFeedURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.Path == "" {
		return errors.New("更新源地址无效，暂时无法检查更新。")
	}
	if isOriginalUpdateHost(parsed.Hostname()) {
		return errors.New("更新源不能指向原版应用的下载地址，暂时无法检查更新。")
	}
	switch {
	case parsed.Scheme == "https":
		return nil
	case parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()):
		return nil
	}
	return errors.New("更新源必须是 HTTPS 地址，暂时无法检查更新。")
}

// validateUpdateDownloadURL accepts the page the dialog opens.
func validateUpdateDownloadURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.Path == "" {
		return errors.New("downloadURL is not an absolute URL")
	}
	if isOriginalUpdateHost(parsed.Hostname()) {
		return errors.New("downloadURL points at the original application")
	}
	switch {
	case parsed.Scheme == "https":
		return nil
	case parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()):
		return nil
	}
	return errors.New("downloadURL is not HTTPS")
}

// updateHTTPClient is the client one check uses. A redirect may not leave the
// configured host: the signature covers the feed, but a redirect would still
// move where the signature is fetched from and could keep a failing host
// looking healthy.
func updateHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if req.URL.Host != via[0].URL.Host {
				return fmt.Errorf("redirect left the update host: %s", req.URL.Host)
			}
			return nil
		},
	}
}

// updateHTTPStatusError keeps an answered-but-refused document apart from a
// connection failure, so a missing signature reads as a trust problem rather
// than as a network one.
type updateHTTPStatusError struct {
	url    string
	status int
}

func (e *updateHTTPStatusError) Error() string { return fmt.Sprintf("%s: HTTP %d", e.url, e.status) }

// fetchUpdateDocument reads one bounded document.
func fetchUpdateDocument(ctx context.Context, client *http.Client, rawURL string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, &updateHTTPStatusError{url: rawURL, status: response.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errUpdateDocumentTooLarge
	}
	return body, nil
}

var errUpdateDocumentTooLarge = errors.New("update document is too large")

// performUpdateCheck is the whole check without any UI: fetch the feed and its
// signature, verify, parse, and pick the newest release newer than current.
func performUpdateCheck(ctx context.Context, cfg updateConfig, current updateVersion) (result updateResult) {
	started := time.Now()
	result = updateResult{State: updateStateFailed, Current: current}
	// The clock is filled in on every return path, including the early ones.
	defer func() { result.CheckedAt, result.Duration = time.Now().UTC(), time.Since(started) }()
	client := updateHTTPClient()
	body, err := fetchUpdateDocument(ctx, client, cfg.feedURL, updateFeedMaxBytes)
	if err != nil {
		result.Failure, result.Message, result.Reason = updateFailureNetwork, updateNoticeFor(updateFailureNetwork), "unreachable"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.Message, result.Reason = updateTimeoutNotice, "timeout"
		}
		if errors.Is(err, errUpdateDocumentTooLarge) {
			result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "feed-too-large"
		}
		return result
	}
	result.FeedBytes = len(body)
	signatureBody, err := fetchUpdateDocument(ctx, client, cfg.feedURL+updateSignatureSuffix, updateSignatureMaxBytes)
	if err != nil {
		var statusError *updateHTTPStatusError
		if errors.As(err, &statusError) && statusError.status >= 400 && statusError.status < 500 {
			// The feed was served but its signature was not: that is a trust
			// problem, not a connectivity one.
			result.Failure, result.Message, result.Reason = updateFailureSignature, updateNoticeFor(updateFailureSignature), "signature-unavailable"
			return result
		}
		result.Failure, result.Message, result.Reason = updateFailureNetwork, updateNoticeFor(updateFailureNetwork), "signature-unreachable"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.Message, result.Reason = updateTimeoutNotice, "timeout"
		}
		if errors.Is(err, errUpdateDocumentTooLarge) {
			result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "signature-too-large"
		}
		return result
	}
	signature, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(string(signatureBody)), ""))
	if err != nil || len(signature) != ed25519.SignatureSize {
		result.Failure, result.Message, result.Reason = updateFailureSignature, updateNoticeFor(updateFailureSignature), "signature-malformed"
		return result
	}
	if !ed25519.Verify(cfg.publicKey, body, signature) {
		result.Failure, result.Message, result.Reason = updateFailureSignature, updateNoticeFor(updateFailureSignature), "signature-mismatch"
		return result
	}
	var feed updateFeed
	if err := json.Unmarshal(body, &feed); err != nil {
		result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "json"
		return result
	}
	if feed.SchemaVersion != updateFeedSchemaVersion {
		result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "schema-version"
		return result
	}
	result.Channel, result.Releases = feed.Channel, len(feed.Releases)
	if len(feed.Releases) == 0 {
		// A signed feed with no releases is a publishing mistake, not a claim
		// that this build is current.
		result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "no-releases"
		return result
	}
	var best updateRelease
	var bestVersion updateVersion
	for _, release := range feed.Releases {
		if strings.TrimSpace(release.Version) == "" || strings.TrimSpace(release.DownloadURL) == "" {
			result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "incomplete-release"
			return result
		}
		if err := validateUpdateDownloadURL(release.DownloadURL); err != nil {
			result.Failure, result.Message, result.Reason = updateFailureFormat, updateNoticeFor(updateFailureFormat), "download-url"
			return result
		}
		candidate := updateVersion{version: strings.TrimSpace(release.Version), build: release.BuildNumber}
		// Never offer a downgrade or the build already running.
		if compareUpdateVersions(candidate, current) <= 0 {
			continue
		}
		if bestVersion.known() && compareUpdateVersions(candidate, bestVersion) <= 0 {
			continue
		}
		best, bestVersion = release, candidate
	}
	if !bestVersion.known() {
		result.State = updateStateCurrent
		return result
	}
	result.State, result.Release = updateStateAvailable, &best
	return result
}

// appVersionManifestPath is Contents/Resources/app-version.json of the bundle
// this executable runs from, "" when it does not run from a bundle.
func appVersionManifestPath() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Clean(filepath.Join(filepath.Dir(executable), "..", "Resources", "app-version.json"))
}

// updateRunningVersion reads this bundle's version numbers. Tests replace it,
// because a test binary does not run from an .app bundle.
var updateRunningVersion = readAppVersion

// currentAppVersion is what this launch compares releases with.
func currentAppVersion() updateVersion { return updateRunningVersion() }

// readAppVersion reads the version numbers scripts/build-app.sh wrote beside
// the executable. Unknown is a legitimate answer: a bare `go run` has none.
func readAppVersion() updateVersion {
	path := appVersionManifestPath()
	if path == "" {
		return updateVersion{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return updateVersion{}
	}
	var manifest struct {
		AppVersion  string `json:"appVersion"`
		BuildNumber string `json:"buildNumber"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		return updateVersion{}
	}
	build, _ := strconv.ParseInt(strings.TrimSpace(manifest.BuildNumber), 10, 64)
	return updateVersion{version: strings.TrimSpace(manifest.AppVersion), build: build}
}

// UI hooks, replaceable so tests can observe them without a window.
var (
	updateDialog         = mygo.Dialog.Message
	updateOpenExternal   = mygo.Shell.OpenExternal
	updateClipboardWrite = func(text string) error { return mygo.Clipboard.Write(transfer.TextData(text)) }
)

// The installed menu entry, so a check in flight can disable it. MyGo menu
// items belong to the menu the application installed.
var (
	updateMenuItemMu sync.Mutex
	updateMenuItem   *mygo.MenuItem
)

func setUpdateMenuItem(item *mygo.MenuItem) {
	updateMenuItemMu.Lock()
	updateMenuItem = item
	updateMenuItemMu.Unlock()
}

func setUpdateMenuEnabled(enabled bool) {
	updateMenuItemMu.Lock()
	item := updateMenuItem
	updateMenuItemMu.Unlock()
	if item != nil {
		item.SetEnabled(enabled)
	}
}

var updateLoggedMissingConfig bool
var updateLoggedMissingConfigMu sync.Mutex

func logUpdateMissingConfigOnce() {
	updateLoggedMissingConfigMu.Lock()
	defer updateLoggedMissingConfigMu.Unlock()
	if updateLoggedMissingConfig {
		return
	}
	updateLoggedMissingConfig = true
	log.Printf("updater: no update feed configured (build -X main.updateFeedURL / main.updateFeedPublicKey); update checks are disabled")
}

// checkForUpdatesMenuItem is the application-menu entry: present only when this
// launch could actually check, absent otherwise, so no button promises
// something the build cannot do.
func (a *app) checkForUpdatesMenuItem() *mygo.MenuItem {
	if !updateCheckConfigured() {
		logUpdateMissingConfigOnce()
		return nil
	}
	return &mygo.MenuItem{
		ID:      updateMenuID,
		Label:   "检查更新…",
		ToolTip: "检查是否有新版本（不会自动下载或安装）",
		Click:   func(*mygo.MenuItem, *mygo.Window) { a.checkForUpdates() },
	}
}

// checkForUpdates runs one check off the main thread and reports it back
// through the window loop.
func (a *app) checkForUpdates() {
	config, err := resolveUpdateConfig()
	if err != nil {
		a.notifyUpdate(err.Error())
		return
	}
	current := currentAppVersion()
	if !current.known() {
		a.notifyUpdate(updateUnknownVersionNotice)
		return
	}
	if !updates.begin() {
		return
	}
	setUpdateMenuEnabled(false)
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	go func() {
		ctx, cancel := context.WithTimeout(parent, updateCheckTimeout)
		defer cancel()
		result := performUpdateCheck(ctx, config, current)
		a.update(func() { a.finishUpdateCheck(result) })
	}()
}

// finishUpdateCheck publishes a finished check: state, preferences, the menu,
// and either the offer dialog or a quiet notice.
func (a *app) finishUpdateCheck(result updateResult) {
	updates.apply(result)
	setUpdateMenuEnabled(true)
	a.recordUpdateCheck(result)
	switch result.State {
	case updateStateAvailable:
		if result.Release != nil {
			a.offerUpdate(*result.Release)
		}
	case updateStateCurrent:
		a.notifyUpdate("已是最新版本：" + result.Current.String() + "。")
	case updateStateFailed:
		a.notifyUpdate(result.Message)
	}
}

// recordUpdateCheck keeps the last check in the preferences file: when it ran
// and what it concluded.
func (a *app) recordUpdateCheck(result updateResult) {
	record := &updateCheckRecord{
		CheckedAt: result.CheckedAt.UTC().Format(time.RFC3339),
		State:     string(result.State),
		Failure:   string(result.Failure),
		Message:   result.Message,
	}
	if result.Release != nil {
		record.Version, record.Build = result.Release.Version, result.Release.BuildNumber
	}
	updatePrefs.LastCheck = record
	a.savePreferences()
}

// offerUpdate asks once, and only acts on the button that was clicked. Nothing
// here downloads or installs: the person leaves for the download page.
func (a *app) offerUpdate(release updateRelease) {
	if updateIsMandatory(release, a.hostProtocol()) {
		a.mandatoryUpdate = &release
		updatePrefs.Mandatory = &release
		a.savePreferences()
		return
	}
	a.updateOffer = &release
	a.updateOfferOpen = true
}

// openUpdateDownloadPage opens the URL the signed feed named. A failure to open
// falls back to copying it, so the link is never lost in a log line.
func (a *app) openUpdateDownloadPage(release updateRelease) {
	if err := updateOpenExternal(release.DownloadURL); err != nil {
		log.Printf("updater: opening the download page: %v", err)
		if copyErr := updateClipboardWrite(release.DownloadURL); copyErr != nil {
			a.notifyUpdate("无法打开下载页，请稍后再试。")
			return
		}
		a.notifyUpdate("无法打开下载页，下载链接已复制。")
	}
}

func (a *app) copyUpdateDownloadLink(release updateRelease) {
	if err := updateClipboardWrite(release.DownloadURL); err != nil {
		log.Printf("updater: copying the download link: %v", err)
		a.notifyUpdate("无法写入剪贴板，请检查剪贴板权限后重试。")
		return
	}
	a.notifyUpdate("下载链接已复制。")
}

// notifyUpdate uses the existing quiet notice channel: a check that found
// nothing, or failed, must not interrupt what the person is doing.
func (a *app) notifyUpdate(text string) {
	if text == "" {
		return
	}
	a.copyNotice = text
}

// updateOfferDetail is the dialog body: a short summary of the signed notes plus
// the versions being compared.
func updateOfferDetail(release updateRelease, current updateVersion) string {
	lines := []string{}
	if notes := updateNotesSummary(release.Notes); notes != "" {
		lines = append(lines, notes)
	}
	if release.PublishedAt != "" {
		lines = append(lines, "发布于 "+release.PublishedAt)
	}
	lines = append(lines, "当前版本 "+current.String()+"。下载后需要手动安装。")
	return strings.Join(lines, "\n\n")
}

// updateNotesSummary trims release notes to something a dialog can show.
func updateNotesSummary(notes string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(notes, "\r\n", "\n"))
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= updateNotesLimit {
		return trimmed
	}
	return string(runes[:updateNotesLimit]) + "…"
}

// updateSettingsDescription is the settings row's version and last-check line.
func (a *app) updateSettingsDescription() string {
	snapshot := updates.snapshot()
	parts := []string{"版本 " + currentAppVersion().String(), snapshot.Summary()}
	if !snapshot.CheckedAt.IsZero() {
		parts = append(parts, "上次检查 "+snapshot.CheckedAt.Local().Format("2006-01-02 15:04"))
	}
	return strings.Join(parts, " · ")
}

// updateCheckEvidence is what `--check-update-once` writes for
// scripts/probe-update-check.mjs. It records the check itself; M7a has no code
// path that downloads or installs anything, which the probe verifies against
// the bundle's own file list.
type updateCheckEvidence struct {
	GeneratedAt string `json:"generatedAt"`
	DevBuild    bool   `json:"devBuild"`
	Phase       string `json:"phase"`
	Current     struct {
		Version     string `json:"version"`
		BuildNumber int64  `json:"buildNumber"`
	} `json:"current"`
	Feed struct {
		URL       string `json:"url"`
		Source    string `json:"source"`
		PublicKey string `json:"publicKey"`
	} `json:"feed"`
	State     string `json:"state"`
	Failure   string `json:"failure,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Releases  int    `json:"releasesOffered"`
	FeedBytes int    `json:"feedBytes"`
	Release   *struct {
		Version                    string `json:"version"`
		BuildNumber                int64  `json:"buildNumber"`
		MinimumRuntimeHostProtocol int    `json:"minimumRuntimeHostProtocol,omitempty"`
		DownloadURL                string `json:"downloadURL"`
		Notes                      string `json:"notes,omitempty"`
		PublishedAt                string `json:"publishedAt,omitempty"`
	} `json:"release,omitempty"`
	CheckedAt  string `json:"checkedAt"`
	DurationMS int64  `json:"durationMs"`
}

// runUpdateCheckOnce performs one check without a window and writes its
// evidence. It exists for local acceptance of the check itself: a GUI probe
// would need a window and the single-instance lock. Development builds only, so
// a shipped client has no such switch.
func runUpdateCheckOnce(path string) int {
	if !mygo.IsDev() {
		fmt.Fprintln(os.Stderr, "updater: --check-update-once is a development-build flag")
		return 2
	}
	if path == "" {
		fmt.Fprintln(os.Stderr, "updater: --check-update-once needs an evidence path")
		return 2
	}
	evidence := updateCheckEvidence{GeneratedAt: time.Now().UTC().Format(time.RFC3339), DevBuild: mygo.IsDev(), Phase: "check-only"}
	current := currentAppVersion()
	evidence.Current.Version, evidence.Current.BuildNumber = current.version, current.build
	var result updateResult
	if !current.known() {
		result = updateResult{State: updateStateFailed, Current: current, Failure: updateFailureConfig, Message: updateUnknownVersionNotice, Reason: "unknown-version", CheckedAt: time.Now().UTC()}
	} else if config, err := resolveUpdateConfig(); err != nil {
		result = updateResult{State: updateStateFailed, Current: current, Failure: updateFailureConfig, Message: err.Error(), Reason: "config", CheckedAt: time.Now().UTC()}
	} else {
		evidence.Feed.URL, evidence.Feed.Source = config.feedURL, config.source
		evidence.Feed.PublicKey = base64.StdEncoding.EncodeToString(config.publicKey)
		ctx, cancel := context.WithTimeout(context.Background(), updateCheckTimeout)
		result = performUpdateCheck(ctx, config, current)
		cancel()
	}
	evidence.State, evidence.Failure, evidence.Reason = string(result.State), string(result.Failure), result.Reason
	evidence.Message, evidence.Channel, evidence.Releases, evidence.FeedBytes = result.Message, result.Channel, result.Releases, result.FeedBytes
	evidence.CheckedAt, evidence.DurationMS = result.CheckedAt.UTC().Format(time.RFC3339), result.Duration.Milliseconds()
	if result.Release != nil {
		evidence.Release = &struct {
			Version                    string `json:"version"`
			BuildNumber                int64  `json:"buildNumber"`
			MinimumRuntimeHostProtocol int    `json:"minimumRuntimeHostProtocol,omitempty"`
			DownloadURL                string `json:"downloadURL"`
			Notes                      string `json:"notes,omitempty"`
			PublishedAt                string `json:"publishedAt,omitempty"`
		}{result.Release.Version, result.Release.BuildNumber, result.Release.MinimumRuntimeHostProtocol, result.Release.DownloadURL, result.Release.Notes, result.Release.PublishedAt}
	}
	data, err := json.MarshalIndent(evidence, "", "  ")
	if err == nil {
		if directory := filepath.Dir(path); directory != "" {
			err = os.MkdirAll(directory, 0o755)
		}
		if err == nil {
			err = os.WriteFile(path, append(data, '\n'), 0o600)
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater: writing %s: %v\n", path, err)
		return 1
	}
	log.Printf("updater: check-update-once state=%s failure=%s release=%s reason=%s", evidence.State, emptyIfNone(evidence.Failure), releaseVersion(result.Release), emptyIfNone(evidence.Reason))
	return 0
}

func releaseVersion(release *updateRelease) string {
	if release == nil {
		return "-"
	}
	return release.Version
}

func emptyIfNone(value string) string {
	if value == "" {
		return "-"
	}
	return value
}
