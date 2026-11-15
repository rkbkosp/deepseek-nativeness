package main

import (
	"encoding/json"
	"fmt"

	"github.com/egoist/mygo/ui"
)

func (a *app) historyRowView(c *ui.Context) {
	label := "加载更早"
	if a.historyLoading {
		label = "正在加载…"
	} else if a.historyError != "" {
		label = "加载失败，点击重试"
	}
	ui.Row(c).FillWidth().Justify(ui.Center).Children(func() {
		button := ui.ButtonBase(c).Label(label).Height(28).Padding(4, 12).Radius(8).Background(a.colors.Subtle)
		if a.historyLoading {
			button.Disabled(true)
		}
		button.Children(func() {
			ui.Text(c, label).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary)
		})
		if button.Clicked() && !a.historyLoading {
			a.loadOlderHistory()
		}
	})
}

func (a *app) loadOlderHistory() {
	if a.historyLoading || !a.current.HasMore || a.sessionID == "" {
		return
	}
	a.historyLoading = true
	a.historyError = ""
	a.list.HoldPlace()
	session := a.sessionID
	a.scopedRequest("history", map[string]any{"sessionId": session}, func(raw json.RawMessage) error {
		if a.sessionID != session {
			return nil
		}
		var s snapshot
		if err := json.Unmarshal(raw, &s); err != nil {
			a.historyLoading = false
			a.historyError = err.Error()
			return nil
		}
		a.historyLoading = false
		if s.SessionID == "" {
			s.SessionID = session
		}
		if !a.adoptHistorySnapshot(s) {
			a.historyLoading = false
			a.historyError = "历史加载结果已过期，请重试"
		}
		return nil
	}, func(err error) {
		if a.sessionID == session {
			a.historyLoading = false
			a.historyError = err.Error()
		}
	})
}

func (a *app) toBottomView(c *ui.Context) {
	if a.builds < 2 || a.list.AtEnd() {
		return
	}
	button := ui.ButtonBase(c).Absolute().Right(24).Bottom(16).Size(34, 34).Radius(17).
		Background(a.colors.Popup).Shadow(0, 4, 12, 0, ui.RGBA(0, 0, 0, .18)).Label("回到底部").Tooltip("回到底部")
	button.Children(func() {
		icon(c, "chevron-down-outline", 16).TextColor(a.colors.Secondary)
	})
	if button.Clicked() {
		a.list.FollowEnd = true
		a.list.ScrollToEnd()
		c.Invalidate()
	}
}

func (a *app) turnRailView(c *ui.Context, rows []chatRow) {
	first := map[int]int{}
	var turns []int
	for i := range rows {
		r := rows[i]
		if r.History || r.Running || r.Turn == 0 {
			continue
		}
		if _, ok := first[r.Turn]; !ok {
			first[r.Turn] = i
			turns = append(turns, r.Turn)
		}
	}
	if len(turns) < 2 {
		return
	}
	active := turns[len(turns)-1]
	if visibleFirst, _ := a.list.Visible(); visibleFirst >= 0 && visibleFirst < len(rows) && rows[visibleFirst].Turn > 0 {
		active = rows[visibleFirst].Turn
	}
	rail := ui.Column(c).Absolute().Right(6).TopPercent(35).Gap(10).AlignItems(ui.Center)
	rail.Children(func() {
		for _, turn := range turns {
			row := first[turn]
			color := a.colors.Caption
			if turn == active {
				color = a.colors.Link
			}
			button := ui.ButtonBase(c).Size(18, 10).Padding(0).Label(fmt.Sprintf("跳转到第 %d 轮", turn)).Tooltip(fmt.Sprintf("第 %d 轮", turn))
			button.Children(func() {
				ui.Box(c).Size(10, 2).Radius(1).Background(color)
			})
			if button.Clicked() {
				a.list.ScrollTo(row, ui.Start)
				c.Invalidate()
			}
		}
	})
}
