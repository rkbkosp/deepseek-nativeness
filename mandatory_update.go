package main

import "github.com/egoist/mygo/ui"

// hostProtocol is the protocol this launch's runtime speaks; 0 means no local
// runtime is loaded, so a release cannot be called mandatory from here.
func (a *app) hostProtocol() int {
	if a.localRuntime != nil && a.localRuntime.payload != nil {
		return a.localRuntime.payload.HostProtocol
	}
	return 0
}

// updateIsMandatory reports a release that cannot run on the current runtime.
func updateIsMandatory(release updateRelease, protocol int) bool {
	return protocol > 0 && release.MinimumRuntimeHostProtocol > protocol
}

// mandatoryUpdateView blocks the app when the signed feed says this runtime is
// too old. There is deliberately no "later": the only action is the download
// page, which stays a user action rather than a silent download.
func (a *app) mandatoryUpdateView(c *ui.Context) {
	if a.mandatoryUpdate == nil {
		return
	}
	release := *a.mandatoryUpdate
	ui.Box(c).Absolute().Fill().Background(ui.RGBA(0, 0, 0, .62)).IgnoreInput(false)
	ui.Column(c).Absolute().Left(0).Right(0).Top(0).Bottom(0).Justify(ui.Center).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Width(460).Padding(24).Gap(14).Radius(16).Border(1, ui.Hex("#38383a")).Background(a.colors.Popup).Children(func() {
			ui.Text(c, "需要更新后才能继续").FontSize(18).FontWeight(500)
			ui.Text(c, "当前版本 "+currentAppVersion().String()+"，这个版本要求运行时协议 "+itoa(release.MinimumRuntimeHostProtocol)+"。").FontSize(12).TextColor(a.colors.Caption).Wrap()
			ui.Text(c, updateOfferDetail(release, currentAppVersion())).FontSize(12).TextColor(a.colors.Secondary).Wrap()
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.PrimaryButton(c, "打开下载页").Clicked() {
					a.openUpdateDownloadPage(release)
				}
			})
		})
	})
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	digits := []byte{}
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}

// restoreMandatoryUpdate re-arms a mandatory update persisted by an earlier
// launch, so a reload cannot bypass the block.
func (a *app) restoreMandatoryUpdate() {
	if a.mandatoryRestored {
		return
	}
	a.mandatoryRestored = true
	if updatePrefs.Mandatory == nil {
		return
	}
	if updateIsMandatory(*updatePrefs.Mandatory, a.hostProtocol()) {
		a.mandatoryUpdate = updatePrefs.Mandatory
	}
}
