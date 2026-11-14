package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"reflect"
	"strings"
	"testing"
)

func parityRoleRects(tt *ui.Tester, role ui.Role) []ui.Rect {
	rt := reflect.ValueOf(tt).Elem().FieldByName("rt").Elem()
	c := rt.FieldByName("c")
	chunks := c.FieldByName("chunks")
	used := int(c.FieldByName("used").Int())
	at := 0
	var out []ui.Rect
	for i := 0; i < chunks.Len() && at < used; i++ {
		chunk := chunks.Index(i)
		for j := 0; j < chunk.Len() && at < used; j++ {
			n := chunk.Index(j)
			at++
			if n.FieldByName("role").Uint() != uint64(role) {
				continue
			}
			out = append(out, ui.Rect{X: float32(n.FieldByName("x").Float()), Y: float32(n.FieldByName("y").Float()), W: float32(n.FieldByName("w").Float()), H: float32(n.FieldByName("h").Float())})
		}
	}
	return out
}
func tableParityApp(t *testing.T, source string, width int, right bool) (*app, *ui.Tester) {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.current.Running = false
	a.rightPaneOpen = right
	a.current.Messages = []message{{ID: "table-parity", Role: "assistant", Text: source}}
	tt := ui.NewTester(a.view, width, 820)
	tt.Frame()
	return a, tt
}
func TestTableFillNarrowKeepsAllColumnsAndWraps(t *testing.T) {
	for _, cols := range []int{2, 3} {
		t.Run(fmt.Sprint(cols), func(t *testing.T) {
			heads := []string{"项目", "内容", "备注"}[:cols]
			body := []string{"安装包", strings.Repeat("long-path/", 14) + "末尾", "第三列"}[:cols]
			_, tt := tableParityApp(t, "|"+strings.Join(heads, "|")+"|\n|"+strings.Repeat("---|", cols)+"\n|"+strings.Join(body, "|")+"|", 1280, true)
			cells := parityRoleRects(tt, ui.RoleCell)
			headers := parityRoleRects(tt, ui.RoleColumnHeader)
			if len(cells) != cols || len(headers) != cols {
				t.Fatalf("missing cells: %v / %v", cells, headers)
			}
			expectedWidth := max(float32(360), float32(cols*132-16))
			if cells[0].X != 312 || abs(cells[cols-1].X+cells[cols-1].W-312-expectedWidth) > .1 {
				t.Fatalf("fill table escaped 360-DIP chat axis: %+v", cells)
			}
			for i := range cols {
				if abs(cells[i].X-headers[i].X) > .1 || abs(cells[i].W-headers[i].W) > .1 {
					t.Fatalf("column %d header/body misaligned: %v / %v", i, headers, cells)
				}
			}
			if cells[1].H < 65 {
				t.Fatalf("long content did not wrap: %+v", cells[1])
			}
			rects := composerUnclippedRects(t, tt)
			if r := rects["Markdown 表格横向滚动"]; r.W != 360 {
				t.Fatalf("wrong viewport: %+v", r)
			}
			if cols == 3 {
				r := rects["Markdown 表格横向滚动"]
				tt.Scroll(r.X+r.W/2, r.Y+r.H/2, 1000, 0)
				tt.Frame()
				cells = parityRoleRects(tt, ui.RoleCell)
				if abs(cells[2].X+cells[2].W-672) > .1 {
					t.Fatalf("below-floor table's last column not reachable: %v", cells)
				}
			}
		})
	}
}
func TestWideAndQuotedTablePolicies(t *testing.T) {
	source := "|甲|乙|丙|丁|\n|---|---|---|---|\n|一|二|三|四|"
	for _, quoted := range []bool{false, true} {
		t.Run(fmt.Sprint(quoted), func(t *testing.T) {
			text := source
			if quoted {
				text = "> " + strings.ReplaceAll(source, "\n", "\n> ")
			}
			_, tt := tableParityApp(t, text, 1280, false)
			cells := parityRoleRects(tt, ui.RoleCell)
			if len(cells) != 4 {
				t.Fatal(cells)
			}
			total := cells[3].X + cells[3].W - cells[0].X
			if quoted && total < 600 {
				t.Fatalf("quoted 4-column table must fill, got %g", total)
			}
			if !quoted && total > 600 {
				t.Fatalf("wide table must retain natural columns, got %g", total)
			}
			composerUnclippedRects(t, tt)
		})
	}
}
func TestLongCodeWrapHasFiniteNarrowBodyAndScrollToggle(t *testing.T) {
	source := "```go\n" + strings.Repeat("longUnbrokenName", 40) + "TAIL\n```"
	_, tt := tableParityApp(t, source, 1280, true)
	rects := composerUnclippedRects(t, tt)
	box, body := rects["代码块"], rects["代码内容"]
	if box.X != 312 || box.W != 360 || body.W != 360 || body.H < 100 {
		t.Fatalf("wrapped code geometry: card %+v body %+v", box, body)
	}
	if err := tt.Click("自动换行"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	rects = composerUnclippedRects(t, tt)
	body = rects["代码内容"]
	if body.W != 360 || body.H > 100 {
		t.Fatalf("nowrap viewport not bounded or still wrapped: %+v", body)
	}
}
func abs(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

func TestWideTableIsATabStopAndArrowKeysReachOffscreenColumns(t *testing.T) {
	_, tt := tableParityApp(t, "|甲|乙|丙|丁|\n|---|---|---|---|\n|一|二|三|四|", 1280, true)
	for i := 0; i < 100 && !tt.Focused("Markdown 表格横向滚动"); i++ {
		tt.Key(0, ui.KeyTab)
	}
	if !tt.Focused("Markdown 表格横向滚动") {
		t.Fatal("wide table cannot be reached with Tab")
	}
	before := parityRoleRects(tt, ui.RoleCell)
	for i := 0; i < 10; i++ {
		tt.Key(0, ui.KeyRight)
		tt.Advance(150000000)
	}
	after := parityRoleRects(tt, ui.RoleCell)
	if after[0].X >= before[0].X || after[3].X+after[3].W > 672.1 {
		t.Fatalf("arrow keys did not reach last column: before%v after%v", before, after)
	}
}
