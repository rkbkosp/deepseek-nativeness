package main

import (
	"encoding/json"
	"strings"

	"github.com/egoist/mygo/ui"
)

type commandOutcome struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type commandLifecycle struct {
	CommandID string          `json:"commandId"`
	Name      string          `json:"name"`
	Args      json.RawMessage `json:"args"`
	Outcome   *commandOutcome `json:"outcome"`
}

func parseCommand(raw json.RawMessage) (commandLifecycle, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return commandLifecycle{}, false
	}
	var command commandLifecycle
	if json.Unmarshal(raw, &command) != nil {
		return commandLifecycle{}, false
	}
	return command, command.Name != "" || command.Outcome != nil || command.CommandID != ""
}

func commandSummary(command commandLifecycle) string {
	if command.Outcome == nil {
		return "执行中…"
	}
	text := strings.TrimSpace(command.Outcome.Text)
	if text == "" {
		if command.Outcome.Kind == "error" {
			return "指令失败"
		}
		return "已完成"
	}
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		text = text[:i]
	}
	return text
}

func (a *app) commandView(c *ui.Context, m *message, key string) {
	command, ok := parseCommand(m.Command)
	if !ok {
		// A malformed command still has transcript text; keep it readable.
		if m.Text != "" {
			a.disclosureRow(c, key, "api-outline", "指令", "", a.foldState("command:"+key, false), false, false, 4, func() {
				ui.Text(c, m.Text).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(a.colors.Secondary).Wrap().Selectable()
			})
		}
		return
	}
	title := command.Name
	if title == "" {
		title = "指令"
	}
	summary := commandSummary(command)
	stateError := command.Outcome != nil && command.Outcome.Kind == "error"
	open := a.foldState("command:"+key, false)
	var body func()
	if command.Outcome != nil && strings.Contains(command.Outcome.Text, "\n") {
		body = func() {
			ui.Column(c).FillWidth().MinWidth(0).Clip().Radius(16).Background(a.colors.CodeBlock).Padding(12, 16).Children(func() {
				color := a.colors.Secondary
				if stateError {
					color = a.theme.Danger
				}
				ui.Text(c, command.Outcome.Text).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(color).Wrap().Selectable()
			})
		}
	}
	a.disclosureRow(c, key, "api-outline", title, summary, open, false, stateError, 4, body)
}
