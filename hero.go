package main

import "github.com/egoist/mygo/ui"

// heroView is the original blank-Session chrome: the fish mark, the headline,
// and the preview badge centered above the composer.
func (a *app) heroView(c *ui.Context) {
	ui.Column(c).Grow(1).MinHeight(0).Center().Padding(24).Children(func() {
		ui.Column(c).FillWidth().MaxWidth(a.chatContentWidth(c) + 64).Gap(12).Children(func() {
			ui.Row(c).Center().Gap(10).AlignItems(ui.Center).Children(func() {
				icon(c, "fish-logo", 34).TextColor(a.theme.Text)
				ui.Text(c, "探索未至之境").FontSize(26).FixedLineHeight(32).FontWeight(500).TextColor(a.theme.Text)
				ui.Text(c, "预览版").Font("SF Mono, Menlo").FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary).
					Padding(1, 7).Radius(999).Border(.5, a.theme.Border).Background(a.colors.Subtle)
			})
			a.composerView(c)
		})
	})
}

func (a *app) composerPlaceholder() string {
	switch a.conversationPlaceholder() {
	case conversationEmpty, conversationNoSession:
		return "描述你想要构建的内容, / 调用指令, @ 文件或对话"
	default:
		return "发消息或创建任务, / 调用指令, @ 文件或对话"
	}
}
