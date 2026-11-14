package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"native-dsh/desktop/internal/bridge"
	"strings"
)

type compatRejectedError string

func (e compatRejectedError) Error() string { return string(e) }
func compatRPCFailure(err error) map[string]any {
	code, delivery := "CLIENT_ERROR", "unknown"
	var remote *bridge.RemoteError
	var local compatRejectedError
	if errors.As(err, &remote) {
		code, delivery = remote.Code, remote.Delivery
		if delivery == "" {
			delivery = "unknown"
			if remote.Rejected() {
				delivery = "rejected"
			}
		}
	} else if errors.As(err, &local) {
		code, delivery = "CLIENT_REJECTED", "rejected"
	}
	return map[string]any{"ok": false, "error": map[string]string{"code": code, "message": err.Error(), "delivery": delivery}}
}

// RequestV2 preserves delivery certainty across MyGo's JavaScript error boundary.
// A rejected operation may be corrected; unknown delivery must never be replayed.
func (api *CompatAPI) RequestV2(ctx context.Context, method string, params json.RawMessage) map[string]any {
	value, err := api.Request(ctx, method, params)
	if err == nil {
		return map[string]any{"ok": true, "value": value}
	}
	return compatRPCFailure(err)
}

func (api *CompatAPI) OpenSession(ctx context.Context, sessionID string) error {
	if err := api.caller(ctx); err != nil {
		return err
	}
	page := mygo.CallerPage(ctx)
	var result error
	mygo.RunOnMain(func() {
		a := api.a
		if a.compat == nil || a.compat.Page() != page || a.compatHost != a.hostID || a.compatGeneration != a.remoteGeneration {
			result = errors.New("主机已切换，请重新打开页面")
			return
		}
		for _, s := range a.sessions {
			if s.ID == sessionID {
				a.closeCompat()
				a.chooseSession(s)
				a.win.Invalidate()
				return
			}
		}
		result = errors.New("会话已不在当前主机目录中，请刷新")
	})
	return result
}

// StartDraft changes only client text after an explicit page action. It never
// creates a Host session, changes its preset, or submits a model prompt.
func (api *CompatAPI) StartDraft(ctx context.Context, prompt string, preset ...string) error {
	if err := api.caller(ctx); err != nil {
		return err
	}
	page := mygo.CallerPage(ctx)
	var result error
	mygo.RunOnMain(func() {
		a := api.a
		if a.compat == nil || a.compat.Page() != page || a.compatHost != a.hostID || a.compatGeneration != a.remoteGeneration || a.compatSession != a.sessionID || a.sessionID == "" {
			result = errors.New("会话已切换，请重新打开页面")
			return
		}
		if len(preset) > 0 && preset[0] != "" {
			result = errors.New("请先在会话中选择所需 Agent 预设，再创建草稿")
			return
		}
		if strings.TrimSpace(a.draft) != "" {
			result = errors.New("当前会话已有草稿，请先保存或发送后再创建")
			return
		}
		a.closeCompat()
		a.draft = prompt
		a.focusDraft = true
		a.win.Invalidate()
	})
	return result
}

func (a *app) notifyCompatCatalog(method string, rows any) {
	if a.compat == nil || a.compatHost != a.hostID || a.compatGeneration != a.remoteGeneration {
		return
	}
	data, err := json.Marshal(rows)
	if err == nil {
		_ = compatNotifications.EmitPage(a.compat.Page(), bridge.Notification{Method: method, Params: data})
	}
}
