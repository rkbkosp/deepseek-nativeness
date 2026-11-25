package main

import "github.com/egoist/mygo/ui"

// updateDialogView replaces the platform message box with the app's own sheet:
// the offer names both versions, keeps the release notes readable, and never
// downloads or installs without another explicit step.
func (a *app) updateDialogView(c *ui.Context) {
	if !a.updateOfferOpen || a.updateOffer == nil {
		return
	}
	open := true
	release := *a.updateOffer
	current := currentAppVersion().String()
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(480).Padding(22).Gap(14).Children(func() {
			ui.Text(c, "发现新版本 "+release.Version).FontSize(17).FontWeight(500)
			ui.Text(c, "当前版本 "+current).FontSize(12).TextColor(a.colors.Caption)
			ui.Text(c, updateOfferDetail(release, currentAppVersion())).FontSize(12).TextColor(a.colors.Secondary).Wrap()
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "稍后").Clicked() {
					open = false
				}
				if ui.Button(c, "复制链接").Clicked() {
					a.copyUpdateDownloadLink(release)
					open = false
				}
				if ui.PrimaryButton(c, "打开下载页").Clicked() {
					a.openUpdateDownloadPage(release)
					open = false
				}
			})
		})
	})
	if !open {
		a.updateOfferOpen = false
		a.updateOffer = nil
	}
}
