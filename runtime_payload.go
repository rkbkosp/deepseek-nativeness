package main

// Local dsh runtime payload discovery.
//
// The payload is the official `dsh/` tree plus the interpreter bundle, copied
// out of the installed application by `scripts/vendor-runtime.mjs`. Nothing
// here modifies the payload: the sealed `desktop-runtime.json` inside the tree
// remains the integrity source of truth, and `manifest.json` records where the
// bytes came from.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const (
	runtimeEnvOverride = "NATIVE_DSH_RUNTIME"
	runtimeDescriptor  = "desktop-runtime.json"
	runtimeManifest    = "manifest.json"
)

// runtimeDescriptorFile is the sealed manifest the official Host validates
// before starting. Only the fields this client needs are decoded.
type runtimeDescriptorFile struct {
	SchemaVersion int    `json:"schemaVersion"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	Release       struct {
		SchemaVersion       int    `json:"schemaVersion"`
		Version             string `json:"version"`
		HostProtocolVersion int    `json:"hostProtocolVersion"`
		NodeVersion         string `json:"nodeVersion"`
		PnpmVersion         string `json:"pnpmVersion"`
	} `json:"release"`
	Files []struct {
		Path       string `json:"path"`
		Bytes      int64  `json:"bytes"`
		SHA256     string `json:"sha256"`
		Executable bool   `json:"executable"`
	} `json:"files"`
	SharedPackages []json.RawMessage `json:"sharedPackages"`
}

// runtimePayload is one resolved immutable runtime tree.
type runtimePayload struct {
	Root           string // <resources>/runtime
	Dsh            string // Root/dsh, passed to the Host as its runtime directory
	PrimaryRuntime string // Root/primary-runtime
	Node           string // interpreter used for the launcher and the Host
	NodeBin        string // directory holding the packaged node launchers
	Pnpm           string // pnpm.mjs used for plugin package operations
	Launcher       string // runtime/launcher.mjs

	Version      string
	HostProtocol int
	NodeVersion  string
	PnpmVersion  string
	Platform     string
	Arch         string
	Files        int
	Bytes        int64
	Shared       int

	// Vendor records provenance when the payload was copied out of an installed
	// application; it is absent for a hand-assembled development tree.
	VendorAsarSha256 string
	VendorApp        string
}

// String renders one line for the About panel and diagnostics.
func (p *runtimePayload) String() string {
	return fmt.Sprintf("dsh %s (host protocol %d) · node %s · pnpm %s · %d files · %s",
		p.Version, p.HostProtocol, p.NodeVersion, p.PnpmVersion, p.Files, humanBytes(p.Bytes))
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for rest := n / unit; rest >= unit; rest /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}

// resolveRuntimePayload finds the runtime tree for this launch.
//
// Order: an explicit override, the app bundle's Resources, then the development
// build directory next to the checkout. A missing payload is reported as a
// typed error so callers can keep the Remote client usable without it.
func resolveRuntimePayload() (*runtimePayload, error) {
	var roots []string
	if override := os.Getenv(runtimeEnvOverride); override != "" {
		roots = append(roots, override)
	}
	if executable, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Join(filepath.Dir(executable), "..", "Resources", "runtime"))
	}
	roots = append(roots, filepath.Join("build", "runtime"))
	var incomplete error
	for _, root := range roots {
		payload, err := loadRuntimePayload(root)
		if err == nil {
			return payload, nil
		}
		if errors.Is(err, errRuntimeIncomplete) {
			incomplete = err
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	if incomplete != nil {
		return nil, incomplete
	}
	return nil, fmt.Errorf("本地运行时未安装（查找过 %v）", roots)
}

// errRuntimeIncomplete marks a directory that exists but is missing parts; the
// resolver keeps looking instead of failing hard on a stale development tree.
var errRuntimeIncomplete = errors.New("运行时载荷不完整")

// loadRuntimePayload validates one candidate runtime root.
func loadRuntimePayload(root string) (*runtimePayload, error) {
	root = filepath.Clean(root)
	dsh := filepath.Join(root, "dsh")
	descriptorRaw, err := os.ReadFile(filepath.Join(dsh, runtimeDescriptor))
	if err != nil {
		return nil, err
	}
	var descriptor runtimeDescriptorFile
	if err := json.Unmarshal(descriptorRaw, &descriptor); err != nil {
		return nil, fmt.Errorf("运行时描述文件损坏：%w", err)
	}
	if descriptor.SchemaVersion != 1 {
		return nil, fmt.Errorf("不支持的运行时描述版本 %d", descriptor.SchemaVersion)
	}
	if descriptor.Platform != runtime.GOOS || descriptor.Arch != runtime.GOARCH {
		return nil, fmt.Errorf("运行时平台不匹配：需要 %s/%s，实际 %s/%s",
			runtime.GOOS, runtime.GOARCH, descriptor.Platform, descriptor.Arch)
	}

	payload := &runtimePayload{
		Root:           root,
		Dsh:            dsh,
		PrimaryRuntime: filepath.Join(root, "primary-runtime"),
		Node:           filepath.Join(root, "primary-runtime", "dependencies", "node", "bin", "node"),
		NodeBin:        filepath.Join(root, "bin"), // node launchers packaged beside the payload
		Pnpm:           filepath.Join(root, "primary-runtime", "dependencies", "pnpm", "bin", "pnpm.mjs"),
		Launcher:       launcherPath(root),
		Version:        descriptor.Release.Version,
		HostProtocol:   descriptor.Release.HostProtocolVersion,
		NodeVersion:    descriptor.Release.NodeVersion,
		PnpmVersion:    descriptor.Release.PnpmVersion,
		Platform:       descriptor.Platform,
		Arch:           descriptor.Arch,
		Files:          len(descriptor.Files),
		Shared:         len(descriptor.SharedPackages),
	}
	for _, file := range descriptor.Files {
		payload.Bytes += file.Bytes
	}
	for _, required := range []struct{ path, what string }{
		{payload.Node, "Node 解释器"},
		{payload.NodeBin, "node 启动器目录"},
		{payload.Pnpm, "pnpm"},
		{payload.Launcher, "启动器"},
		{filepath.Join(dsh, "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "index.js"), "Host 入口"},
	} {
		if _, err := os.Stat(required.path); err != nil {
			return nil, fmt.Errorf("%w: 缺少%s（%s）", errRuntimeIncomplete, required.what, required.path)
		}
	}

	// Provenance is optional: it is written by the vendoring script only.
	if raw, err := os.ReadFile(filepath.Join(root, runtimeManifest)); err == nil {
		var manifest struct {
			Source struct {
				App       string `json:"app"`
				AsarSha256 string `json:"asarSha256"`
			} `json:"source"`
		}
		if json.Unmarshal(raw, &manifest) == nil {
			payload.VendorApp = manifest.Source.App
			payload.VendorAsarSha256 = manifest.Source.AsarSha256
		}
	}
	return payload, nil
}

// runtimeHome is the Harness home the Host will use: the shared ~/.dsh unless
// an environment override asks for another one. The profile name is not
// configurable here because this client deliberately reuses `desktop`.
func runtimeHome() (string, error) {
	if home := os.Getenv("DSH_HOME"); home != "" {
		return home, nil
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ".dsh"), nil
}

// inheritedEnvironment drops the variables this process only holds because it
// is itself running inside a Harness session. Leaking them into the local Host
// would point it at another session's identity or profile.
func inheritedEnvironment() []string {
	drop := map[string]bool{
		"DSH_SESSION_ID":       true,
		"DSH_SHELL":            true,
		"DSH_WEB_URL":          true,
		"DSH_PROFILE":          true,
		"DSH_PROFILE_DIR":      true,
		"DSH_NODE_EXECUTABLE":  true,
		"DSH_INSTALL_DIR":      true,
		"ELECTRON_RUN_AS_NODE": true,
	}
	environment := os.Environ()
	kept := environment[:0]
	for _, entry := range environment {
		name := entry
		for index := 0; index < len(entry); index++ {
			if entry[index] == '=' {
				name = entry[:index]
				break
			}
		}
		if drop[name] {
			continue
		}
		kept = append(kept, entry)
	}
	return kept
}

// launcherPath finds the launcher inside the payload, falling back to this
// checkout's own copy so a development payload vendored before the launcher was
// staged still works.
func launcherPath(root string) string {
	staged := filepath.Join(root, "launcher.mjs")
	if _, err := os.Stat(staged); err == nil {
		return staged
	}
	if cwd, err := os.Getwd(); err == nil {
		local := filepath.Join(cwd, "runtime", "launcher.mjs")
		if _, statErr := os.Stat(local); statErr == nil {
			return local
		}
	}
	return staged
}
