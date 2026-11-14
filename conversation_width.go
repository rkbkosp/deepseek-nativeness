package main

import "github.com/egoist/mygo/ui"

func (a *app) conversationColumnWidth(c *ui.Context) float32 {
	width, _ := c.Size()
	column := width - a.sidebarShown*280
	if a.rightPaneOpen && (a.web == nil || a.webPlacement == "right") && (a.compat == nil || a.compatPlacement != "main") {
		column -= min(576, width*.45)
	}
	return column
}

// ConversationRoot's shared default axis, bounded by the actual column.
func (a *app) chatContentWidth(c *ui.Context) float32 {
	column := a.conversationColumnWidth(c)
	return max(0, min(column-64, max(680, min(920, column*.64))))
}
