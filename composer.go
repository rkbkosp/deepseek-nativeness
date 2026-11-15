package main

import (
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

// The native card follows InputBar.module.css. The original model menu is
// created on demand in an anchored WK view, leaving the transcript native.
func (a *app) composerView(c *ui.Context) {
	if len(a.current.Pending) > 0 {
		a.pendingPanelView(c)
		return
	}
	if !a.composerCurrent(a.composer) {
		if a.composer != nil && a.composer.artifacts != nil {
			a.composer.artifacts.releaseDecodedImages()
		}
		// Go navigation updates its target before the helper has opened it.
		// The successful openSession hook starts scoped reads after the peer
		// has installed the same selection; rendering alone must not race it.
		a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, accountScope: a.accountScope, generation: a.remoteGeneration}
	}
	s := a.composer
	frame := ui.Row(c.Key("composer-frame")).Shrink(0).FillWidth().Justify(ui.Center).Padding(0, 16, 4)
	// ConversationRoot.module.css: clamp(680px, column * .64, 920px) +32.
	cardMax := a.chatContentWidth(c) + 32
	frame.Children(func() {
		ui.Column(c).FillWidth().Shrink(1).MinWidth(0).MaxWidth(cardMax).Gap(6).Font(a.messageFontFamily()).FontWeight(a.messageNormalWeight()).Children(func() {
			if len(a.current.Pending) > 0 {
				ui.Scroll(c).MaxHeight(280).Children(func() {
					ui.Column(c).Gap(8).Children(func() {
						for _, p := range a.current.Pending {
							a.pendingView(c, p)
						}
					})
				})
			}
			a.todoPanelView(c, s)
			a.composerQueueView(c, s)
			card := ui.Column(c).FillWidth().MinWidth(0).Padding(8, 0, 0).Gap(12).Radius(28).InsetShadow(0, 0, 0, .5, a.theme.Border).Shadow(0, 8, 24, 0, ui.RGBA(0, 0, 0, .12)).Background(a.colors.Composer)
			if a.connected && !a.busy && s.values.ImageLimits.available() && !a.composerArtifacts().Loading {
				if paths := card.DroppedFiles(); len(paths) > 0 {
					a.composerAddImageFiles(paths)
				}
			}
			card.Children(func() {
				a.composerAttachmentRail(c)
				input := ui.TextAreaBase(c, &a.draft).Placeholder(a.composerPlaceholder()).Font(a.messageFontFamily()).FontWeight(a.messageNormalWeight()).FontSize(a.uiPrefs.FontSize).FixedLineHeight(a.uiPrefs.FontSize+10).Lines(1, 14).MinHeight(36).Padding(4, 8, 0, 14).MarginEnd(4).Label("消息输入框")
				if s.pendingPasteText != "" {
					start, end := input.TextSelection()
					input.ReplaceText(start, end, s.pendingPasteText)
					s.pendingPasteText = ""
				}
				if a.connected && !a.busy && s.values.ImageLimits.available() {
					services := c.Services()
					input.OnPaste(func(text string) bool {
						data := services.ReadClipboardData(transfer.PNG)
						if len(data.Items()) == 0 {
							files := services.ReadClipboardData(transfer.FileList)
							if paths, err := files.Files(); err == nil && len(paths) > 0 {
								a.composerAddImageFiles(paths)
								return true
							}
						}
						return a.composerPasteImages(s, data, text)
					})
				}
				if pending := s.pendingReplacement; pending != nil {
					s.pendingReplacement = nil
					if a.draft == pending.Before {
						input.ReplaceText(pending.Start, pending.End, pending.Text)
						input.SetTextSelection(pending.Caret, pending.Caret)
					}
				}
				if a.focusDraft {
					input.Focus()
					a.focusDraft = false
				}
				s.composing = input.Composing()
				input.ObserveInput(func(ev ui.InputEvent) {
					switch ev.Kind {
					case ui.InputCompose:
						s.composing = ev.Text != ""
					case ui.InputText:
						s.composing = false
					case ui.InputKeyDown:
						s.repeatKey = ev.Repeat
					}
				})
				_, caret := input.TextAnchorCaret()
				if input.Focused() {
					a.updateComposerCompletions(s, caret)
				}
				input.OnTextKey(func(k ui.TextKey) bool { return a.composerKey(s, k) })
				// MyGo gives registered shortcuts priority over OnTextKey. Bind
				// accelerated Enter at the input, so a window shortcut cannot
				// steal candidate confirmation or receive a second send gesture.
				cmdEnter := input.Shortcut(ui.Cmd, ui.KeyEnter)
				ctrlEnter := input.Shortcut(ui.Ctrl, ui.KeyEnter)
				if (cmdEnter || ctrlEnter) && !s.composing && !s.repeatKey {
					a.composerSubmit(true)
				}
				for _, mods := range []ui.Modifiers{ui.Alt, ui.Cmd | ui.Shift, ui.Ctrl | ui.Shift, ui.Cmd | ui.Ctrl} {
					_ = input.Shortcut(mods, ui.KeyEnter)
				}
				a.composerCompletionView(c, s, input)
				a.composerToolbar(c, s, input, caret)
			})
			if s.error != "" {
				ui.Row(c).Height(22).Shrink(0).AlignSelf(ui.Center).Children(func() {
					ui.Text(c, s.error).FontSize(11).TextColor(a.theme.TextMuted).SingleLine()
				})
			} else {
				a.composerStatsView(c, false)
			}
		})
	})
	a.composerPermissionConfirmation(c, s)
	a.composerImageLightbox(c)
}

