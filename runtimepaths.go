package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

func resolveHelper(explicit string) string {
	if explicit != "" {
		path, err := filepath.Abs(explicit)
		if err == nil {
			return path
		}
		return explicit
	}
	if bin, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(bin), "..", "Resources", "remote", "bridge.mjs")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate)
		}
	}
	path, _ := filepath.Abs("remote/bridge.mjs")
	return path
}

// resolveLocalHelper locates the native helper that carries the UI to a Host
// this process started. It is packaged beside the Remote helper but has no
// server, identity or WebRTC dependencies.
func resolveLocalHelper() (string, error) {
	if bin, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(bin), "..", "Resources", "remote", "local-bridge.mjs")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Clean(candidate), nil
		}
	}
	path, err := filepath.Abs("remote/local-bridge.mjs")
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func nodeExecutable() string {
	if bin, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(bin), "node")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	if path, err := exec.LookPath("node"); err == nil {
		return path
	}
	return "node"
}
