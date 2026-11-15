package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

func execNode() (string, error) {
	if p, e := exec.LookPath("node"); e == nil {
		return p, nil
	}
	for _, p := range []string{"/opt/homebrew/bin/node", "/usr/local/bin/node"} {
		if _, e := os.Stat(p); e == nil {
			return p, nil
		}
	}
	home, _ := os.UserHomeDir()
	paths, _ := filepath.Glob(filepath.Join(home, ".nvm/versions/node/*/bin/node"))
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))
	for _, p := range paths {
		if _, e := os.Stat(p); e == nil {
			return p, nil
		}
	}
	return "", exec.ErrNotFound
}
