package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

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
		if err != nil {
			releaseRemoteOwner(p.Client, p.Owner)
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
		// The completed/failed read no longer needs a helper owner even if its
		// UI completion is queued. Keep the clipboard intent alive until that gate.
		defer releaseRemoteOwner(p.Client, p.Owner)
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

// The Session log archive follows a different route from the Markdown copy: the
// local helper writes the ZIP beside itself and answers with its path, and this
// client only streams that file to the place the user picks. No archive bytes
// travel through the stdio carrier, so a large Session log costs no base64 and
// no extra copy in the client's memory.

// exportSessionZipMethod is the helper method that builds the archive. It runs
// only against a Host this process owns: a Remote Host does not serve the raw
// Session log to this client yet.
const exportSessionZipMethod = "exportSessionZip"

// exportSessionZipRunning makes the export one at a time. The save panel can
// stay open for minutes, and a second click must join the first rather than
// start another helper read.
var exportSessionZipRunning atomic.Bool

// exportSessionZipSavePanel asks where the archive should go. It is a variable
// so a test answers the panel without a window; "" means the user closed it.
var exportSessionZipSavePanel = func(win *mygo.Window, name string) (string, error) {
	dest, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      win,
		Title:       "导出会话日志",
		Message:     "会话日志以 ZIP 归档保存到磁盘。",
		ButtonLabel: "导出",
		DefaultPath: filepath.Join(exportSessionZipFallbackDir(), name),
		Filters:     []mygo.FileFilter{{Name: "ZIP 归档", Extensions: []string{"zip"}}},
	})
	if err != nil || dest == "" {
		return dest, err
	}
	return sessionZipName(dest), nil
}

// exportSessionZipFallbackDir is where the archive goes when the save panel
// cannot be shown at all. The notice names the file, so an export is never
// dropped silently.
var exportSessionZipFallbackDir = func() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "Downloads")
}

// sessionZipEntry is what the Session archive entry shows: whether it can run,
// and the copy that explains the state.
type sessionZipEntry struct {
	Enabled bool
	Tooltip string
}

const (
	sessionZipRemoteTooltip = "当前 Remote 未提供原始 Session 日志下载接口"
	sessionZipLocalTooltip  = "把本会话的日志 ZIP 保存到磁盘"
)

// canExportSessionZip reports whether this launch can hand over an archive.
// localMode() needs the runtime object, and the menu is installed before it
// exists, so the launch flag answers for the menu; the action re-checks below.
func (a *app) canExportSessionZip() bool {
	return a.localMode() || localNativeMode
}

// sessionZipOffer is the entry's state in each mode. A Remote Host cannot be
// asked for its raw Session log, so that wording stays exactly as it was.
func sessionZipOffer(local bool) sessionZipEntry {
	if local {
		return sessionZipEntry{Enabled: true, Tooltip: sessionZipLocalTooltip}
	}
	return sessionZipEntry{Tooltip: sessionZipRemoteTooltip}
}

// sessionZipReceipt is the helper's answer once it is known to name a complete
// archive in the helper's own temporary directory.
type sessionZipReceipt struct {
	Path  string
	Name  string
	Bytes int64
}

func sessionZipError(reason string) error { return errors.New("无法导出会话日志：" + reason) }

// sessionZipName keeps only the last element of a helper-supplied name, so the
// save panel and the fallback path can never be steered elsewhere.
func sessionZipName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return ""
	}
	if !strings.HasSuffix(strings.ToLower(name), ".zip") {
		name += ".zip"
	}
	return name
}

