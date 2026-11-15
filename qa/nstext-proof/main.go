package main

import (
	"encoding/json"
	"flag"
	"github.com/ebitengine/purego"
	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/native"
	"github.com/egoist/mygo/ui"
	"log"
	"os"
	"path/filepath"
	"time"
	"unsafe"
)

type surface struct{ handle uintptr }

func (s *surface) NativeView() uintptr { return s.handle }
func cstring(p unsafe.Pointer) string {
	if p == nil {
		return ""
	}
	n := 0
	for *(*byte)(unsafe.Add(p, n)) != 0 {
		n++
	}
	return string(unsafe.Slice((*byte)(p), n))
}
func main() {
	result := flag.String("result", "/tmp/native-composer-proof.json", "local result path")
	capture := flag.String("capture", "/tmp/native-composer-proof.png", "capture path")
	duration := flag.Duration("exit-after", 120*time.Second, "self-close interval")
	flag.Parse()
	executable, _ := os.Executable()
	lib := filepath.Join(filepath.Dir(executable), "../Frameworks/libComposerProof.dylib")
	h, err := purego.Dlopen(lib, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		log.Fatal(err)
	}
	var create func() uintptr
	var view func(uintptr) uintptr
	var checks, bounds func(uintptr) unsafe.Pointer
	var release func(unsafe.Pointer)
	var focus, destroy func(uintptr)
	var focused func(uintptr) int32
	purego.RegisterLibFunc(&create, h, "nd_proof_create")
	purego.RegisterLibFunc(&view, h, "nd_proof_view")
	purego.RegisterLibFunc(&checks, h, "nd_proof_checks")
	purego.RegisterLibFunc(&bounds, h, "nd_proof_bounds")
	purego.RegisterLibFunc(&release, h, "nd_proof_free")
	purego.RegisterLibFunc(&focus, h, "nd_proof_focus")
	purego.RegisterLibFunc(&focused, h, "nd_proof_focuscheck")
	purego.RegisterLibFunc(&destroy, h, "nd_proof_destroy")
	mygo.App.SetName("Native Composer Proof")
	var win *mygo.Window
	owner := uintptr(0)
	native := &surface{}
	var report map[string]any
	popup := false
	popupText := ""
	mygo.App.WhenReady(func() {
		owner = create()
		native.handle = view(owner)
		data := checks(owner)
		if err := json.Unmarshal([]byte(cstring(data)), &report); err != nil {
			log.Fatal(err)
		}
		release(data)
		win = mygo.NewWindow(mygo.WindowOptions{Title: "Native Composer Proof · local only", Width: 720, Height: 360, Content: ui.View(func(c *ui.Context) {
			ui.Column(c).Fill().Padding(24).Gap(14).Children(func() {
				ui.Text(c, "Native composer proof · no Remote").FontSize(18)
				ui.Text(c, "公开 ui.NativeView · NSTextView / NSTextAttachment · macOS 15.8+").FontSize(12)
				ui.NativeView(c, native).FillWidth().Height(150).MinWidth(0).Radius(12).Border(1, c.Theme().Border)
				anchor := ui.Button(c, "Native popup focus test")
				if anchor.Clicked() {
					popup = !popup
				}
				ui.Popover(c, anchor, &popup, func() { ui.TextInput(c, &popupText).Label("Popup text input").Width(260) })
				ui.Text(c, "此独立fixture无身份、网络、Host或任务写入。").FontSize(12)
			})
		})})
		win.OnClosed(func() {
			if owner != 0 {
				native.handle = 0
				destroy(owner)
				owner = 0
			}
		})
		win.Show()
		mygo.App.Focus()
		win.Focus()
		go func() {
			time.Sleep(350 * time.Millisecond)
			mygo.RunOnMain(func() {
				if owner == 0 || win.IsDestroyed() {
					return
				}
				focus(owner)
				report["nativeFirstResponder"] = focused(owner) == 1
				p := bounds(owner)
				var b any
				_ = json.Unmarshal([]byte(cstring(p)), &b)
				release(p)
				report["hostedBounds"] = b
			})
			time.Sleep(300 * time.Millisecond)
			png, e := win.CapturePage()
			if e == nil {
				_ = os.WriteFile(*capture, png, 0600)
			}
			mygo.RunOnMain(func() {
				if owner == 0 || win.IsDestroyed() {
					return
				}
				report["captureError"] = e != nil
				out, _ := json.MarshalIndent(report, "", "  ")
				_ = os.WriteFile(*result, out, 0600)
			})
		}()
		go func() { time.Sleep(*duration); mygo.App.Quit() }()
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
