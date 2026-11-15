package main

import (
	"encoding/json"
	"errors"
	"github.com/ebitengine/purego"
	"unsafe"
)

func loadProofNativeProbe(library string) (func(uintptr, bool) (map[string]any, error), func(), error) {
	h, err := purego.Dlopen(library, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return nil, nil, err
	}
	var read func(uintptr) unsafe.Pointer
	var readProps func(uintptr) unsafe.Pointer
	var length func(unsafe.Pointer) int64
	var free func(unsafe.Pointer)
	purego.RegisterLibFunc(&read, h, "nd_proof_native_style")
	purego.RegisterLibFunc(&readProps, h, "nd_proof_native_props")
	purego.RegisterLibFunc(&length, h, "nd_editor_length")
	purego.RegisterLibFunc(&free, h, "nd_editor_free")
	return func(view uintptr, pixels bool) (map[string]any, error) {
		if view == 0 {
			return nil, errors.New("view retired")
		}
		reader := readProps
		if pixels {
			reader = read
		}
		p := reader(view)
		if p == nil {
			return nil, errors.New("probe returned no data")
		}
		defer free(p)
		n := length(p)
		if n < 0 || n > 1048576 {
			return nil, errors.New("invalid probe length")
		}
		data := append([]byte(nil), unsafe.Slice((*byte)(p), int(n))...)
		var result map[string]any
		err := json.Unmarshal(data, &result)
		return result, err
	}, func() { _ = purego.Dlclose(h) }, nil
}
