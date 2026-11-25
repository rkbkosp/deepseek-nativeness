package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/egoist/mygo/ui"
)

func (a *app) backgroundJobCount() int {
	count := 0
	for i := range a.current.Messages {
		tool := a.current.Messages[i].Tool
		if tool == nil || tool.ArgsRaw == "" {
			continue
		}
		var args map[string]any
		if json.Unmarshal([]byte(tool.ArgsRaw), &args) != nil {
			continue
		}
		if background, ok := args["run_in_background"].(bool); ok && background {
			count++
		}
	}
	return count
}

func (a *app) headerTerminalView(c *ui.Context) {
	if !a.can("listTerminals") {
		return
	}
	if ui.ButtonBase(c).Label("终端").Padding(4).Children(func() { icon(c, "code-outline", 15).TextColor(a.colors.Tertiary) }).Clicked() {
		a.rightPaneOpen = true
		a.openCompatAt("terminal", "right")
	}
}

type backgroundJob struct {
	ID          string
	JobID       string
	Command     string
	Description string
	Status      string
	Output      string
	FullOutput  string
}

var backgroundJobID = regexp.MustCompile(`\bjob-[A-Za-z0-9_-]+\b`)

func (a *app) backgroundJobs() []backgroundJob {
	var jobs []backgroundJob
	for i := range a.current.Messages {
		m := &a.current.Messages[i]
		tool := m.Tool
		if tool == nil || tool.ArgsRaw == "" {
			continue
		}
		var args map[string]any
		if json.Unmarshal([]byte(tool.ArgsRaw), &args) != nil {
			continue
		}
		background, _ := args["run_in_background"].(bool)
		if !background {
			continue
		}
		command, _ := args["command"].(string)
		description, _ := args["description"].(string)
		status := "已完成"
		switch {
		case tool.Phase == "preparing" || tool.Phase == "running":
			status = "运行中"
		case tool.IsError:
			status = "失败"
		}
		output := strings.TrimSpace(m.Text)
		jobID := ""
		if match := backgroundJobID.FindString(output); match != "" {
			jobID = match
		} else if match := backgroundJobID.FindString(string(tool.Content)); match != "" {
			jobID = match
		}
		if len(output) > 240 {
			output = output[:240] + "…"
		}
		jobs = append(jobs, backgroundJob{ID: tool.CallID, JobID: jobID, Command: command, Description: description, Status: status, Output: output, FullOutput: strings.TrimSpace(m.Text)})
	}
	return jobs
}

func (a *app) headerJobsView(c *ui.Context) {
	jobs := a.backgroundJobs()
	if len(jobs) == 0 {
		return
	}
	open := a.foldState("jobs", false)
	anchor := ui.ButtonBase(c).Height(22).Padding(0, 4).Gap(4).AlignItems(ui.Center).Label(fmt.Sprintf("%d 个后台任务", len(jobs))).Children(func() {
		icon(c, "layers-outline", 14).TextColor(a.colors.Tertiary)
		ui.Text(c, fmt.Sprintf("%d", len(jobs))).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Tertiary)
	})
	ui.PopoverBase(c, anchor, open, func(panel ui.Element) {
		panel.Width(340).Padding(12).Radius(12).Background(a.colors.Popup).Border(1, a.theme.Border).Gap(8)
		ui.Text(c, "后台任务").FontSize(12).FontWeight(500)
		for _, job := range jobs {
			ui.Column(c).Gap(2).Padding(6).Radius(8).Background(a.colors.CodeBlock).Children(func() {
				label := job.Description
				if label == "" {
					label = job.Command
				}
				if label == "" {
					label = job.ID
				}
				ui.Text(c, label).FontSize(12).SingleLine().Ellipsis("…")
				ui.Text(c, job.Status).FontSize(11).TextColor(a.colors.Tertiary)
				if job.Output != "" {
					ui.Text(c, job.Output).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Wrap()
				}
				if job.FullOutput != "" {
					if ui.ButtonBase(c).Padding(0).Label("查看输出 " + job.ID).Children(func() {
						ui.Text(c, "查看输出").FontSize(11).TextColor(a.colors.Tertiary)
					}).Clicked() {
						job := job
						a.jobDetail = &job
					}
				}
				if job.JobID != "" && a.can("killJob") {
					if ui.ButtonBase(c).Padding(0).Label("取消任务 " + job.JobID).Children(func() {
						ui.Text(c, "取消任务").FontSize(11).TextColor(a.colors.Tertiary)
					}).Clicked() {
						a.mutate("killJob", map[string]any{"sessionId": a.sessionID, "jobId": job.JobID}, nil)
					}
				}
			})
		}
	})
}
