package main

import (
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

// displayReasoning ports the original reasoningText(): a leading signature block
// is not display copy, and a signature-only value hides the row entirely.
func displayReasoning(text string) (string, bool) {
	if text == "" || text[0] != '<' {
		return text, text != ""
	}
	const opening = "<signature>"
	const closing = "</signature>"
	if strings.HasPrefix(opening, text) {
		return "", false
	}
	if !strings.HasPrefix(text, opening) {
		return text, text != ""
	}
	end := strings.Index(text[len(opening):], closing)
	if end < 0 {
		return "", false
	}
	start := len(opening) + end + len(closing)
	for start < len(text) {
		switch {
		case text[start] == '\n':
			start++
		case text[start] == '\r' && start+1 < len(text) && text[start+1] == '\n':
			start += 2
		default:
			goto trimmed
		}
	}
trimmed:
	out := text[start:]
	return out, strings.TrimSpace(out) != ""
}

func reasoningFirstLine(text string) string {
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		return text[:i]
	}
	return text
}

// latestCompletedParagraph returns the first line of the last paragraph that
// has a complete first line, matching the running reasoning preview.
func latestCompletedParagraph(text string) string {
	summary := ""
	paragraphStart := 0
	for paragraphStart <= len(text) {
		next := strings.Index(text[paragraphStart:], "\n\n")
		paragraphEnd := len(text)
		if next >= 0 {
			paragraphEnd = paragraphStart + next
		}
		if newline := strings.IndexByte(text[paragraphStart:paragraphEnd], '\n'); newline >= 0 {
			if candidate := strings.TrimSpace(text[paragraphStart : paragraphStart+newline]); candidate != "" {
				summary = candidate
			}
		}
		if next < 0 {
			break
		}
		paragraphStart += next + 2
	}
	return summary
}

func (a *app) reasoningView(c *ui.Context, key, raw string, open *bool, running bool) {
	text, visible := displayReasoning(raw)
	if !visible {
		return
	}
	summary := reasoningFirstLine(text)
	if running {
		if latest := latestCompletedParagraph(text); latest != "" {
			summary = latest
		}
	}
	summary = strings.ReplaceAll(summary, "**", "")
	// Reasoning is model prose that can quote a credential it just read.
	a.disclosureRow(c, key, "think-outline", "思考", maskSecrets(summary), open, false, false, 22, func() {
		markdown.View(c, maskSecrets(text), &a.mdCompact)
	})
}

func (a *app) contextView(c *ui.Context, m message, key string) {
	title := "上下文注入"
	if m.Kind == "compaction" {
		title = "上下文压缩"
	}
	summary := ""
	if m.Context != nil {
		if m.Context.Producer.Role == "recall" {
			title = "跨会话召回"
		}
		summary = m.Context.Producer.Label
	}
	open := a.foldState("context:"+key, false)
	a.disclosureRow(c, key, "context-injection-outline", title, maskSecrets(summary), open, false, false, 22, func() {
		ui.Scroll(c).MaxHeight(141).Children(func() {
			ui.Text(c, maskSecrets(m.Text)).FontSize(13).FixedLineHeight(20).TextColor(a.colors.Tertiary).Wrap().Selectable()
		})
	})
}
