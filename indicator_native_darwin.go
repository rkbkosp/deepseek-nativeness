//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"time"

	"github.com/ebitengine/purego"
	_ "github.com/egoist/mygo/native"
	"github.com/egoist/mygo/ui"
)

type indicatorNativeAPI struct {
	create      func() uintptr
	update      func(uintptr, float64, float64, float64, float64, float64, float64, float64, float64, uintptr, float64)
	stop, close func(uintptr)
}
type macIndicatorView struct {
	api     *indicatorNativeAPI
	handle  uintptr
	active  bool
	color   ui.Color
	backing indicatorBacking
}

func newIndicatorViewPool() *indicatorViewPool {
	// An explicit diagnostic fallback also supports before/after measurements.
	if os.Getenv("NATIVE_DSH_INDICATORS") == "paint" {
		return nil
	}
	bin, err := os.Executable()
	if err != nil {
		return nil
	}
	path := filepath.Join(filepath.Dir(bin), "..", "Frameworks", "libNativeDSHIndicators.dylib")
	h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return nil
	}
	// Check the complete ABI before registering functions; an older or incomplete
	// optional library must leave the painter fallback usable rather than panic.
	for _, name := range []string{"nd_indicator_create", "nd_indicator_update", "nd_indicator_stop", "nd_indicator_close"} {
		if _, err = purego.Dlsym(h, name); err != nil {
			return nil
		}
	}
	api := &indicatorNativeAPI{}
	purego.RegisterLibFunc(&api.create, h, "nd_indicator_create")
	purego.RegisterLibFunc(&api.update, h, "nd_indicator_update")
	purego.RegisterLibFunc(&api.stop, h, "nd_indicator_stop")
	purego.RegisterLibFunc(&api.close, h, "nd_indicator_close")
	return &indicatorViewPool{create: func() indicatorView {
		handle := api.create()
		if handle == 0 {
			return nil
		}
		return &macIndicatorView{api: api, handle: handle}
	}}
}
func (v *macIndicatorView) NativeView() uintptr { return v.handle }
func (v *macIndicatorView) Update(color ui.Color, backing indicatorBacking, epoch time.Time) {
	if v.handle == 0 || v.active && v.color == color && v.backing == backing {
		return
	}
	v.api.update(v.handle, float64(color.R)/255, float64(color.G)/255, float64(color.B)/255, float64(color.A)/255, float64(backing.Color.R)/255, float64(backing.Color.G)/255, float64(backing.Color.B)/255, float64(backing.Color.A)/255, backing.Wash, time.Since(epoch).Seconds())
	v.active, v.color, v.backing = true, color, backing
}
func (v *macIndicatorView) Stop() {
	if v.handle != 0 && v.active {
		v.api.stop(v.handle)
		v.active = false
	}
}
func (v *macIndicatorView) Close() {
	if v.handle != 0 {
		v.api.close(v.handle)
		v.handle = 0
		v.active = false
	}
}
