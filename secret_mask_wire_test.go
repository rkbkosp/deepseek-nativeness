package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// Masking is a display transform, exactly as the pinned upstream package
// documents it ("Masking changes only what is drawn; the message text, the copy
// action, and the model input keep the original characters"). These two tests
// hold both halves of that decision: the transcript masks the credential, and
// the prompt the Host receives still carries it verbatim. Rewriting the prompt
// would hand a build script `sk-********`.

func TestMaskedUserTextKeepsTheCredentialOnTheWire(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	draft := "rotate the key " + skKey + " please"
	tt := ui.NewTester(func(c *ui.Context) {
		a.composerView(c)
	}, 900, 600)
	if err := tt.Click("消息输入框"); err != nil {
		t.Fatal(err)
	}
	tt.Type(draft)
	if a.draft != draft {
		t.Fatalf("the composer text is not the original: %q", a.draft)
	}
	tt.Key(0, ui.KeyEnter)
	f.settle(t)
	tt.Frame()

	calls, _ := f.calls(t)
	var prompt struct {
		Mode    string
		Content []struct{ Text string }
	}
	found := false
	for _, call := range calls {
		if call.Endpoint != "session/prompt" {
			continue
		}
		found = true
		if err := json.Unmarshal(call.Args["request"], &prompt); err != nil {
			t.Fatal(err)
		}
	}
	if !found {
		t.Fatal("no prompt was sent")
	}
	if len(prompt.Content) != 1 {
		t.Fatalf("prompt content = %+v", prompt.Content)
	}
	// The wire keeps the original characters: no mask reached the Host.
	if prompt.Content[0].Text != draft {
		t.Fatalf("the wire text was rewritten: %q", prompt.Content[0].Text)
	}
	if !strings.Contains(prompt.Content[0].Text, skKey) {
		t.Fatalf("the credential is missing from the wire text: %q", prompt.Content[0].Text)
	}

	// The same message draws masked in the transcript, with the words around it
	// intact.
	view := newApp(true)
	t.Cleanup(view.cancel)
	view.sessionID = "s"
	view.current = snapshot{SessionID: "s", Messages: []message{{ID: "u", Role: "user", Text: draft, Turn: 1}}}
	vt := ui.NewTester(view.view, 1280, 820)
	vt.Frame()
	for _, text := range vt.Texts() {
		if strings.Contains(text, skKey) {
			t.Fatalf("the transcript shows the credential: %q", text)
		}
	}
	want := "rotate the key " + prefixedForm(skKey) + " please"
	if !vt.HasText(want) {
		t.Fatalf("the transcript is not masked as %q: %v", want, vt.Texts())
	}
}

// The credential a tool call carries is masked in the collapsed summary, in the
// command line and in the output, while the row still renders.
func TestMaskedToolRowHidesTheCredential(t *testing.T) {
	command := "curl -H 'Authorization: Bearer " + skKey + "' https://api.example.com"
	maskedCommand := "curl -H 'Authorization: Bearer " + prefixedForm(skKey) + "' https://api.example.com"

	// Collapsed: the summary is the command, drawn masked.
	summaryApp := newApp(true)
	t.Cleanup(summaryApp.cancel)
	summaryApp.sessionID = "s"
	summaryApp.uiPrefs.StepsDetail = "verbose"
	summaryApp.current = snapshot{SessionID: "s", Messages: []message{{
		ID: "t", Role: "tool", Kind: "tool", Turn: 1,
		Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":` + quoteJSON(command) + `}`},
	}}}
	summaryTester := ui.NewTester(summaryApp.view, 1280, 820)
	summaryTester.Frame()
	for _, text := range summaryTester.Texts() {
		if strings.Contains(text, skKey) {
			t.Fatalf("the collapsed summary shows the credential: %q", text)
		}
	}
	if !summaryTester.HasText(maskedCommand) {
		t.Fatalf("the summary is not masked in place: %v", summaryTester.Texts())
	}

	// Expanded: the command line and the output are masked too.
	bodyApp := newApp(true)
	t.Cleanup(bodyApp.cancel)
	bodyApp.sessionID = "s"
	bodyApp.uiPrefs.StepsDetail = "verbose"
	bodyApp.current = snapshot{SessionID: "s", Messages: []message{{
		ID: "t", Role: "tool", Kind: "tool", Turn: 1,
		Text: "HTTP/1.1 200 OK\nbody " + skKey,
		Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":` + quoteJSON(command) + `,"description":"call the API"}`},
	}}}
	tester := ui.NewTester(bodyApp.view, 1280, 820)
	tester.Frame()
	if !tester.HasText("call the API") {
		t.Fatalf("the summary is missing: %v", tester.Texts())
	}
	if err := tester.Click("运行命令"); err != nil {
		t.Fatalf("open the tool body: %v", err)
	}
	tester.Frame()
	for _, text := range tester.Texts() {
		if strings.Contains(text, skKey) {
			t.Fatalf("the expanded tool row shows the credential: %q", text)
		}
	}
	if !tester.HasText("$ " + maskedCommand) {
		t.Fatalf("the command line is not masked in place: %v", tester.Texts())
	}
	if !tester.HasText("HTTP/1.1 200 OK\nbody " + prefixedForm(skKey)) {
		t.Fatalf("the output is not masked in place: %v", tester.Texts())
	}
}

// quoteJSON renders a Go string as a JSON string literal for the args payload.
func quoteJSON(text string) string {
	encoded, err := json.Marshal(text)
	if err != nil {
		return `""`
	}
	return string(encoded)
}
