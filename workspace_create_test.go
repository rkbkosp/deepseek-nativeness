package main

import "testing"

func TestWorkspaceCreateRequiresHostAbsolutePath(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	s := a.workspaceEditor()
	s.Path = "   "
	a.createWorkspace()
	if s.Error == "" || a.workspaceCreate == nil {
		t.Fatalf("blank path accepted: error=%q", s.Error)
	}
	s.Path = "projects/app"
	a.createWorkspace()
	if s.Error != "请填写主机上的绝对路径。" {
		t.Fatalf("relative path accepted: error=%q", s.Error)
	}
}

func TestWorkspaceCreateListsHostDirectoriesAndSelectsCreated(t *testing.T) {
	f := startFixtureApp(t)
	f.wait(t, "createWorkspace capability", func() bool {
		return f.a.operationCaps["createWorkspace"].Supported && !f.a.busy
	})

	f.do(func() { f.a.openWorkspaceCreate() })
	f.wait(t, "host home listing", func() bool {
		s := f.a.workspaceCreate
		return s != nil && s.Listed && !s.Loading && s.Path == "/fixture"
	})
	if entries := f.read(func() any { return len(f.a.workspaceCreate.Listing.Entries) }); entries != 1 {
		t.Fatalf("home listing entries = %v", entries)
	}

	f.do(func() {
		f.a.workspaceCreate.Path = "/fixture/work"
		f.a.createWorkspace()
	})
	f.wait(t, "created workspace selection", func() bool {
		return f.a.workspaceCreate == nil && f.a.workspaceID == "fixture-workspace-created" && !f.a.busy
	})

	if errText := f.read(func() any { return f.a.error }); errText != "" {
		t.Fatalf("create reported error %v", errText)
	}
	names := f.read(func() any {
		out := make([]string, 0, len(f.a.workspaces))
		for _, w := range f.a.workspaces {
			out = append(out, w.ID+" "+w.Name)
		}
		return out
	}).([]string)
	found := false
	for _, row := range names {
		if row == "fixture-workspace-created work" {
			found = true
		}
	}
	if !found {
		t.Fatalf("created workspace missing from the refreshed registry: %v", names)
	}
}
