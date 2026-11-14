package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"native-dsh/desktop/internal/bridge"
	"strings"
	"time"
	"unicode"
)

// composerState is scoped to one captured Host generation and conversation.
// The authoritative catalogs/projections are read separately from chat history.
type composerState struct {
	hostID, sessionID                         string
	accountScope                              string
	generation                                uint64
	composing                                 bool
	repeatKey                                 bool
	modelLabel, permissionLabel, presetLabel  string
	modelName, modelEffort                    string
	modelCompact                              bool
	controlsGeometrySignature                 string
	catalog                                   composerModelCatalog
	values                                    composerProjectionValues
	permissions                               []settingsPermissionOption
	commands                                  []composerCommand
	completions                               []composerCompletion
	completionToken                           string
	completionStart, completionEnd, highlight int
	queryGeneration                           uint64
	dismissedToken                            string
	queueExpanded                             bool
	editingID, editingText                    string
	confirmPermission                         string
	permissionAcknowledged                    bool
	error                                     string
	caret                                     int
	projectionSeq                             int64
	pendingReplacement                        *composerReplacement
	presets                                   []composerPreset
	presetsLoading                            bool
	readGeneration                            uint64
}
type composerPreset struct {
	ID   string  `json:"id"`
	Name *string `json:"name"`
}
type composerReplacement struct {
	Before, Text      string
	Start, End, Caret int
}

type composerModelSelection struct {
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
}
type composerModelCatalog struct {
	Default composerModelSelection `json:"default"`
	Groups  []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Models []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Reasoning *struct {
				DefaultEffort string                      `json:"defaultEffort"`
				Efforts       []struct{ ID, Name string } `json:"efforts"`
			} `json:"reasoning"`
		} `json:"models"`
	} `json:"groups"`
}
type composerCommand struct {
	DefinitionID string          `json:"definitionId"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Input        json.RawMessage `json:"input"`
	Unavailable  string          `json:"clientUnavailableReason"`
}
type composerQueueItem struct {
	ID      string `json:"id"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Source json.RawMessage `json:"source"`
}
type composerProjectionValues struct {
	AgentPreset    *string                         `json:"agentPreset"`
	Plan           *struct{ Active, Pending bool } `json:"plan"`
	ModelSelection struct {
		Next     *composerModelSelection `json:"next"`
		LastUsed *composerModelSelection `json:"lastUsed"`
	} `json:"modelSelection"`
	Permissions *struct {
		CurrentValue string `json:"currentValue"`
	} `json:"permissions"`
	Inbox map[string][]composerQueueItem `json:"inbox"`
}
type composerCompletion struct{ Label, Description, Replacement, Kind, Unavailable string }

