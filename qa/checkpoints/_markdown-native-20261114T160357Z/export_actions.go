package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"time"
)

type sessionMarkdownCopy struct {
	Client                        *bridge.Client
	Host, Account, Session, Owner string
	Generation, Navigation        uint64
	Context                       context.Context
	Cancel                        context.CancelFunc
	ReadStarted                   bool
}

// Session identity and the actual helper instance belong to the click. No UI Context
// or Element survives a frame, and no late result may reach the clipboard.
func (a *app) markdownCopyCurrent(p *sessionMarkdownCopy) bool {
	return p != nil && a.markdownCopy == p && p.Context.Err() == nil && a.ctx.Err() == nil &&
		a.connected && a.client == p.Client && a.hostID == p.Host && a.accountScope == p.Account &&
		a.sessionID == p.Session && a.remoteGeneration == p.Generation && a.navigationGeneration == p.Navigation
}
func (a *app) cancelSessionMarkdownCopy() {
	if p := a.markdownCopy; p != nil {
		a.markdownCopy = nil
		p.Cancel()
	}
}
func (a *app) markdownCopyLifecycle(c *ui.Context) {
	if a.markdownCopy != nil && !a.markdownCopyCurrent(a.markdownCopy) {
		a.cancelSessionMarkdownCopy()
	}
	if a.copyNotice != "" {
		c.Toast(a.copyNotice)
		a.copyNotice = ""
	}
}
func (a *app) copySessionMarkdown() {
	if a.markdownCopy != nil {
		return
	} // Join the one captured copy intent; never race clipboard writes.
	if a.demo || a.client == nil || a.sessionID == "" || !a.can("exportSessionMarkdown") {
		return
	}
	life, cancel := context.WithCancel(a.ctx)
	p := &sessionMarkdownCopy{Client: a.client, Host: a.hostID, Account: a.accountScope, Session: a.sessionID, Owner: "markdown-" + rand.Text(), Generation: a.remoteGeneration, Navigation: a.navigationGeneration, Context: life, Cancel: cancel}
	a.markdownCopy = p
	// This cleanup also runs when the window/app closes without another frame.
	context.AfterFunc(life, func() { releaseRemoteOwner(p.Client, p.Owner) })
	go func() {
		// A canceled view must still observe a registration receipt and release its
		// late-created owner. Do not cancel this local registration with the view.
		ctx, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		raw, err := p.Client.Call(ctx, "registerOwner", map[string]any{"ownerId": p.Owner, "clientScope": map[string]any{"hostId": p.Host, "generation": p.Generation, "sessionId": p.Session}})
		if p.Context.Err() != nil {
			releaseRemoteOwner(p.Client, p.Owner)
			return
		}
		var receipt struct {
			Registered bool   `json:"registered"`
			OwnerID    string `json:"ownerId"`
		}
		if err == nil && (json.Unmarshal(raw, &receipt) != nil || !receipt.Registered || receipt.OwnerID != p.Owner) {
			err = errors.New("invalid export owner receipt")
		}
		a.update(func() {
			if !a.markdownCopyCurrent(p) {
				p.Cancel()
				releaseRemoteOwner(p.Client, p.Owner)
				return
			}
			if err != nil {
				a.finishSessionMarkdownCopy(p, "无法读取 Session 进行复制，请重试")
				return
			}
			p.ReadStarted = true
			a.readSessionMarkdownCopy(p)
		})
	}()
}
func (a *app) finishSessionMarkdownCopy(p *sessionMarkdownCopy, notice string) {
	if !a.markdownCopyCurrent(p) {
		p.Cancel()
		return
	}
	a.markdownCopy = nil
	p.Cancel()
	a.copyNotice = notice
}
func (a *app) readSessionMarkdownCopy(p *sessionMarkdownCopy) {
	go func() {
		ctx, stop := context.WithTimeout(p.Context, 45*time.Second)
		defer stop()
		raw, err := p.Client.Call(ctx, "exportSessionMarkdown", map[string]any{"sessionId": p.Session, "clientScope": map[string]any{"hostId": p.Host, "generation": p.Generation, "sessionId": p.Session, "ownerId": p.Owner}})
		if p.Context.Err() != nil {
			return
		}
		var result struct {
			SessionID          string `json:"sessionId"`
			Markdown           string `json:"markdown"`
			Complete           bool   `json:"complete"`
			ThroughSeq         int64  `json:"throughSeq"`
			EventCount         int64  `json:"eventCount"`
			Source             string `json:"source"`
			SourcePathIncluded bool   `json:"sourcePathIncluded"`
		}
		if err == nil && (len(raw) > 8*1024*1024+256 || json.Unmarshal(raw, &result) != nil || result.SessionID != p.Session || !result.Complete || result.ThroughSeq < -1 || result.EventCount != result.ThroughSeq+1 || result.Markdown == "" || result.Source != "original-formatSessionMarkdown+session/events" || result.SourcePathIncluded) {
			err = errors.New("invalid complete Markdown receipt")
		}
		if p.Context.Err() != nil {
			return
		}
		a.update(func() {
			if !a.markdownCopyCurrent(p) {
				p.Cancel()
				return
			}
			if err != nil {
				a.finishSessionMarkdownCopy(p, "无法读取 Session 进行复制，请重试")
				return
			}
			write := a.testMarkdownClipboard
			if write == nil {
				write = func(text string) error { return mygo.Clipboard.Write(transfer.TextData(text)) }
			}
			if write(result.Markdown) != nil {
				a.finishSessionMarkdownCopy(p, "无法写入剪贴板，请检查剪贴板权限后重试")
				return
			}
			a.finishSessionMarkdownCopy(p, "Session 已复制为 Markdown")
		})
	}()
}
