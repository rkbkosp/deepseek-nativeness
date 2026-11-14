package main

import (
	"encoding/base64"
	"fmt"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

func (a *app) composerAttachmentRail(c *ui.Context) {
	state := a.composerArtifacts()
	if len(state.Images) == 0 && !state.Loading && state.Error == "" {
		return
	}
	ui.Column(c).FillWidth().MinWidth(0).Padding(2, 10, 0).Margin(0, 0, -6).Gap(4).Children(func() {
		if len(state.Images) > 0 {
			rail := ui.ScrollHorizontal(c).FillWidth().Height(64).Gap(8).Scrollbars(false).TrackScroll(&state.RailScroll)
			width := rail.LayoutBounds().W
			if width <= 0 {
				width = 712
			}
			first, last := max(0, int(state.RailScroll.X/72)-1), int((state.RailScroll.X+width)/72)+1
			rail.Children(func() {
				for index, img := range state.Images {
					if index >= first && index <= last {
						a.composerLoadThumbnail(state, img.ID)
					}
					img := img
					item := ui.Box(c.Key(img.ID)).Size(64, 64).Shrink(0)
					item.Children(func() {
						if ui.ButtonBase(c).Size(64, 64).Radius(16).Clip().Border(.5, a.theme.Border).Label("预览图片 " + img.Name).Tooltip(fmt.Sprintf("%s · %d×%d", img.Name, img.Width, img.Height)).Children(func() { ui.Image(c, img.Preview).Size(64, 64).Fit(ui.Cover) }).Clicked() {
							a.composerPreviewImage(state, img)
						}
						remove := ui.ButtonBase(c).Size(18, 18).Absolute().Top(4).Right(4).Radius(9).Background(a.theme.Text).Label("移除图片 " + img.Name).Disabled(a.busy)
						if item.Hovered() || remove.Focused() {
							remove.Opacity(1)
						} else {
							remove.Opacity(0)
						}
						if remove.Children(func() { icon(c, "close-fill", 12).TextColor(a.theme.Background) }).Clicked() {
							a.composerRemoveImage(state, img.ID)
						}
					})
				}
			})
		}
		if state.Loading {
			ui.Text(c, "正在读取图片…").FontSize(12).TextColor(a.theme.TextMuted)
		}
		if state.Error != "" {
			ui.Text(c, state.Error).FontSize(12).Wrap().TextColor(ui.Hex("#bf5b57"))
		}
	})
}
func (a *app) composerRemoveImage(state *composerDraftState, id string) {
	for i, img := range state.Images {
		if img.ID == id {
			copy(state.Images[i:], state.Images[i+1:])
			clear(state.Images[len(state.Images)-1:])
			state.Images = state.Images[:len(state.Images)-1]
			break
		}
	}
	if state.PreviewID == id {
		state.PreviewID = ""
		state.Preview = nil
	}
}
func (a *app) composerPreviewImage(state *composerDraftState, img composerDraftImage) {
	if state.PreviewLoading {
		return
	}
	state.PreviewLoading = true
	epoch := state.ThumbnailEpoch
	state.PreviewID = img.ID
	state.Preview = nil
	go func() {
		raw, err := base64.StdEncoding.DecodeString(img.Data)
		var preview ui.ImageSource
		if err == nil {
			preview, err = composerThumbnail(raw, 480)
		}
		a.update(func() {
			state.PreviewLoading = false
			if state.ThumbnailEpoch != epoch || state.PreviewID != img.ID {
				return
			}
			if err != nil {
				state.Error = "无法打开图片预览。"
				state.PreviewID = ""
				return
			}
			state.Preview = preview
		})
	}()
}
func (a *app) composerImageLightbox(c *ui.Context) {
	state := a.composerArtifacts()
	if state.PreviewID == "" {
		return
	}
	var chosen *composerDraftImage
	for i := range state.Images {
		if state.Images[i].ID == state.PreviewID {
			chosen = &state.Images[i]
			break
		}
	}
	if chosen == nil {
		state.PreviewID = ""
		state.Preview = nil
		return
	}
	width, height := c.Size()
	open := true
	ui.Modal(c, &open, func() {
		ui.Row(c).Height(32).Shrink(0).Gap(8).Children(func() {
			ui.Text(c, chosen.Name).SingleLine().Grow(1)
			if ui.ButtonBase(c).Size(28, 28).Label("关闭图片预览").Children(func() { icon(c, "close-outline", 16) }).Clicked() {
				open = false
			}
		})
		if state.Preview == nil {
			ui.Box(c).Size(width-88, height-132).Center().Children(func() { ui.Text(c, "正在打开图片…") })
		} else {
			ui.Image(c, state.Preview).Size(width-88, height-132).Fit(ui.Contain)
		}
	}).Width(width - 64).Height(height - 64).Padding(12).Gap(12).Clip()
	if !open {
		state.PreviewID = ""
		state.Preview = nil
	}
}
func (a *app) composerPasteImages(s *composerState, data transfer.Data, text string) bool {
	if !a.composerCurrent(s) || !a.connected || a.busy || !s.values.ImageLimits.available() {
		return false
	}
	items := data.Items()
	if len(items) == 0 {
		return false
	}
	state := a.composerArtifacts()
	if state.Loading {
		state.Error = "图片仍在读取，请稍候。"
		return true
	}
	if len(state.Images)+len(items) > s.values.ImageLimits.MaxImagesPerMessage {
		state.Error = "添加后图片数量超过当前会话限制。"
		return true
	}
	limits := *s.values.ImageLimits
	limits.MediaTypes = append([]string(nil), limits.MediaTypes...)
	state.Loading = true
	state.Error = ""
	existingBytes := int64(0)
	for _, img := range state.Images {
		existingBytes += img.Bytes
	}
	if text != "" {
		s.pendingPasteText = text
	}
	go func() {
		added := []composerDraftImage{}
		total := existingBytes
		var failure error
		for i, item := range items {
			raw, err := item.Read(transfer.PNG)
			if err != nil {
				failure = fmt.Errorf("无法读取粘贴的图片。")
				break
			}
			img, err := composerDecodeDraftImage(raw, fmt.Sprintf("粘贴的图片-%d.png", i+1), &limits)
			if err != nil {
				failure = err
				break
			}
			total += img.Bytes
			if total > limits.MaxMessageImageBytes {
				failure = fmt.Errorf("图片总大小超过当前会话限制。")
				break
			}
			added = append(added, img)
		}
		a.update(func() {
			state.Loading = false
			if !a.composerCurrent(s) {
				return
			}
			if failure != nil {
				state.Error = failure.Error()
				return
			}
			state.Images = append(state.Images, added...)
		})
	}()
	return true
}