func (a *app) composerModelPopover(c *ui.Context, anchor ui.Element) {
	wasOpen := a.modelPopoverOpen
	panel := ui.PopoverBase(c, anchor, &a.modelPopoverOpen, func(panel ui.Element) {
		width, height := a.modelMenuWidth, a.modelMenuHeight
		if width <= 0 {
			width = 240
		}
		if height <= 0 {
			height = 320
		}
		panel.Width(min(max(width, 240), 420)).Height(min(max(height, 40), 360)).Padding(0).Radius(12).Clip().Background(a.colors.Popup)
		if a.compat != nil && a.compatPlacement == "modelPopover" {
			ui.WebView(c, a.compat).Fill()
		} else {
			ui.Text(c, "正在加载模型…").Padding(16).FontSize(12).TextColor(a.theme.TextMuted)
		}
	})
	if panel.Dismissed() || (wasOpen && !a.modelPopoverOpen) {
		a.closeCompat()
	}
}

func (a *app) composerKey(s *composerState, k ui.TextKey) bool {
	if !a.composerCurrent(s) {
		return k.Key == ui.KeyEnter
	}
	if k.Key == ui.KeyEnter {
		// Plain candidate-Enter is filtered by the IME before OnTextKey. Cmd-Enter
		// can reach this callback while the editor still owns marked text.
		if k.Mods == ui.Shift {
			return false
		}
		if s.composing {
			return true
		}
		if s.repeatKey {
			return true
		}
		if k.Mods != 0 && k.Mods != ui.Cmd && k.Mods != ui.Ctrl {
			return true
		}
		if len(s.completions) > 0 && k.Mods == 0 {
			if s.completions[s.highlight].Unavailable != "" {
				s.error = s.completions[s.highlight].Unavailable
				return true
			}
			if s.completions[s.highlight].Kind == "file-action" {
				a.composerChooseImages()
				s.pendingReplacement = &composerReplacement{Before: k.Text(), Start: s.completionStart, End: s.completionEnd, Caret: s.completionStart}
				s.completions = nil
				s.completionToken = ""
				return true
			}
			if s.completions[s.highlight].Kind == "permission" {
				a.draft = k.Text()
				a.composerPickPermission(s, s.completions[s.highlight], k.Text())
				return true
			}
			if _, caret, ok := composerComplete(s, k.Text()); ok {
				s.pendingReplacement = &composerReplacement{Before: k.Text(), Start: s.completionStart, End: s.completionEnd, Text: s.completions[s.highlight].Replacement, Caret: caret}
				s.completions = nil
				s.completionToken = ""
				return true
			}
		}
		a.draft = k.Text()
		a.composerSubmit(k.Mods == ui.Cmd || k.Mods == ui.Ctrl)
		return true
	}
	if s.composing {
		return false
	}
	if len(s.completions) == 0 {
		return false
	}
	switch k.Key {
	case ui.KeyEscape:
		s.dismissedToken = s.completionToken
		s.completions = nil
		return true
	case ui.KeyDown:
		if k.Mods == 0 {
			s.highlight = (s.highlight + 1) % len(s.completions)
			return true
		}
	case ui.KeyUp:
		if k.Mods == 0 {
			s.highlight = (s.highlight + len(s.completions) - 1) % len(s.completions)
			return true
		}
	case ui.KeyTab:
		if k.Mods == 0 {
			if s.completions[s.highlight].Unavailable != "" {
				s.error = s.completions[s.highlight].Unavailable
				return true
			}
			if s.completions[s.highlight].Kind == "file-action" {
				a.composerChooseImages()
				s.pendingReplacement = &composerReplacement{Before: k.Text(), Start: s.completionStart, End: s.completionEnd, Caret: s.completionStart}
				s.completions = nil
				s.completionToken = ""
				return true
			}
			if s.completions[s.highlight].Kind == "permission" {
				a.draft = k.Text()
				a.composerPickPermission(s, s.completions[s.highlight], k.Text())
				return true
			}
			if _, caret, ok := composerComplete(s, k.Text()); ok {
				s.pendingReplacement = &composerReplacement{Before: k.Text(), Start: s.completionStart, End: s.completionEnd, Text: s.completions[s.highlight].Replacement, Caret: caret}
				s.completions = nil
				s.completionToken = ""
				return true
			}
		}
		if k.Mods == ui.Shift {
			s.dismissedToken = s.completionToken
			s.completions = nil
			return true
		}
	}
	return false
}

