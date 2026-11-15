package main

import (
	"encoding/json"
	"fmt"
)

type sendIntent struct {
	ID, SessionID, Text string
	HostID              string
	AccountScope        string
	Draft               string
	Unknown             bool
	Content             []composerContentPart
	AttachmentIDs       []string
	StoreKey, IntentKey string
}
type operationReceipt struct {
	Status    string `json:"status"`
	RequestID string `json:"requestId"`
	Detail    string `json:"detail"`
}

func (a *app) acceptSend(raw json.RawMessage, intent *sendIntent) error {
	var receipt operationReceipt
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return fmt.Errorf("发送结果未确认，请核对会话。请求：%s", intent.ID)
	}
	if receipt.Status != "accepted" || receipt.RequestID != intent.ID {
		intent.Unknown = true
		return fmt.Errorf("发送结果未确认，请核对会话，勿重复发送。请求：%s。%s", intent.ID, receipt.Detail)
	}
	intent.Unknown = false
	// The accepted message starts the Turn: flip the row's blank flag now, so a
	// switch cannot hide the Session before the Host's own list update lands.
	a.markSessionTurnStarted(intent.SessionID)
	original := intent.Draft
	if original == "" {
		original = intent.Text
	}
	if a.sessionID == intent.SessionID && a.hostID == intent.HostID && a.accountScope == intent.AccountScope && a.draft == original {
		a.draft = ""
	}
	key := intent.HostID + "\x00" + intent.SessionID
	if intent.AccountScope != "" {
		key = intent.AccountScope + "\x00" + key
	}
	if a.drafts != nil && a.drafts[key] == original {
		a.drafts[key] = ""
	}
	if a.pendingSend == intent {
		a.pendingSend = nil
	}
	intentKey := intent.IntentKey
	if intentKey == "" {
		intentKey = key + "\x00" + intent.Text
	}
	delete(a.sendIntents, intentKey)
	a.acceptComposerAttachments(intent)
	return nil
}
