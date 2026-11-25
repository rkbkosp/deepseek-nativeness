package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateDroppedImagePathsRejectsFolders(t *testing.T) {
	dir := t.TempDir()
	if err := validateDroppedImagePaths([]string{dir}); err == nil {
		t.Fatal("folder accepted")
	}
	file := filepath.Join(dir, "a.png")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateDroppedImagePaths([]string{file}); err != nil {
		t.Fatal(err)
	}
}

func TestComposerUploadParamsUseHelperContract(t *testing.T) {
	params := composerUploadParams("s1", "/tmp/a.txt", "a.txt", "upload-1234567890123456")
	if params["sessionId"] != "s1" || params["localPath"] != "/tmp/a.txt" || params["name"] != "a.txt" || params["requestId"] != "upload-1234567890123456" {
		t.Fatalf("params = %v", params)
	}
}

func TestComposerImagePayloadSendsFilesWithoutImageLimits(t *testing.T) {
	a := &app{draft: "hello", sessionID: "s1"}
	state := a.composerArtifacts()
	state.Files = []composerDraftFile{{ID: "r1", Name: "a.txt", ReceiptID: "r1", Bytes: 1}}
	parts, ids, err := a.composerImagePayload()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 || len(parts) != 2 {
		t.Fatalf("parts=%v ids=%v", parts, ids)
	}
	if parts[0].Type != "text" || parts[1].Type != "file" || parts[1].ReceiptID != "r1" {
		t.Fatalf("parts = %+v", parts)
	}
}

func TestComposerSplitDroppedPathsRoutesImagesAndFiles(t *testing.T) {
	dir := t.TempDir()
	png := filepath.Join(dir, "a.png")
	txt := filepath.Join(dir, "b.txt")
	os.WriteFile(png, []byte("x"), 0o600)
	os.WriteFile(txt, []byte("x"), 0o600)
	images, files, err := composerSplitDroppedPaths([]string{png, txt})
	if err != nil || len(images) != 1 || len(files) != 1 {
		t.Fatalf("images=%v files=%v err=%v", images, files, err)
	}
	nested := filepath.Join(dir, "nested")
	os.Mkdir(nested, 0o700)
	os.WriteFile(filepath.Join(nested, "c.txt"), []byte("x"), 0o600)
	if _, collected, err := composerSplitDroppedPaths([]string{nested}); err != nil || len(collected) != 1 {
		t.Fatalf("directory collect = %v %v", collected, err)
	}
	empty := t.TempDir()
	if _, _, err := composerSplitDroppedPaths([]string{empty}); err == nil {
		t.Fatal("empty directory accepted")
	}
}

func TestComposerImagePayloadUsesPathMentionForWorkspaceUploads(t *testing.T) {
	a := &app{draft: "hello", sessionID: "s1"}
	state := a.composerArtifacts()
	state.Files = []composerDraftFile{{ID: "p", Name: "a.txt", Path: "/tmp/a.txt", Bytes: 1}}
	parts, _, err := a.composerImagePayload()
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 1 || parts[0].Type != "text" || !strings.Contains(parts[0].Text, "@/tmp/a.txt") {
		t.Fatalf("parts = %+v", parts)
	}
}
