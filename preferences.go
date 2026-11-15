package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// preferencePath keeps the original client-state directory on purpose: the
// product was renamed (productName), but an existing install must keep its
// stored server, selections and appearance. Moving this path is a migration.
func preferencePath() string {
	root, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(root, "Native DSH Remote", "preferences.json")
}
func (a *app) loadPreferences() {
	if a.demo {
		return
	}
	a.loadPreferencesFrom(preferencePath())
}
func (a *app) loadPreferencesFrom(path string) {
	if a.demo {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var p struct {
		ServerURL  string                    `json:"serverUrl"`
		UI         viewPreferences           `json:"ui"`
		Selections map[string]savedSelection `json:"selections,omitempty"`
		// Update is the updater's own section: the feed override and the last
		// check. Absent in files written before M7a.
		Update *updatePreferenceState `json:"update,omitempty"`
	}
	p.UI = defaultViewPreferences()
	if json.Unmarshal(data, &p) != nil {
		return
	}
	a.uiPrefs = p.UI
	a.savedSelections = p.Selections
	if p.Update != nil {
		updatePrefs = *p.Update
		updatePrefs.normalize()
	} else {
		updatePrefs = updatePreferenceState{}
	}
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
	if a.demo {
		return
	}
	a.savePreferencesTo(preferencePath())
}
func (a *app) savePreferencesTo(path string) {
	if path == "" || a.demo {
		return
	}
	update := updatePrefs
	var updateField *updatePreferenceState
	if !update.empty() {
		updateField = &update
	}
	data, err := json.MarshalIndent(struct {
		ServerURL  string                    `json:"serverUrl"`
		UI         viewPreferences           `json:"ui"`
		Selections map[string]savedSelection `json:"selections,omitempty"`
		Update     *updatePreferenceState    `json:"update,omitempty"`
	}{a.server, a.uiPrefs, a.savedSelections, updateField}, "", "  ")
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
		if a.statusResponseStale(raw) {
			return nil
		}
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
			if a.statusResponseStale(raw) {
				return nil
			}
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
