package main

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// heroPresetHint is the seat's title when a preset publishes no description,
// matching the original chip's `seatHint` copy.
const heroPresetHint = "选择新任务使用的 Agent 预设"

// heroPresetEntry is one roster row the new-session chip can stage. Name and
// Description are already resolved display copy: the Host publishes them for
// custom presets, while the shipped ones fall back to the built-in dictionary
// the header label also uses.
type heroPresetEntry struct {
	ID          string
	Name        string
	Description string
	Default     bool
	Broken      string
}

type heroPresetRoster struct {
	Presets []struct {
		ID          string `json:"id"`
		IsDefault   bool   `json:"isDefault"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Broken      string `json:"broken"`
	} `json:"presets"`
}

// builtinPresetOrder is the shipped roster order (agent-preset `order`).
var builtinPresetOrder = []string{"standard", "ptc", "minimal", "cordis"}

// heroPresetReadGeneration holds the roster for one Host generation. A reply
// for another generation is dropped instead of displaying stale names.
func (a *app) heroPresetRead() {
	client, host, generation := a.client, a.hostID, a.remoteGeneration
	if client == nil {
		return
	}
	params := map[string]any{"clientScope": map[string]any{"hostId": host, "generation": generation}}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "listAgentPresets", params)
		a.update(func() {
			if a.client != client || a.hostID != host || a.remoteGeneration != generation {
				return
			}
			a.heroPresetsLoading = false
			if err != nil {
				// The chip keeps the built-in names so the failure only shows
				// when a choice cannot be written.
				a.error = "读取 Agent 预设失败：" + err.Error()
				return
			}
			var roster heroPresetRoster
			if err := json.Unmarshal(raw, &roster); err != nil {
				a.error = "Agent 预设目录无法解析：" + err.Error()
				return
			}
			a.heroPresets = make([]heroPresetEntry, 0, len(roster.Presets))
			for _, row := range roster.Presets {
				if row.ID == "" {
					continue
				}
				name, description := row.Name, row.Description
				if builtin, shipped := presetHeaderBuiltins[row.ID]; shipped {
					if name == "" {
						name = builtin[0]
					}
					if description == "" {
						description = builtin[1]
					}
				}
				if name == "" {
					name = row.ID
				}
				a.heroPresets = append(a.heroPresets, heroPresetEntry{
					ID: row.ID, Name: name, Description: description,
					Default: row.IsDefault, Broken: strings.TrimSpace(row.Broken),
				})
			}
			a.heroPresetsLoaded = true
		})
	}()
}

// ensureHeroPresets reads the roster once per Host generation. Reads are
// skipped while the client is busy so the seat never competes with a write the
// user just started; the next frame retries.
func (a *app) ensureHeroPresets() {
	if a.demo || !a.connected || a.client == nil {
		return
	}
	if a.heroPresetsHost != a.hostID || a.heroPresetsGen != a.remoteGeneration {
		a.heroPresetsHost, a.heroPresetsGen = a.hostID, a.remoteGeneration
		a.heroPresets = nil
		a.heroPresetStaged = ""
		a.heroPresetsLoaded = false
		a.heroPresetsLoading = false
		a.heroPresetsAsked = false
	}
	if a.heroPresetsAsked || a.heroPresetsLoading || !a.can("listAgentPresets") {
		return
	}
	a.heroPresetsAsked = true
	a.heroPresetsLoading = true
	a.heroPresetRead()
}

// heroPresetEntries is the menu roster. An empty answer from a loaded roster
// means the deployment composes no presets at all, so the chip disappears
// instead of inventing built-ins; before the first answer the built-in names
// stand in so the row does not pop in late.
func (a *app) heroPresetEntries() []heroPresetEntry {
	if a.heroPresetsLoaded {
		return a.heroPresets
	}
	entries := make([]heroPresetEntry, 0, len(builtinPresetOrder))
	for index, id := range builtinPresetOrder {
		builtin := presetHeaderBuiltins[id]
		entries = append(entries, heroPresetEntry{
			ID: id, Name: builtin[0], Description: builtin[1], Default: index == 0,
		})
	}
	return entries
}

// heroPresetCurrent resolves the chip's preset: the staged pick, else the
// blank Session's recorded composition, else the Host-effective default.
func (a *app) heroPresetCurrent(entries []heroPresetEntry) string {
	if a.heroPresetStaged != "" {
		return a.heroPresetStaged
	}
	if s := a.composer; a.composerCurrent(s) && s.values.AgentPreset != nil && *s.values.AgentPreset != "" {
		return *s.values.AgentPreset
	}
	for _, entry := range entries {
		if entry.Default {
			return entry.ID
		}
	}
	if len(entries) > 0 {
		return entries[0].ID
	}
	return ""
}

// heroPresetLabel resolves display copy for one id, so a recorded preset the
// roster no longer carries still reads as something other than its id.
func heroPresetLabel(entries []heroPresetEntry, id string) (name, description string, found bool) {
	for _, entry := range entries {
		if entry.ID == id {
			return entry.Name, entry.Description, true
		}
	}
	if builtin, shipped := presetHeaderBuiltins[id]; shipped {
		return builtin[0], builtin[1], true
	}
	return id, "", id != ""
}

// heroPresetChip draws the new-session preset seat beside the Workspace picker.
// It is a real switch here and a passive label in the session header: a
// session's composition is fixed once its conversation starts.
func (a *app) heroPresetChip(c *ui.Context) {
	entries := a.heroPresetEntries()
	if len(entries) == 0 {
		return
	}
	current := a.heroPresetCurrent(entries)
	name, description, found := heroPresetLabel(entries, current)
	if !found || name == "" {
		return
	}
	if description == "" {
		description = heroPresetHint
	}
	// Busy is not a lock: the roster's own read sets it, and a chip that
	// grays out while the list loads would flicker on every frame. Only a Host
	// that does not grant the write disables the seat.
	locked := a.sessionID != "" && (!a.connected || !a.operationCaps["selectAgentPreset"].Supported)
	chip := ui.ButtonBase(c).Label(name).Height(28).MinWidth(0).MaxWidth(240).Shrink(1).Padding(0, 8).Gap(4).Radius(8).Tooltip(description)
	chip.Disabled(locked)
	chip.Children(func() {
		icon(c, "agent-preset-outline", 16).Shrink(0).TextColor(a.theme.Text)
		ui.Text(c, name).FontSize(13).FontWeight(500).MinWidth(0).Shrink(1).SingleLine().Ellipsis("…").TextColor(a.theme.Text)
		icon(c, "chevron-down-outline", 12).Shrink(0).TextColor(a.theme.TextMuted)
	})
	if chip.Hovered() && !locked {
		chip.Background(a.colors.RowHover)
	}
	chip.Menu(func(m *ui.Menu) { a.heroPresetMenu(c, m, entries, current) })
}

// heroPresetMenu lists every preset with its description, marking the staged
// choice. Broken declarations stay visible but cannot be chosen.
func (a *app) heroPresetMenu(c *ui.Context, m *ui.Menu, entries []heroPresetEntry, current string) {
	selectable := a.sessionID == "" || a.operationCaps["selectAgentPreset"].Supported
	for _, entry := range entries {
		item := m.Item(entry.Name).Radio(entry.ID == current)
		if entry.Description != "" {
			item.Subtitle(entry.Description)
		}
		switch {
		case entry.Broken != "":
			item.Disabled(true).Tooltip(entry.Broken)
		case !selectable:
			item.Disabled(true).Tooltip(a.actionBlockedDetail("selectAgentPreset", "当前连接不允许切换 Agent 预设。"))
		case item.Chosen():
			a.chooseHeroPreset(entry.ID)
		}
	}
}

// chooseHeroPreset stages a pick before a Session exists and applies it to a
// blank one immediately. A started Session keeps the composition it began with,
// so the Host's refusal is reported rather than retried here.
func (a *app) chooseHeroPreset(id string) {
	if id == "" {
		return
	}
	if a.sessionID == "" {
		a.heroPresetStaged = id
		return
	}
	if !a.connected || !a.operationCaps["selectAgentPreset"].Supported {
		a.error = "当前连接不允许切换 Agent 预设。"
		return
	}
	a.heroPresetStaged = ""
	a.selectAgentPreset(id)
}

// selectAgentPreset writes one preset onto the current Session and re-reads the
// projections that label it, so the header and the chip agree immediately.
func (a *app) selectAgentPreset(id string) {
	if id == "" || a.sessionID == "" {
		return
	}
	sessionID := a.sessionID
	a.mutate("selectAgentPreset", map[string]any{"sessionId": sessionID, "agentPreset": id}, func(json.RawMessage) error {
		if a.sessionID != sessionID {
			return nil
		}
		if s := a.composer; a.composerCurrent(s) {
			// Show the pick at once; the projection read below confirms it.
			if s.values.AgentPreset != nil {
				*s.values.AgentPreset = id
				s.refreshLabels()
			}
			a.composerRead(s, "sessionProjections", nil, a.acceptComposerProjections)
		}
		return nil
	})
}

// applyStagedHeroPreset hands a staged choice to the Session that just became
// current, but only while it is still blank. A started Session drops the stage,
// exactly as the original chip does once the flow has moved past the hero.
func (a *app) applyStagedHeroPreset(s *composerState) {
	id := a.heroPresetStaged
	if id == "" || !a.composerCurrent(s) || s.values.AgentPreset == nil {
		return
	}
	if *s.values.AgentPreset == id {
		a.heroPresetStaged = ""
		return
	}
	if a.current.Running || len(a.current.Messages) > 0 {
		a.heroPresetStaged = ""
		return
	}
	if !a.connected || !a.operationCaps["selectAgentPreset"].Supported {
		// Keep the stage: another connection generation may grant it.
		return
	}
	a.heroPresetStaged = ""
	a.selectAgentPreset(id)
}
