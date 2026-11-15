package main

import (
	"errors"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

func remoteMarkdownPath(root, href string) (string, int, error) {
	u, err := url.Parse(href)
	if err != nil {
		return "", 0, err
	}
	if u.Scheme != "" && u.Scheme != "file" {
		return "", 0, errors.New("此链接不是远程文件")
	}
	if u.Scheme == "file" && u.Host != "" && u.Host != "localhost" {
		return "", 0, errors.New("无法读取其它设备的文件链接")
	}
	if root == "" || !path.IsAbs(root) || strings.Contains(u.Path, "\\") {
		return "", 0, errors.New("当前会话缺少有效工作区路径")
	}
	root = path.Clean(root)
	target := u.Path
	if !path.IsAbs(target) {
		target = path.Join(root, target)
	}
	target = path.Clean(target)
	if target != root && !strings.HasPrefix(target, strings.TrimRight(root, "/")+"/") {
		return "", 0, errors.New("链接指向当前工作区之外的远程文件，无法打开")
	}
	relative := strings.TrimPrefix(strings.TrimPrefix(target, root), "/")
	if relative == "" {
		return "", 0, errors.New("该链接指向目录，请在工作区文件中浏览")
	}
	line := 1
	if strings.HasPrefix(u.Fragment, "L") {
		if n, e := strconv.Atoi(strings.Split(strings.TrimPrefix(u.Fragment, "L"), "-")[0]); e == nil && n > 0 {
			line = n
		}
	}
	return relative, line, nil
}
func (a *app) openMarkdownLink(href string) {
	if strings.HasPrefix(href, "#") {
		a.md.Anchor = strings.TrimPrefix(href, "#")
		a.md.AnchorVersion++
		return
	}
	u, err := url.Parse(href)
	if err != nil {
		a.error = "链接格式无效"
		return
	}
	switch u.Scheme {
	case "http", "https":
		if u.Host == "" {
			a.error = "网页地址缺少主机名"
			return
		}
		if a.uiPrefs.LinkOpen == "new-tab" {
			if err := mygo.Shell.OpenExternal(href); err != nil {
				a.error = err.Error()
			}
		} else {
			a.openBrowserURL(href)
		}
	case "mailto":
		if err := mygo.Shell.OpenExternal(href); err != nil {
			a.error = err.Error()
		}
	case "", "file":
		root := ""
		for _, w := range a.workspaces {
			if w.ID == a.workspaceID {
				root = w.Path
				break
			}
		}
		if root == "" {
			for _, s := range a.sessions {
				if s.ID == a.sessionID {
					root = s.Cwd
					break
				}
			}
		}
		filename, line, err := remoteMarkdownPath(root, href)
		if err != nil {
			a.error = err.Error()
			return
		}
		if !a.can("readFile") {
			a.error = "当前主机未开放工作区文件读取"
			return
		}
		if a.compatPlacement == "right" {
			a.closeCompat()
		}
		if a.webPlacement == "right" {
			a.closeWeb()
		}
		a.rightPaneOpen = true
		a.loadPaneText(a.currentRightPane(), filename, line)
	default:
		a.error = "当前客户端尚未接入此链接类型"
	}
}
func (a *app) openBrowserURL(href string) {
	if a.win == nil {
		return
	}
	if a.compatPlacement == "right" || a.compatPlacement == "main" {
		a.closeCompat()
	}
	a.closeWeb()
	v, err := a.win.NewWebView(mygo.WebViewOptions{URL: href, Page: mygo.PageOptions{Untrusted: true}, BackgroundColor: "#151517"})
	if err != nil {
		a.error = err.Error()
		return
	}
	a.web = v
	a.webPlacement = "right"
	a.webTarget = href
	a.rightPaneOpen = true
	a.win.Invalidate()
}
func (a *app) browserPaneView(c *ui.Context) {
	ui.Row(c).Height(48).Shrink(0).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.ButtonBase(c).Label("右侧栏开始页").Children(func() { icon(c, "browse-outline", 16); ui.Text(c, "开始").FontSize(14) }).Clicked() {
			a.closeWeb()
		}
		ui.Text(c, "/ 浏览器").FontSize(13).TextColor(a.theme.TextMuted)
		ui.Spacer(c)
		if ui.ButtonBase(c).Size(24, 24).Label("关闭浏览器").Children(func() { icon(c, "close-outline", 14) }).Clicked() {
			a.closeWeb()
		}
	})
	if a.web != nil {
		ui.WebView(c.Key("browser-view"), a.web).Grow(1).MinHeight(0).MinWidth(0)
	}
}
func (a *app) markdownCodeBlock(c *ui.Context, b *markdown.CodeBlockView) {
	box := ui.Column(c).FillWidth().MinWidth(0).Radius(16).Clip().Background(a.colors.CodeBlock).Label("代码块")
	type state struct {
		Wrap   bool
		Copied time.Time
	}
	s := ui.Local(box, "markdown-code", func() state { return state{Wrap: true} })
	box.Children(func() {
		ui.Row(c).FillWidth().Background(a.colors.CodeBanner).Padding(9, 14).Gap(4).AlignItems(ui.Center).Children(func() {
			label := b.Language
			if !supportsCodeHint(label) {
				label = "代码块"
			}
			ui.Text(c, label).FontSize(11).TextColor(a.theme.Text)
			ui.Spacer(c)
			wrapGlyph, wrapTitle := "wrap-fill", "自动换行"
			if s.Wrap {
				wrapGlyph, wrapTitle = "nowrap-fill", "取消自动换行"
			}
			if ui.ButtonBase(c).Size(24, 24).Padding(0).Radius(4).Label("自动换行").Tooltip(wrapTitle).Children(func() { icon(c, wrapGlyph, 14).TextColor(a.colors.Secondary) }).Clicked() {
				s.Wrap = !s.Wrap
			}
			copied := !s.Copied.IsZero() && c.Now().Sub(s.Copied) < 2*time.Second
			title := "复制"
			if copied {
				title = "已复制"
				c.After(2*time.Second - c.Now().Sub(s.Copied))
			}
			glyph := "copy-outline"
			if copied {
				glyph = "check-outline"
			}
			if ui.ButtonBase(c).Size(24, 24).Padding(0).Radius(4).Label("复制代码").Tooltip(title).Children(func() { icon(c, glyph, 14).TextColor(a.colors.Secondary) }).Clicked() {
				c.WriteClipboard(b.Code())
				s.Copied = c.Now()
			}
		})
		old, oldCell := a.md.WrapCode, a.mdCell.WrapCode
		a.md.WrapCode = s.Wrap
		a.mdCell.WrapCode = s.Wrap
		// The framework's selectable/highlighted body stays intact. Its outer
		// flex item must be shrinkable, otherwise an unbroken line becomes the
		// card's intrinsic minimum width even when wrap is enabled.
		b.Body(c).FillWidth().MinWidth(0).Shrink(1).Margin(16-a.uiPrefs.FontSize*.25, 0, 0, 0).Label("代码内容")
		a.md.WrapCode = old
		a.mdCell.WrapCode = oldCell
	})
}