// sessionZipReceiptFrom validates the answer before anything touches the disk:
// the export completed, the file exists, is a plain file, and matches the size
// the helper reported.
func sessionZipReceiptFrom(raw json.RawMessage, callErr error) (sessionZipReceipt, error) {
	if callErr != nil {
		if errors.Is(callErr, context.DeadlineExceeded) {
			return sessionZipReceipt{}, sessionZipError("导出超时，请重试")
		}
		return sessionZipReceipt{}, sessionZipError(callErr.Error())
	}
	if len(raw) > 64*1024 {
		return sessionZipReceipt{}, sessionZipError("本地运行时返回了无效的结果")
	}
	var answer struct {
		Status string `json:"status"`
		Path   string `json:"path"`
		Bytes  int64  `json:"bytes"`
		Name   string `json:"name"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return sessionZipReceipt{}, sessionZipError("本地运行时返回了无效的结果")
	}
	if answer.Status != "completed" {
		if answer.Status == "" {
			return sessionZipReceipt{}, sessionZipError("本地运行时返回了无效的结果")
		}
		status := answer.Status
		if len(status) > 40 {
			status = status[:40]
		}
		return sessionZipReceipt{}, sessionZipError("本地运行时未完成导出（" + status + "）")
	}
	if answer.Path == "" {
		return sessionZipReceipt{}, sessionZipError("本地运行时没有给出导出文件")
	}
	info, err := os.Stat(answer.Path)
	if err != nil || !info.Mode().IsRegular() {
		return sessionZipReceipt{}, sessionZipError("导出文件不可读")
	}
	if answer.Bytes <= 0 {
		answer.Bytes = info.Size()
	}
	if answer.Bytes != info.Size() {
		return sessionZipReceipt{}, sessionZipError("导出文件不完整")
	}
	// The Host answers this route with application/zip, but an error page served
	// with 200 must never be saved as a .zip the user then cannot open.
	if !sessionZipSignature(answer.Path) {
		return sessionZipReceipt{}, sessionZipError("导出文件不是有效的 ZIP 归档")
	}
	name := sessionZipName(answer.Name)
	if name == "" {
		name = sessionZipName(answer.Path)
	}
	if name == "" {
		return sessionZipReceipt{}, sessionZipError("导出文件没有文件名")
	}
	return sessionZipReceipt{Path: answer.Path, Name: name, Bytes: info.Size()}, nil
}

// exportSessionZip saves this Session's log archive. The helper call and every
// write to UI state follow the request conventions: the call runs off the UI
// thread with its own deadline, and nothing reaches the window outside update.
func (a *app) exportSessionZip() {
	if !exportSessionZipRunning.CompareAndSwap(false, true) {
		return
	}
	session, client := a.sessionID, a.client
	if a.demo || client == nil || session == "" || !a.localMode() {
		exportSessionZipRunning.Store(false)
		a.error = "本地运行时未启动，无法导出会话日志。请先打开本地工作区。"
		return
	}
	go func() {
		defer exportSessionZipRunning.Store(false)
		ctx, stop := context.WithTimeout(a.ctx, 2*time.Minute)
		defer stop()
		raw, callErr := client.Call(ctx, exportSessionZipMethod, map[string]any{"sessionId": session})
		if a.ctx.Err() != nil {
			return // the window is gone; nothing may hold the archive
		}
		receipt, err := sessionZipReceiptFrom(raw, callErr)
		if err != nil {
			a.sessionZipFailed(err.Error())
			return
		}
		// The archive lives in the helper's temporary directory: it is this
		// export's working copy, never the user's file, so it goes away however
		// the save turns out.
		defer os.Remove(receipt.Path)
		dest, canceled, err := a.sessionZipDestination(receipt)
		if err != nil {
			a.sessionZipFailed(err.Error())
			return
		}
		if canceled {
			a.sessionZipNotice("已取消导出会话日志")
			return
		}
		if err := streamSessionZip(receipt.Path, dest); err != nil {
			a.sessionZipFailed("无法写入所选位置：" + err.Error())
			return
		}
		a.sessionZipNotice("会话日志已导出到 " + dest)
	}()
}

// sessionZipDestination asks where the archive goes, falling back to Downloads
// when the panel itself fails: an export that cannot ask still lands somewhere
// the notice can point at.
func (a *app) sessionZipDestination(receipt sessionZipReceipt) (dest string, canceled bool, err error) {
	dest, err = exportSessionZipSavePanel(a.win, receipt.Name)
	if err == nil {
		return dest, dest == "", nil
	}
	dir := exportSessionZipFallbackDir()
	if dir == "" {
		return "", false, sessionZipError("无法打开保存面板，请重试")
	}
	if mkErr := os.MkdirAll(dir, 0o755); mkErr != nil {
		return "", false, sessionZipError("无法打开保存目录：" + mkErr.Error())
	}
	return sessionZipFreePath(dir, receipt.Name), false, nil
}

// sessionZipFreePath names a file in dir that is not taken yet, so the fallback
// never overwrites something the user already has.
func sessionZipFreePath(dir, name string) string {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	path := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Stat(path); err != nil {
			return path
		}
		path = filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
	}
}

// streamSessionZip copies the archive without holding it in memory: a Session
// log can be hundreds of megabytes. A failed copy leaves no half archive where
// the user expects a file.
func streamSessionZip(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if dir := filepath.Dir(dest); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		os.Remove(dest)
		return copyErr
	}
	if closeErr != nil {
		os.Remove(dest)
		return closeErr
	}
	return nil
}

// sessionZipSignature reports whether the file starts like a ZIP archive: an
// entry (PK\x03\x04), an empty archive (PK\x05\x06), or a spanned one
// (PK\x07\x08).
func sessionZipSignature(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	var magic [4]byte
	if _, err := io.ReadFull(file, magic[:]); err != nil {
		return false
	}
	if magic[0] != 'P' || magic[1] != 'K' {
		return false
	}
	return magic[2] == 0x03 || magic[2] == 0x05 || magic[2] == 0x07
}

// sessionZipFailed shows the reason in the error banner, which stays until the
// user dismisses it, and leaves the menu entry live: the retry is the same
// entry, so nothing has to be reset first.
func (a *app) sessionZipFailed(message string) {
	a.update(func() {
		if a.ctx.Err() != nil {
			return
		}
		a.error = message
	})
}

// sessionZipNotice reports where the archive went through the notice the view
// already turns into a toast, so a successful export never looks like nothing
// happened.
func (a *app) sessionZipNotice(message string) {
	a.update(func() {
		if a.ctx.Err() != nil {
			return
		}
		a.copyNotice = message
	})
}
