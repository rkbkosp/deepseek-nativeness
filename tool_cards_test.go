package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestReadCardShowsLinesAndCopy(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "read", Role: "tool", Kind: "tool", Turn: 1, Text: "package main\n\nfunc main() {}\n",
		Tool: &toolNode{Name: "read", Phase: "settled", ArgsRaw: `{"path":"main.go"}`,
			Meta: []byte(`{"path":"main.go","totalLines":3,"lang":"go","lines":[{"number":1,"text":"package main"},{"number":2,"text":""},{"number":3,"text":"func main() {}"}]}`)},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("读取"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("main.go") || !tt.HasText("3 行") || !tt.HasText("复制文件内容") || !tt.HasText("切换自动换行") || !tt.HasText("func main() {}") {
		t.Fatalf("read card texts: %v", tt.Texts())
	}
	if hasExactText(tt, "输入") {
		t.Fatalf("read card fell back to generic input: %v", tt.Texts())
	}
}

func TestSearchCardShowsMatchCount(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "grep", Role: "tool", Kind: "tool", Turn: 1,
		Tool: &toolNode{Name: "grep", Phase: "settled", ArgsRaw: `{"pattern":"TODO","path":"internal"}`,
			Meta: []byte(`{"shape":"matches","total":2,"truncated":false,"files":[{"path":"internal/x.go","matches":[{"lineNumber":4,"line":"// TODO: fix"},{"lineNumber":9,"line":"// TODO: later"}]}]}`)},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("搜索文件内容"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("2 处匹配") || !tt.HasText("internal/x.go") || !tt.HasText("// TODO: fix") {
		t.Fatalf("search card texts: %v", tt.Texts())
	}
}

func TestWebFetchCardShowsURLAndStatus(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "fetch", Role: "tool", Kind: "tool", Turn: 1,
		Tool: &toolNode{Name: "web_fetch", Phase: "settled", ArgsRaw: `{"url":"https://example.com"}`,
			Meta: []byte(`{"url":"https://example.com","statusCode":200,"truncated":false}`)},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("网页获取"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("https://example.com") || !tt.HasText("200") {
		t.Fatalf("web fetch card texts: %v", tt.Texts())
	}
}

func TestQuestionCardPairsTheRecordedAnswer(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "ask", Role: "tool", Kind: "tool", Turn: 1,
		Text: `{"answers":[{"id":"q1","selected":["安装本地插件"]}]}`,
		Tool: &toolNode{Name: "ask_user_question", Phase: "settled",
			ArgsRaw: `{"questions":[{"id":"q1","header":"安装目标","question":"你想安装哪一类？","options":[{"label":"安装本地插件"}]}]}`},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("提问"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("你想安装哪一类？") || !tt.HasText("回答：安装本地插件") {
		t.Fatalf("question card texts: %v", tt.Texts())
	}
}

func TestTruncatedSearchShowsTheFullResult(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "grep", Role: "tool", Kind: "tool", Turn: 1, Text: "full-result-token\nsecond line",
		Tool: &toolNode{Name: "grep", Phase: "settled", ArgsRaw: `{"pattern":"TODO"}`,
			Meta: []byte(`{"shape":"paths","total":12,"truncated":true,"paths":["a.go"]}`)},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("搜索文件内容"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("显示完整结果") {
		t.Fatalf("no full-result action: %v", tt.Texts())
	}
	if err := tt.Click("显示完整结果"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("full-result-token") {
		t.Fatalf("full result missing: %v", tt.Texts())
	}
}

func TestWorkflowCardShowsScriptAndReturn(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "wf", Role: "tool", Kind: "tool", Turn: 1,
		Text: "workflow \"audit\" completed (2 agents).\nReturn value:\nok",
		Tool: &toolNode{Name: "workflow", Phase: "settled", ArgsRaw: `{"code":"phase('x')"}`},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("工作流"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("workflow audit") && !tt.HasText("工作流 audit") {
		t.Fatalf("workflow title missing: %v", tt.Texts())
	}
	if !tt.HasText("2 个智能体") || !tt.HasText("phase('x')") || !tt.HasText("ok") {
		t.Fatalf("workflow details missing: %v", tt.Texts())
	}
}

func TestWorkflowPhaseNamesAreOrderedAndUnique(t *testing.T) {
	names := workflowPhaseNames(`phase("研究"); phase('实现'); phase("研究")`)
	if len(names) != 2 || names[0] != "研究" || names[1] != "实现" {
		t.Fatalf("phases = %v", names)
	}
}

func TestPlanCardRendersSubmittedPlan(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{{
		ID: "plan", Role: "tool", Kind: "tool", Turn: 1,
		Tool: &toolNode{Name: "exit_plan_mode", Phase: "settled", ArgsRaw: `{"plan":"# 计划\n\n- 第一步"}`},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("提交计划"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("计划") || !tt.HasText("第一步") {
		t.Fatalf("plan card texts: %v", tt.Texts())
	}
}
