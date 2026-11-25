package main

import (
	"fmt"

	"github.com/egoist/mygo/ui"
)

type goalSnapshot struct {
	ID            string `json:"id"`
	Revision      int    `json:"revision"`
	Objective     string `json:"objective"`
	Phase         string `json:"phase"`
	MaxGoalRounds int    `json:"maxGoalRounds"`
}

type goalProjection struct {
	Goal          *goalSnapshot `json:"goal"`
	RoundsStarted int           `json:"roundsStarted"`
}

// goalBarView is the dock entry above the composer: an active, paused or
// blocked goal names its objective; a complete or absent goal draws nothing.
func (a *app) goalBarView(c *ui.Context, s *composerState) {
	projection := s.values.Goal
	if projection == nil || projection.Goal == nil {
		return
	}
	goal := projection.Goal
	if goal.Phase == "" || goal.Phase == "complete" {
		return
	}
	phase := "进行中的目标"
	switch goal.Phase {
	case "paused":
		phase = "目标已暂停"
	case "blocked":
		phase = "目标受阻"
	}
	ui.Row(c).FillWidth().MinWidth(0).Padding(8, 12).Gap(10).Radius(12).Border(1, a.theme.Border).Background(a.theme.Surface).AlignItems(ui.Center).Children(func() {
		icon(c, "goal-outline", 16).TextColor(a.theme.Accent)
		ui.Column(c).Gap(1).Grow(1).MinWidth(0).Children(func() {
			ui.Row(c).Gap(8).Children(func() {
				ui.Text(c, phase).FontSize(11).TextColor(a.colors.Caption)
				if goal.MaxGoalRounds > 0 {
					ui.Text(c, fmt.Sprintf("%d/%d 轮", projection.RoundsStarted, goal.MaxGoalRounds)).FontSize(11).TextColor(a.colors.Caption)
				}
			})
			ui.Text(c, maskSecrets(goal.Objective)).FontSize(12).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…")
		})
		ref := map[string]any{"id": goal.ID, "revision": goal.Revision}
		if a.can("editGoal") {
			if ui.ButtonBase(c).Padding(3).Label("编辑目标").Tooltip("编辑").Children(func() { icon(c, "edit-outline", 13).TextColor(a.colors.Caption) }).Clicked() {
				goal := *goal
				a.goalEdit = &goal
				a.goalEditText = goal.Objective
			}
		}
		if goal.Phase == "active" && a.can("pauseGoal") {
			if ui.ButtonBase(c).Padding(3).Label("暂停目标").Tooltip("暂停").Children(func() { icon(c, "pause-outline", 13).TextColor(a.colors.Caption) }).Clicked() {
				a.mutate("pauseGoal", map[string]any{"sessionId": a.sessionID, "ref": ref}, nil)
			}
		} else if goal.Phase != "active" && a.can("resumeGoal") {
			if ui.ButtonBase(c).Padding(3).Label("继续目标").Tooltip("继续").Children(func() { icon(c, "play-outline", 13).TextColor(a.colors.Caption) }).Clicked() {
				a.mutate("resumeGoal", map[string]any{"sessionId": a.sessionID, "ref": ref}, nil)
			}
		}
		if a.can("clearGoal") {
			if ui.ButtonBase(c).Padding(3).Label("清除目标").Tooltip("清除").Children(func() { icon(c, "close-outline", 13).TextColor(a.colors.Caption) }).Clicked() {
				a.mutate("clearGoal", map[string]any{"sessionId": a.sessionID, "ref": ref}, nil)
			}
		}
	})
}