func (a *app) reloadComposer() {
	if !a.composerCurrent(a.composer) {
		a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, accountScope: a.accountScope, generation: a.remoteGeneration}
	}
	s := a.composer
	s.readGeneration++
	s.error = ""
	s.presetsLoading = false
	if len(a.current.Projections) > 0 {
		_ = a.acceptComposerProjections(a.current.Projections)
	}
	if !a.connected || a.client == nil || a.sessionID == "" || a.demo {
		return
	}
	a.composerRead(s, "sessionProjections", nil, func(raw json.RawMessage) error { return a.acceptComposerProjections(raw) })
	a.composerRead(s, "modelCatalog", nil, func(raw json.RawMessage) error {
		if err := json.Unmarshal(raw, &s.catalog); err != nil {
			return err
		}
		s.refreshLabels()
		return nil
	})
	a.composerRead(s, "permissionCatalog", nil, func(raw json.RawMessage) error {
		var v struct {
			Options []settingsPermissionOption `json:"options"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			return err
		}
		s.permissions = v.Options
		s.refreshLabels()
		return nil
	})
	a.composerRead(s, "listCommands", nil, func(raw json.RawMessage) error {
		var err error
		s.commands, err = decodeRows[composerCommand](raw, "commands", "items")
		for i := range s.commands {
			if reason := composerCommandBoundary("/" + s.commands[i].Name); reason != "" && s.commands[i].Name != "permission" {
				s.commands[i].Unavailable = reason
			}
		}
		s.completionToken = ""
		return err
	})
}
func (a *app) composerCurrent(s *composerState) bool {
	return s != nil && a.composer == s && s.hostID == a.hostID && s.sessionID == a.sessionID && s.accountScope == a.accountScope && s.generation == a.remoteGeneration
}
func (a *app) composerRead(s *composerState, method string, extra map[string]any, accept func(json.RawMessage) error) {
	if !a.composerCurrent(s) || a.client == nil || !a.connected {
		return
	}
	client := a.client
	readGeneration := s.readGeneration
	params := map[string]any{"sessionId": s.sessionID, "clientScope": map[string]any{"hostId": s.hostID, "generation": s.generation, "sessionId": s.sessionID}}
	for k, v := range extra {
		params[k] = v
	}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, method, params)
		a.update(func() {
			if !a.composerCurrent(s) || a.client != client || readGeneration != s.readGeneration {
				return
			}
			if err == nil && accept != nil {
				err = accept(raw)
			}
			if err != nil {
				s.error = err.Error()
			}
		})
	}()
}

// The helper supplies authoritative session/control projections, never values
// inferred from transcript text. Missing fields keep the last published value.
func (a *app) acceptComposerProjections(raw json.RawMessage) error {
	s := a.composer
	if !a.composerCurrent(s) {
		return nil
	}
	var envelope struct {
		Values  json.RawMessage `json:"values"`
		AsOfSeq int64           `json:"asOfSeq"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if len(envelope.Values) > 0 {
		if envelope.AsOfSeq < s.projectionSeq {
			return nil
		}
		s.projectionSeq = envelope.AsOfSeq
		raw = envelope.Values
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return err
	}
	for key, v := range values {
		switch key {
		case "modelSelection":
			var selection composerProjectionValues
			if err := json.Unmarshal(v, &selection.ModelSelection); err != nil {
				return err
			}
			s.values.ModelSelection = selection.ModelSelection
		case "permissions":
			if err := json.Unmarshal(v, &s.values.Permissions); err != nil {
				return err
			}
		case "inbox":
			var inbox map[string][]composerQueueItem
			if err := json.Unmarshal(v, &inbox); err != nil {
				return err
			}
			s.values.Inbox = inbox
		case "agentPreset":
			if err := json.Unmarshal(v, &s.values.AgentPreset); err != nil {
				return err
			}
		case "plan":
			if err := json.Unmarshal(v, &s.values.Plan); err != nil {
				return err
			}
		}
	}
	s.refreshLabels()
	if s.values.AgentPreset != nil && len(s.presets) == 0 && !s.presetsLoading && a.connected && a.client != nil {
		s.presetsLoading = true
		a.composerRead(s, "listAgentPresets", nil, func(raw json.RawMessage) error {
			var roster struct {
				Presets []composerPreset `json:"presets"`
			}
			s.presetsLoading = false
			if err := json.Unmarshal(raw, &roster); err != nil {
				return err
			}
			s.presets = roster.Presets
			s.refreshLabels()
			return nil
		})
	}
	return nil
}
func (s *composerState) refreshLabels() {
	s.presetLabel = ""
	if s.values.AgentPreset != nil {
		s.presetLabel = *s.values.AgentPreset
		for _, p := range s.presets {
			if p.ID != *s.values.AgentPreset {
				continue
			}
			if p.Name != nil {
				s.presetLabel = *p.Name
			} else {
				if label := map[string]string{"standard": "标准模式", "ptc": "PTC 模式", "minimal": "极简模式", "cordis": "创造模式"}[p.ID]; label != "" {
					s.presetLabel = label
				}
			}
			break
		}
	}
	selected := s.catalog.Default
	if s.values.ModelSelection.Next != nil {
		selected = *s.values.ModelSelection.Next
	}
	s.modelName = "选择模型"
	s.modelEffort = ""
	for _, g := range s.catalog.Groups {
		if g.ID != selected.Provider {
			continue
		}
		for _, m := range g.Models {
			if m.ID != selected.Model {
				continue
			}
			s.modelName = m.Name
			if m.Reasoning != nil {
				effort := selected.ReasoningEffort
				if effort == "" {
					effort = m.Reasoning.DefaultEffort
				}
				label := effort
				if effort == "" {
					label = "Default"
				}
				for _, e := range m.Reasoning.Efforts {
					if e.ID == effort {
						label = e.Name
						break
					}
				}
				s.modelEffort = label
			} else if selected.ReasoningEffort != "" {
				s.modelEffort = selected.ReasoningEffort
			}
		}
	}
	s.modelLabel = s.modelName
	if s.modelEffort != "" {
		s.modelLabel += " " + s.modelEffort
	}
	s.permissionLabel = ""
	if s.values.Permissions != nil {
		value := s.values.Permissions.CurrentValue
		s.permissionLabel = value
		for _, p := range s.permissions {
			if p.Value == value {
				s.permissionLabel = permissionDisplay(p)
				break
			}
		}
	}
}
func permissionDisplay(p settingsPermissionOption) string {
	if p.Value == "auto" {
		return "自动审查"
	}
	if p.Name == p.Value || p.Name == map[string]string{"read-only": "Read Only", "workspace-write": "Workspace Write", "danger-full-access": "Full Access"}[p.Value] {
		switch p.Value {
		case "read-only":
			return "仅可查看"
		case "workspace-write":
			return "工作区内修改"
		case "danger-full-access":
			return "完全权限"
		}
	}
	if p.Name != "" {
		return p.Name
	}
	return p.Value
}
func composerSubmitMode(preferred string, running, accelerated bool) string {
	if !running {
		return "queue"
	}
	if preferred != "steer" {
		preferred = "queue"
	}
	if accelerated {
		if preferred == "queue" {
			return "steer"
		}
		return "queue"
	}
	return preferred
}
func queueText(row composerQueueItem) (string, bool) {
	parts := []string{}
	for _, p := range row.Content {
		if p.Type != "text" {
			return "", false
		}
		parts = append(parts, p.Text)
	}
	return strings.Join(parts, ""), true
}
func (a *app) composerCommand(line string, done func()) {
	s := a.composer
	if !a.composerCurrent(s) || !a.can("executeCommand") {
		return
	}
	if reason := composerCommandBoundary(line); reason != "" {
		s.error = reason
		return
	}
	a.composerCommandMutation(s, line, func(raw json.RawMessage) error {
		var result struct {
			Matched bool `json:"matched"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			return err
		}
		if !result.Matched {
			if a.composerCurrent(s) {
				return fmt.Errorf("主机未识别此指令：%s", strings.Fields(line)[0])
			}
			return nil
		}
		if done != nil {
			done()
		}
		if a.composerCurrent(s) {
			a.composerRead(s, "sessionProjections", nil, a.acceptComposerProjections)
		}
		return nil
	})
}

// The Host's command acknowledgment is not proof that a browser-side effect
// happened. These original client contributions need their actual UI/resource
// carrier; typed Host parameter forms remain separate.
func composerCommandBoundary(line string) string {
	words := strings.Fields(strings.TrimSpace(line))
	if len(words) == 0 {
		return ""
	}
	name := strings.TrimPrefix(words[0], "/")
	switch name {
	case "export":
		return "Remote缺少原始会话日志下载资源，草稿已保留。"
	case "model":
		return "此斜杠模型选择交互尚未接入，请使用输入框右侧的模型菜单。"
	case "file":
		return "原版文件附件选择与上传尚未接入，草稿已保留。"
	case "feedback":
		if len(words) == 1 {
			return "反馈对话框尚未接入；可输入 /feedback <内容> 使用主机命令。"
		}
	case "permission":
		if len(words) == 1 {
			return "请使用权限菜单，或输入 /permission <权限预设>。"
		}
	}
	return ""
}
func (a *app) composerSubmit(accelerated bool) {
	s := a.composer
	if !a.connected || a.busy || a.sessionID == "" {
		return
	}
	if strings.TrimSpace(a.draft) == "" {
		if accelerated && a.current.Running && a.composerCurrent(s) {
			ids := []string{}
			for _, row := range s.values.Inbox["next-turn"] {
				ids = append(ids, row.ID)
			}
			a.composerSteerQueue(s, ids)
		}
		return
	}
	if strings.HasPrefix(strings.TrimSpace(a.draft), "/") {
		if !a.can("executeCommand") {
			s.error = "当前连接无法执行指令。"
			return
		}
		draft := a.draft
		host, sid, account, draftKey := a.hostID, a.sessionID, a.accountScope, a.viewKey(a.sessionID)
		a.composerCommand(strings.TrimSpace(draft), func() {
			key := draftKey
			if a.drafts != nil && a.drafts[key] == draft {
				a.drafts[key] = ""
			}
			if a.hostID == host && a.sessionID == sid && a.accountScope == account && a.draft == draft {
				a.draft = ""
			}
		})
		return
	}
	a.sendWithMode(composerSubmitMode(a.uiPrefs.SendMode, a.current.Running, accelerated))
}

// Command draft settlement belongs to its captured Host/session even after
// navigation. The presentation callback may be stale while the durable
// accepted receipt still needs to retire the original draft.
func (a *app) composerCommandMutation(s *composerState, line string, settle func(json.RawMessage) error) {
	params := map[string]any{"sessionId": s.sessionID, "line": line}
	serialized, _ := json.Marshal(params)
	key := a.viewKey(s.sessionID) + "\x00executeCommand\x00" + string(serialized)
	if a.mutations == nil {
		a.mutations = map[string]*mutationIntent{}
	}
	if prior := a.mutations[key]; prior != nil && prior.Unknown {
		a.error = "上一操作结果未确认，请先核对远程状态，勿重复操作。请求：" + prior.ID
		return
	}
	id := rand.Text()
	intent := &mutationIntent{ID: id, Unknown: true}
	a.mutations[key] = intent
	params["requestId"] = id
	params["clientScope"] = map[string]any{"hostId": s.hostID, "generation": s.generation, "sessionId": s.sessionID}
	a.requestWithFailure("executeCommand", params, func(raw json.RawMessage) error {
		var receipt struct {
			Status, RequestID, Detail, HostID string
			ConnectionGeneration              uint64
			Value                             json.RawMessage
		}
		if err := json.Unmarshal(raw, &receipt); err != nil {
			return err
		}
		if receipt.Status == "rejected" && receipt.RequestID == id {
			delete(a.mutations, key)
			if a.composerCurrent(s) {
				return fmt.Errorf("指令未执行：%s", receipt.Detail)
			}
			return nil
		}
		if receipt.Status != "accepted" || receipt.RequestID != id || receipt.HostID != s.hostID || receipt.ConnectionGeneration != s.generation {
			return fmt.Errorf("指令结果未确认，请核对远程状态，勿重复操作。请求：%s", id)
		}
		intent.Unknown = false
		delete(a.mutations, key)
		return settle(receipt.Value)
	}, func(err error) {
		var remote *bridge.RemoteError
		if errors.As(err, &remote) && remote.Rejected() {
			delete(a.mutations, key)
		}
	})
}
func (a *app) composerQueueAction(id string, action map[string]any) {
	s := a.composer
	if !a.composerCurrent(s) || !a.can("updateQueue") {
		return
	}
	a.mutate("updateQueue", map[string]any{"sessionId": s.sessionID, "itemId": id, "action": action}, func(json.RawMessage) error {
		if a.composerCurrent(s) {
			s.editingID = ""
			a.composerRead(s, "sessionProjections", nil, a.acceptComposerProjections)
		}
		return nil
	})
}

// Native text selection offsets use runes, as do replacement ranges. The
// completion never overwrites text after the caret or a separately edited draft.
func composerActiveToken(text string, caret int) (kind, token string, start int) {
	r := []rune(text)
	caret = min(max(caret, 0), len(r))
	prefix := string(r[:caret])
	if strings.HasPrefix(prefix, "/") && !strings.ContainsAny(prefix, " \t\n") {
		return "command", prefix, 0
	}
	for _, quoted := range []bool{true, false} {
		for i := caret - 1; i >= 0; i-- {
			if r[i] != '@' || (i > 0 && !unicode.IsSpace(r[i-1])) {
				continue
			}
			candidate := string(r[i:caret])
			if quoted {
				if strings.HasPrefix(candidate, "@\"") && !strings.ContainsAny(strings.TrimPrefix(candidate, "@\""), "\"\r\n") {
					return "file", candidate, i
				}
			} else {
				valid := true
				for _, v := range r[i+1 : caret] {
					if unicode.IsSpace(v) {
						valid = false
						break
					}
				}
				if valid {
					return "file", candidate, i
				}
			}
		}
	}
	return "", "", caret
}
func (a *app) updateComposerCompletions(s *composerState, caret int) {
	if !a.composerCurrent(s) || s.composing {
		return
	}
	kind, token, start := composerActiveToken(a.draft, caret)
	s.caret = caret
	if token == s.completionToken {
		return
	}
	s.queryGeneration++
	generation := s.queryGeneration
	s.completionToken = token
	s.completionStart = start
	s.completionEnd = caret
	s.completions = nil
	s.highlight = 0
	if token == "" || token == s.dismissedToken {
		return
	}
	if kind == "command" {
		query := strings.ToLower(strings.TrimPrefix(token, "/"))
		for _, cmd := range s.commands {
			if strings.Contains(strings.ToLower(cmd.Name), query) {
				description := cmd.Description
				if cmd.Unavailable != "" {
					description = cmd.Unavailable
				}
				s.completions = append(s.completions, composerCompletion{Label: "/" + cmd.Name, Description: description, Replacement: "/" + cmd.Name + " ", Kind: "command", Unavailable: cmd.Unavailable})
			}
		}
		return
	}
	if !a.operationCaps["listFileReferences"].Supported {
		return
	}
	query := strings.TrimPrefix(strings.TrimPrefix(token, "@"), "\"")
	a.composerRead(s, "listFileReferences", map[string]any{"query": query}, func(raw json.RawMessage) error {
		if generation != s.queryGeneration || token != s.completionToken {
			return nil
		}
		var refs []struct{ Path, Kind string }
		if err := json.Unmarshal(raw, &refs); err != nil {
			return err
		}
		for _, ref := range refs {
			replacement, ok := composerFileMention(ref.Path, ref.Kind, strings.HasPrefix(token, "@\""))
			if !ok {
				continue
			}
			if ref.Kind != "directory" {
				replacement += " "
			}
			s.completions = append(s.completions, composerCompletion{Label: ref.Path, Description: ref.Kind, Replacement: replacement, Kind: ref.Kind})
		}
		return nil
	})
}
func composerFileMention(path, kind string, preserveQuote bool) (string, bool) {
	for _, r := range path {
		if r < 32 || (r >= 127 && r <= 159) || r == '"' {
			return "", false
		}
	}
	if kind == "directory" {
		path += "/"
	}
	quoted := preserveQuote || strings.IndexFunc(path, unicode.IsSpace) >= 0
	if !quoted {
		return "@" + path, true
	}
	if kind == "directory" {
		return "@\"" + path, true
	}
	return "@\"" + path + "\"", true
}
func (a *app) composerModelLabel() string {
	if a.composer != nil && a.composer.hostID == a.hostID && a.composer.sessionID == a.sessionID && a.composer.modelLabel != "" {
		return a.composer.modelLabel
	}
	return "模型"
}
func (a *app) composerPermissionLabel() string {
	if a.composer != nil && a.composer.hostID == a.hostID && a.composer.sessionID == a.sessionID && a.composer.permissionLabel != "" {
		return a.composer.permissionLabel
	}
	return "权限"
}
func (a *app) composerPresetLabel() string {
	if a.composer != nil && a.composer.hostID == a.hostID && a.composer.sessionID == a.sessionID && a.composer.presetLabel != "" {
		return a.composer.presetLabel
	}
	return ""
}
