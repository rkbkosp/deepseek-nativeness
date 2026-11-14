package main

import "github.com/egoist/mygo/ui"

// ConversationRoot's shared default axis. The minimum is a preferred measure,
// bounded by the actual column so split panes remain horizontally reachable.
func (a *app) chatContentWidth(c *ui.Context) float32 {
	width, _ := c.Size()
	column := width - a.sidebarShown*280
	if a.rightPaneOpen && (a.web == nil || a.webPlacement == "right") && (a.compat == nil || a.compatPlacement != "main") {
		column -= min(576, width*.45)
	}
	return max(0, min(column-64, max(680, min(920, column*.64))))
}