func composerComplete(s *composerState, text string) (string, int, bool) {
	if len(s.completions) == 0 || s.highlight < 0 || s.highlight >= len(s.completions) || s.completions[s.highlight].Unavailable != "" {
		return "", 0, false
	}
	r := []rune(text)
	if s.completionStart < 0 || s.completionEnd > len(r) || s.completionStart > s.completionEnd || string(r[s.completionStart:s.completionEnd]) != s.completionToken {
		return "", 0, false
	}
	replacement := s.completions[s.highlight].Replacement
	return string(r[:s.completionStart]) + replacement + string(r[s.completionEnd:]), s.completionStart + len([]rune(replacement)), true
}

func (a *app) composerCompletionView(c *ui.Context, s *composerState, input ui.Element) {
	if len(s.completions) == 0 || s.composing {
		return
	}
	open := true
	panel := ui.PopoverBase(c, input, &open, func(panel ui.Element) {
		panel.Width(420).MaxHeight(240).Radius(10).Border(.5, a.theme.Border).Background(a.colors.Popup)
		ui.Scroll(c).MaxHeight(240).Children(func() {
			ui.Column(c).FillWidth().Padding(4).Children(func() {
				for i, item := range s.completions {
					key := item.ID
					if key == "" {
						key = item.Kind + ":" + item.Replacement
					}
					row := ui.ButtonBase(c).Key(key).FillWidth().MinHeight(32).Padding(6, 8).Radius(6).Justify(ui.Start).Label(item.Label).Disabled(item.Unavailable != "").Children(func() {
						glyph := "code-outline"
						switch item.Kind {
						case "directory":
							glyph = "folder-open-outline"
						case "session":
							glyph = "new-chat-outline"
						case "file-action":
							glyph = "paperclip-outline"
						}
						icon(c, glyph, 16).Shrink(0).TextColor(a.theme.TextMuted)
						ui.Text(c, item.Label).FontSize(13).SingleLine()
						ui.Text(c, item.Description).FontSize(11).TextColor(a.theme.TextMuted).Grow(1).SingleLine()
					})
					if i == s.highlight {
						row.Background(a.colors.Selected)
					}
					if row.Clicked() {
						s.highlight = i
						if item.Kind == "file-action" {
							a.composerChooseImages()
							input.ReplaceText(s.completionStart, s.completionEnd, "")
							input.SetTextSelection(s.completionStart, s.completionStart)
							input.Focus()
							s.completions = nil
							s.completionToken = ""
							continue
						}
						if item.Kind == "permission" {
							a.composerPickPermission(s, item, a.draft)
							continue
						}
						if text, caret, ok := composerComplete(s, a.draft); ok {
							input.ReplaceText(0, len([]rune(a.draft)), text)
							input.SetTextSelection(caret, caret)
							input.Focus()
							s.completions = nil
							s.completionToken = ""
						}
					}
				}
			})
		})
	})
	if panel.Dismissed() {
		s.dismissedToken = s.completionToken
		s.completions = nil
	}
}

// pendingPanelView takes over the composer seat while an approval or question
// waits, matching the original conversation.composer overlay behavior.
func (a *app) pendingPanelView(c *ui.Context) {
	frame := ui.Row(c).Shrink(0).FillWidth().Justify(ui.Center).Padding(0, 16, 4)
	cardMax := a.chatContentWidth(c) + 32
	frame.Children(func() {
		ui.Column(c).FillWidth().Shrink(1).MinWidth(0).MaxWidth(cardMax).Children(func() {
			ui.Column(c).FillWidth().MinWidth(0).Padding(14, 16).Gap(12).Radius(28).
				InsetShadow(0, 0, 0, .5, a.theme.Border).Shadow(0, 8, 24, 0, ui.RGBA(0, 0, 0, .12)).
				Background(a.colors.Composer).Children(func() {
				for _, pending := range a.current.Pending {
					a.pendingView(c, pending)
				}
			})
		})
	})
}
