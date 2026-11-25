package main

import (
	"regexp"
	"strings"

	"github.com/egoist/mygo/ui"
)

var composerMentionToken = regexp.MustCompile(`@"([^"]+)"|@([^\s@]+)`)

// composerMentionLabels lists the @-references currently in the draft, in
// first-seen order.
func composerMentionLabels(draft string) []string {
	var labels []string
	seen := map[string]bool{}
	for _, match := range composerMentionToken.FindAllStringSubmatch(draft, -1) {
		label := match[1]
		if label == "" {
			label = match[2]
		}
		if label == "" || seen[label] {
			continue
		}
		seen[label] = true
		labels = append(labels, label)
	}
	return labels
}

func removeComposerMention(draft, label string) string {
	for _, token := range []string{"@\"" + label + "\"", "@" + label} {
		if strings.Contains(draft, token) {
			out := strings.Replace(draft, token, "", 1)
			for strings.Contains(out, "  ") {
				out = strings.ReplaceAll(out, "  ", " ")
			}
			return strings.TrimSpace(out)
		}
	}
	return draft
}

// composerMentionChips draws the draft's references as read-only chips. It is
// input-inert: a button here used to take focus away from the text area and
// stalled @-completion.
// openMentionPath opens a referenced file in the right pane. A directory
// reference opens the files tab instead of a document.
func (a *app) openMentionPath(label string) {
	s := a.currentRightPane()
	a.rightPaneOpen = true
	if strings.HasSuffix(label, "/") {
		s.Tab = "files"
		s.CurrentDir = strings.TrimSuffix(label, "/")
		return
	}
	s.Selected = label
	a.loadPaneText(s, label, 1)
}

func (a *app) composerMentionChips(c *ui.Context) {
	labels := composerMentionLabels(a.draft)
	if len(labels) == 0 {
		return
	}
	ui.Row(c).FillWidth().Wrap().Gap(6).Padding(2, 10, 0).Children(func() {
		for _, label := range labels {
			label := label
			chip := ui.ButtonBase(c).Height(24).Padding(2, 8).Radius(6).Gap(4).AlignItems(ui.Center).Background(a.colors.CodeBlock).Label("打开引用 " + label)
			chip.ContextMenu(func(m *ui.Menu) {
				if m.Item("移除引用 " + label).Chosen() {
					a.draft = removeComposerMention(a.draft, label)
				}
			})
			chip.Children(func() {
				icon(c, "paperclip-outline", 12).TextColor(a.colors.Caption)
				ui.Text(c, label).FontSize(11).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…")
			})
			if chip.Clicked() {
				a.openMentionPath(label)
			}
		}
	})
}
