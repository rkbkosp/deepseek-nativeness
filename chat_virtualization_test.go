package main

import (
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"testing"
	"time"
)

func TestOpenPresentationBuildsOnlyViewportPartsThroughActualView(t *testing.T) {
	for _, n := range []int{1000, 10000} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			a := newApp(true)
			defer a.cancel()
			a.sessionID = "virtual-open"
			a.current = snapshot{SessionID: a.sessionID, Running: true}
			a.uiPrefs.FoldedReplies = "final"
			a.uiPrefs.StepsDetail = "verbose"
			p := &chatPresentation{SchemaVersion: 1, BaselineSerial: 1, PresentationEpoch: "chat:1", Turns: []chatTurn{{Turn: 1, Status: "open", StartLoaded: true, FoldEligible: true, AlwaysOpen: true, Spec: &chatProcessSpec{Turn: 1, ControlAnchorSeq: 1, ProcessStartSeq: 1}}}}
			for i := 0; i < n; i++ {
				id := fmt.Sprintf("body:%d", i)
				text := fmt.Sprintf("visible part %d", i)
				a.current.Messages = append(a.current.Messages, message{ID: id, Role: "assistant", Kind: "assistant", Turn: 1, Step: i + 1, Seq: int64(i + 2), Text: text, AssistantBlocks: []assistantBlock{{Kind: "text", Text: text}}})
				p.Steps = append(p.Steps, chatStep{NodeKey: id, PayloadID: id, Turn: 1, Step: i + 1, AnchorSeq: float64(i + 2), Status: "settled", HasReply: true})
			}
			a.current.ChatPresentation = p
			a.reindexMessages()
			frozen := time.Duration(0)
			a.metrics.FixedTime = &frozen
			unique := map[string]bool{}
			a.testChatPartBuild = func(key, part string) { unique[key+":"+part] = true }
			tt := ui.NewTester(a.view, 1280, 820)
			before := a.metrics.MessagePartBuilds
			tt.Frame()
			cold := a.metrics.MessagePartBuilds - before
			coldUnique := len(unique)
			// Original 4/12/16 flow gaps fit more rows in one viewport than the
			// former uniform 24 DIP gap; the bound still proves viewport-only work.
			if cold == 0 || cold > 256 || coldUnique > 64 {
				t.Fatalf("cold open turn built history rather than viewport: n=%d parts=%d", n, cold)
			}
			tt.Frame()
			tt.Frame()
			cache := a.chatRowsCache
			before = a.metrics.MessagePartBuilds
			clear(unique)
			raw := json.RawMessage(fmt.Sprintf(`{"sessionId":"virtual-open","baselineSerial":1,"presentationEpoch":"chat:1","presentationRevision":0,"messageId":"body:%d","textAppend":" suffix","textBlockIndex":0,"streaming":true}`, n-1))
			if err := a.applyIncremental("messageDelta", raw); err != nil {
				t.Fatal(err)
			}
			tt.Frame()
			warm := a.metrics.MessagePartBuilds - before
			t.Logf("distinct cold=%d warm=%d, raw cold=%d warm=%d", coldUnique, len(unique), cold, warm)
			for _, node := range tt.AccessAll() {
				if node.Role == ui.RoleList {
					t.Logf("list bounds=%+v name=%s", node.Bounds, node.Name)
				}
			}
			if a.chatRowsCache != cache || warm == 0 || warm > 256 || len(unique) > 64 {
				t.Fatalf("suffix rebuilt body history or discarded grouping cache: n=%d parts=%d", n, warm)
			}
			if !tt.HasText(fmt.Sprintf("visible part %d suffix", n-1)) {
				t.Fatal("actual viewport lost the latest arena suffix")
			}
			t.Logf("history=%d coldPartBuilds=%d suffixPartBuilds=%d", n, cold, warm)
		})
	}
}
