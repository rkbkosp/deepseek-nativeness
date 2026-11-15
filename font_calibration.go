package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
)

func (a *app) fontCalibrationView(c *ui.Context) {
	ui.Column(c).Fill().Padding(54, 24, 24).Gap(24).Background(a.theme.Background).Children(func() {
		ui.Text(c, "本地字体校准 · 14 DIP · system-ui, PingFang SC").FontSize(18).FontWeight(400)
		ui.Text(c, "四列仅用于与原版截图比较字重；不更改已保存偏好。字号、前景和字体相同。").FontSize(14).FontWeight(400).TextColor(a.theme.TextMuted)
		ui.Row(c).Grow(1).AlignItems(ui.Stretch).Gap(16).Children(func() {
			for _, weight := range []int{300, 350, 400, 450} {
				ui.Column(c.Key(weight)).Grow(1).MinWidth(0).Padding(14).Gap(20).Border(1, a.theme.Border).Radius(10).Font("system-ui, PingFang SC").FontWeight(weight).FontSize(14).Children(func() {
					ui.Text(c, fmt.Sprintf("Weight %d", weight)).FontSize(16)
					for _, line := range []string{"工作区", "本地界面使用方法", "运行模式", "插件版本", "配对安装包", "manifest", productName, "DeepSeek-Flash · Qoder CN Default", "已完成会话  12分钟前"} {
						ui.Text(c, line).SingleLine()
					}
					ui.Text(c, "中文正文保持常规字重。This is regular body text, with Latin and 中文 mixed in one paragraph.").Wrap().LineHeight(1.7)
				})
			}
		})
	})
}
