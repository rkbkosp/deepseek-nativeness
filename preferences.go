package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func preferencePath() string {
	root, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(root, "Native DSH Remote", "preferences.json")
}
func (a *app) loadPreferences() {
	data, err := os.ReadFile(preferencePath())
	if err != nil {
		return
	}
	var p struct {
		ServerURL  string                    `json:"serverUrl"`
		UI         viewPreferences           `json:"ui"`
		Selections map[string]savedSelection `json:"selections,omitempty"`
	}
	p.UI = defaultViewPreferences()
	if json.Unmarshal(data, &p) != nil {
		return
	}
	a.uiPrefs = p.UI
	a.savedSelections = p.Selections
	if a.uiPrefs.FontSize < 10 || a.uiPrefs.FontSize > 22 {
		a.uiPrefs.FontSize = 14
	}
	if a.uiPrefs.Expanded == nil {
		a.uiPrefs.Expanded = map[string]bool{}
	}
	if strings.HasPrefix(p.ServerURL, "https://") {
		a.server = p.ServerURL
		a.webURL = strings.TrimRight(p.ServerURL, "/") + "/app"
	}
}
func (a *app) savePreferences() {
	path := preferencePath()
	if path == "" || a.demo {
		return
	}
	data, err := json.MarshalIndent(struct {
		ServerURL  string                    `json:"serverUrl"`
		UI         viewPreferences           `json:"ui"`
		Selections map[string]savedSelection `json:"selections,omitempty"`
	}{a.server, a.uiPrefs, a.savedSelections}, "", "  ")
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0700) != nil {
		return
	}
	tmp := path + ".tmp"
	if os.WriteFile(tmp, data, 0600) == nil {
		_ = os.Rename(tmp, path)
	}
}
func (a *app) configure(after func()) {
	server := a.server
	a.request("configure", map[string]any{"serverUrl": server}, func(raw json.RawMessage) error {
		a.configuredServer = server
		a.savePreferences()
		var state struct {
			Authorized bool `json:"authorized"`
		}
		if json.Unmarshal(raw, &state) == nil && !state.Authorized {
			a.connectionOpen = true
		}
		if err := a.acceptStatus(raw); err != nil {
			return err
		}
		if after != nil {
			after()
		}
		return nil
	})
}
func (a *app) login() {
	email, password := a.account, a.password
	a.password = ""
	login := func() {
		a.request("login", map[string]any{"email": email, "password": password}, func(raw json.RawMessage) error {
			var state struct {
				Authorized bool `json:"authorized"`
			}
			if err := json.Unmarshal(raw, &state); err != nil {
				return err
			}
			a.authorized = state.Authorized
			if err := a.acceptStatus(raw); err != nil {
				return err
			}
			a.status = "已登录，选择工作主机"
			a.fetchDevices()
			return nil
		})
	}
	if a.configuredServer != a.server {
		a.configure(login)
	} else {
		login()
	}
}
