package main

import "testing"

func TestBackgroundJobsListsRunningAndSettled(t *testing.T) {
	a := &app{current: snapshot{Messages: []message{
		{ID: "a", Tool: &toolNode{CallID: "c1", Name: "bash", Phase: "running", ArgsRaw: `{"command":"sleep 1","description":"等待","run_in_background":true}`}},
		{ID: "b", Text: "started background job job-7\n", Tool: &toolNode{CallID: "c2", Name: "bash", Phase: "settled", ArgsRaw: `{"command":"echo hi","run_in_background":true}`}},
		{ID: "c", Tool: &toolNode{CallID: "c3", Name: "bash", Phase: "settled", ArgsRaw: `{"command":"ls"}`}},
	}}}
	jobs := a.backgroundJobs()
	if len(jobs) != 2 {
		t.Fatalf("jobs = %+v", jobs)
	}
	if jobs[0].Status != "运行中" || jobs[1].Status != "已完成" {
		t.Fatalf("statuses = %q %q", jobs[0].Status, jobs[1].Status)
	}
	if jobs[0].Description != "等待" || jobs[1].Command != "echo hi" {
		t.Fatalf("labels = %+v", jobs)
	}
	if jobs[1].JobID != "job-7" {
		t.Fatalf("job id = %q", jobs[1].JobID)
	}
	if jobs[1].FullOutput != "started background job job-7" {
		t.Fatalf("full output = %q", jobs[1].FullOutput)
	}
}
