package main

import (
	"strings"
	"testing"
)

func TestQuotaNoticeRecognizesCodesAndCopy(t *testing.T) {
	for _, body := range []string{"Request quota exhausted.", "balance", "请求额度已用尽", "余额不足"} {
		if !quotaNotice(body) {
			t.Fatalf("quota notice missed %q", body)
		}
	}
	if quotaNotice("network unreachable") {
		t.Fatal("network error was classified as quota")
	}
}

func TestExhaustedRecoveryOpensTheFatalDialog(t *testing.T) {
	a := &app{}
	local := &localRuntime{native: true}
	a.localRuntime = local
	a.applyLocalStatus(local, runtimeStatus{Phase: runtimePhaseFailed, Message: "本地 Host 连续 5 次异常退出，已停止自动重启。"})
	if a.fatalLocal == "" {
		t.Fatal("exhausted recovery did not mark the fatal dialog")
	}
	a.applyLocalStatus(local, runtimeStatus{Phase: runtimePhaseReady})
	if a.fatalLocal != "" {
		t.Fatal("ready did not clear the fatal dialog")
	}
}

func TestCrashReportNamesFailureAndRestarts(t *testing.T) {
	a := &app{fatalLocal: "Host 连续退出"}
	a.localRuntime = &localRuntime{restarts: 3, lastRestart: "SIGKILL", hostPid: 42, home: "/tmp/dsh-home", phases: []string{"starting", "failed"}}
	report := a.crashReport()
	for _, want := range []string{"Host 连续退出", "restarts: 3", "SIGKILL", "hostPid: 42", "phase[1]: failed"} {
		if !strings.Contains(report, want) {
			t.Fatalf("report missing %q:\n%s", want, report)
		}
	}
}
