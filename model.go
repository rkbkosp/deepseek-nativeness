package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type device struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Online bool   `json:"online"`
}
type workspace struct {
	CreatedAt  string   `json:"createdAt"`
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	SessionIDs []string `json:"sessionIds"`
}
type session struct {
	Cwd         string  `json:"cwd"`
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Running     bool    `json:"running"`
	WorkspaceID string  `json:"workspaceId"`
	UpdatedAt   float64 `json:"updatedAt"`
	Pinned      bool    `json:"pinned"`
	Archived    bool    `json:"archived"`
	Blank       bool    `json:"blank"`
}

func (s session) updated() time.Time { return time.UnixMilli(int64(s.UpdatedAt)) }

type message struct {
	seqPresent       bool
	Seq              int64            `json:"seq"`
	SourceMessageID  json.RawMessage  `json:"sourceMessageId,omitempty"`
	Blocks           json.RawMessage  `json:"blocks,omitempty"`
	Usage            json.RawMessage  `json:"usage,omitempty"`
	Interrupted      bool             `json:"interrupted"`
	Collapsed        bool             `json:"collapsed"`
	Command          json.RawMessage  `json:"command,omitempty"`
	CallID           string           `json:"callId,omitempty"`
	ToolName         string           `json:"toolName,omitempty"`
	ToolStatus       string           `json:"toolStatus,omitempty"`
	Args             string           `json:"args,omitempty"`
	Result           json.RawMessage  `json:"result,omitempty"`
	Kind             string           `json:"kind"`
	Time             float64          `json:"time"`
	Turn             int              `json:"turn"`
	Step             int              `json:"step"`
	GroupID          string           `json:"groupId"`
	Source           json.RawMessage  `json:"source"`
	Context          *contextNode     `json:"context"`
	Tool             *toolNode        `json:"tool"`
	AssistantBlocks  []assistantBlock `json:"assistantBlocks"`
	ReasoningDisplay string           `json:"reasoningDisplay"`
	Reasoning        string           `json:"reasoning"`
	ID               string           `json:"id"`
	Role             string           `json:"role"`
	Text             string           `json:"text"`
	Streaming        bool             `json:"streaming"`
}
type contextNode struct {
	Producer struct {
		Role  string `json:"role"`
		Label string `json:"label"`
	} `json:"producer"`
	Form            string `json:"form"`
	DefaultExpanded bool   `json:"defaultExpanded"`
}
type toolNode struct {
	ResultSeq    int64           `json:"resultSeq"`
	ResultTime   float64         `json:"resultTime"`
	CallID       string          `json:"callId"`
	Name         string          `json:"name"`
	ArgsRaw      string          `json:"argsRaw"`
	Content      json.RawMessage `json:"content"`
	IsError      bool            `json:"isError"`
	Error        json.RawMessage `json:"error"`
	Meta         json.RawMessage `json:"meta"`
	Phase        string          `json:"phase"`
	ParentCallID string          `json:"parentCallId"`
	SubCalls     json.RawMessage `json:"subCalls"`
}
type assistantBlock struct {
	Kind       string          `json:"kind"`
	Text       string          `json:"text"`
	Content    string          `json:"content"`
	Attachment json.RawMessage `json:"attachment,omitempty"`
	CallID     string          `json:"callId,omitempty"`
	Name       string          `json:"name,omitempty"`
	ArgsRaw    string          `json:"argsRaw"`
	Block      json.RawMessage `json:"block,omitempty"`
}
type operationCapability struct {
	Supported bool   `json:"supported"`
	Reason    string `json:"reason"`
}
type question struct {
	ID          string           `json:"id"`
	Question    string           `json:"question"`
	Detail      string           `json:"detail"`
	Header      string           `json:"header"`
	Options     []questionOption `json:"options"`
	MultiSelect bool             `json:"multiSelect"`
	Intent      *struct {
		Kind string `json:"kind"`
	} `json:"intent"`
}
type questionOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}
type interaction struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Reason    string     `json:"reason"`
	SessionID string     `json:"sessionId"`
	Questions []question `json:"questions"`
}
type snapshot struct {
	ChatPresentation *chatPresentation `json:"chatPresentation,omitempty"`
	Projections      json.RawMessage   `json:"projections,omitempty"`
	Trajectory       []trajectoryEvent `json:"trajectory"`
	Turns            []json.RawMessage `json:"turns"`
	Cursor           int64             `json:"cursor"`
	HasMore          bool              `json:"hasMore"`
	SessionID        string            `json:"sessionId"`
	Messages         []message         `json:"messages"`
	Pending          []interaction     `json:"pending"`
	Running          bool              `json:"running"`
}
type trajectoryEvent struct {
	SurfaceOp       json.RawMessage `json:"surfaceOp,omitempty"`
	SourceEventSeqs []int64         `json:"sourceEventSeqs,omitempty"`
	ID              string          `json:"id"`
	Seq             int64           `json:"seq"`
	Type            string          `json:"type"`
	Time            float64         `json:"time"`
	Turn            int             `json:"turn"`
	Step            int             `json:"step"`
	Kind            string          `json:"kind"`
	Summary         string          `json:"summary"`
	Data            json.RawMessage `json:"data"`
}

// decodeRows accepts the helper's plain arrays and its named catalog envelope.
func decodeRows[T any](raw json.RawMessage, keys ...string) ([]T, error) {
	var rows []T
	if json.Unmarshal(raw, &rows) == nil {
		return rows, nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	for _, key := range keys {
		if data, ok := fields[key]; ok {
			if err := json.Unmarshal(data, &rows); err != nil {
				return nil, err
			}
			return rows, nil
		}
	}
	return nil, fmt.Errorf("Remote catalog does not contain %s", strings.Join(keys, "/"))
}

func demoData() ([]workspace, []session, snapshot) {
	return []workspace{{ID: "demo-workspace", Name: "远程工作区", Path: "~/Projects"}}, []session{
		{ID: "demo-current", Title: "Native DSH Remote · 界面回放", Running: true, WorkspaceID: "demo-workspace"},
		{ID: "demo-history", Title: "会话历史与文件预览", WorkspaceID: "demo-workspace"},
		{ID: "demo-animation", Title: "侧栏动效与性能验证", Running: true, WorkspaceID: "demo-workspace"},
	}, snapshot{SessionID: "demo-current", Running: true, Messages: []message{
		{ID: "demo-user", Role: "user", Text: "保留原版视觉和动效，验证新的远程客户端。"},
		{ID: "demo-assistant", Role: "assistant", Text: "这是**本地界面回放**，没有连接真实主机。\n\n主界面由 Go 原生绘制。侧栏的运行指示器沿用 1.5 秒旋转周期，并保留圆弧的呼吸变化。它只请求绘制帧，不通过计时器更新业务状态。\n\n### 当前验证范围\n\n- 会话侧栏与虚拟列表\n- 原生输入框与可选择的 Markdown\n- 按需创建和关闭的 WebKit 兼容页\n\n```go\n// 后端保持冻结，客户端消费现有协议。\nclient.OpenSession(sessionID)\n```\n\n真实连接、读写和审批状态会单独显示，不会由本地回放代替。"},
	}}
}
