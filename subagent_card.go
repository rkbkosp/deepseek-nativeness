package main

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/egoist/mygo/ui"
)

// The subagent tool card, mirroring ui-tool's `subagentDetails`: the activation
// receipt (name, child Session id), the task description and the prompt, plus a
// way into the child Session. Recorded results without the structured receipt
// still parse the historical "started subagent <id>" line.

// subagentActivationMeta is the `meta` a subagent activation stores on the tool
// call. Other tools' meta never reaches this card.
type subagentActivationMeta struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	SubagentID string `json:"subagentId"`
}

// subagentStartedText matches the receipt text older Sessions recorded instead
// of structured meta (the original falls back for the same reason).
var subagentStartedText = regexp.MustCompile(`^started (?:background subagent job|subagent) (\S+)$`)

// subagentActivation resolves the child Session id and the agent name of one
// subagent call, preferring the structured receipt.
func subagentActivation(t *toolNode, text string) (name, id string) {
	if t == nil {
		return "", ""
	}
	if len(t.Meta) > 0 {
		var meta subagentActivationMeta
		if json.Unmarshal(t.Meta, &meta) == nil && meta.Kind == "activation" {
			name = strings.TrimSpace(meta.Name)
			id = strings.TrimSpace(meta.SubagentID)
			if name != "" || id != "" {
				return name, id
			}
		}
	}
	if match := subagentStartedText.FindStringSubmatch(strings.TrimSpace(text)); match != nil {
		return "", match[1]
	}
	return "", ""
}

// subagentFieldRow draws one receipt field; an empty value draws nothing so a
// historical record does not show blank labels.
func (a *app) subagentFieldRow(c *ui.Context, label, value string) {
	value = maskSecrets(strings.TrimSpace(value))
	if value == "" {
		return
	}
	ui.Row(c).FillWidth().MinWidth(0).Gap(14).AlignItems(ui.Start).Children(func() {
		ui.Text(c, label).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(a.colors.Caption).Shrink(0).MinWidth(80)
		ui.Text(c, value).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap().Selectable().MinWidth(0).Shrink(1)
	})
}

// subagentToolBody renders the card and reports whether it drew anything; the
// caller then skips the generic argument/output body.
func (a *app) subagentToolBody(c *ui.Context, m *message, key string) bool {
	t := m.Tool
	if t == nil {
		return false
	}
	name, id := subagentActivation(t, m.Text)
	args := parseToolArgs(t.ArgsRaw)
	description := strings.TrimSpace(stringArg(args, "description"))
	prompt := stringArg(args, "prompt")
	output := strings.TrimSpace(m.Text)
	reply := ""
	if id == "" && output != "" && !subagentStartedText.MatchString(output) {
		// No receipt: the recorded result is the child's reply itself.
		reply = output
	}
	if name == "" && id == "" && description == "" && prompt == "" && reply == "" {
		return false
	}
	// A receipt names the child; a historical answer without one is not a
	// start, so it only shows the reply.
	receipt := id != "" || name != ""
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(12, 16).Gap(8).Children(func() {
		if receipt {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Text(c, "已启动").FontSize(12).FontWeight(500).FixedLineHeight(18).TextColor(a.colors.Secondary)
				ui.Spacer(c)
				if id != "" {
					open := ui.ButtonBase(c).Label("打开子会话").Height(22).Padding(0, 6).Gap(4).Radius(6)
					open.Children(func() {
						icon(c, "chevron-right-outline", 12).TextColor(a.colors.Link)
						ui.Text(c, "打开子会话").FontSize(12).TextColor(a.colors.Link)
					})
					if open.Clicked() {
						if a.subagentTitles == nil {
							a.subagentTitles = map[string]string{}
						}
						if name != "" {
							a.subagentTitles[id] = name
						}
						a.openSession(id)
					}
				}
			})
		}
		a.subagentFieldRow(c, "智能体名称", name)
		a.subagentFieldRow(c, "ID", id)
		a.subagentFieldRow(c, "智能体任务描述", description)
		if prompt != "" {
			ui.Text(c, "任务内容").Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(a.colors.Caption)
			ui.Scroll(c).MaxHeight(180).Children(func() {
				ui.Text(c, maskSecrets(prompt)).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap().Selectable()
			})
		}
		if reply != "" {
			ui.Text(c, "回复").Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(a.colors.Caption)
			ui.Scroll(c).MaxHeight(180).Children(func() {
				ui.Text(c, maskSecrets(reply)).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap().Selectable()
			})
		}
	})
	return true
}
