//go:build darwin

package main

// This client-only ImageIO boundary downsamples before a Go RGBA exists. It
// never creates a window or changes the frozen MyGo framework.
import (
	"bytes"
	"errors"
	"fmt"
	"github.com/ebitengine/purego"
	"image"
	"runtime"
	"sync"
	"unsafe"
)

type cgThumbnailRect struct{ X, Y, W, H float64 }

var thumbnailIO struct {
	once                    sync.Once
	err                     error
	cfDataCreate            func(uintptr, unsafe.Pointer, int64) uintptr
	cfRelease               func(uintptr)
	cfNumberCreate          func(uintptr, int32, unsafe.Pointer) uintptr
	cfDictCreate            func(uintptr, int64, uintptr, uintptr) uintptr
	cfDictSet               func(uintptr, uintptr, uintptr)
	sourceCreate            func(uintptr, uintptr) uintptr
	sourceThumbnail         func(uintptr, uint64, uintptr) uintptr
	imageWidth, imageHeight func(uintptr) uint64
	colorSpaceCreate        func() uintptr
	bitmapCreate            func(unsafe.Pointer, uint64, uint64, uint64, uint64, uintptr, uint32) uintptr
	contextDraw             func(uintptr, cgThumbnailRect, uintptr)
	always                  uintptr
	transform               uintptr
	maxPixel                uintptr
	cache                   uintptr
	trueValue               uintptr
	falseValue              uintptr
	keyCallbacks            uintptr
	valueCallbacks          uintptr
}

func initThumbnailIO() {
	defer func() {
		if p := recover(); p != nil {
			thumbnailIO.err = fmt.Errorf("ImageIO 初始化失败：%v", p)
		}
	}()
	cf, e := purego.Dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if e != nil {
		thumbnailIO.err = e
		return
	}
	io, e := purego.Dlopen("/System/Library/Frameworks/ImageIO.framework/ImageIO", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if e != nil {
		thumbnailIO.err = e
		return
	}
	cg, e := purego.Dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if e != nil {
		thumbnailIO.err = e
		return
	}
	system, e := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if e != nil {
		thumbnailIO.err = e
		return
	}
	var copyMemory func(uintptr, uintptr, uint64) uintptr
	purego.RegisterLibFunc(&copyMemory, system, "memcpy")
	purego.RegisterLibFunc(&thumbnailIO.cfDataCreate, cf, "CFDataCreate")
	purego.RegisterLibFunc(&thumbnailIO.cfRelease, cf, "CFRelease")
	purego.RegisterLibFunc(&thumbnailIO.cfNumberCreate, cf, "CFNumberCreate")
	purego.RegisterLibFunc(&thumbnailIO.cfDictCreate, cf, "CFDictionaryCreateMutable")
	purego.RegisterLibFunc(&thumbnailIO.cfDictSet, cf, "CFDictionarySetValue")
	purego.RegisterLibFunc(&thumbnailIO.sourceCreate, io, "CGImageSourceCreateWithData")
	purego.RegisterLibFunc(&thumbnailIO.sourceThumbnail, io, "CGImageSourceCreateThumbnailAtIndex")
	purego.RegisterLibFunc(&thumbnailIO.imageWidth, cg, "CGImageGetWidth")
	purego.RegisterLibFunc(&thumbnailIO.imageHeight, cg, "CGImageGetHeight")
	purego.RegisterLibFunc(&thumbnailIO.colorSpaceCreate, cg, "CGColorSpaceCreateDeviceRGB")
	purego.RegisterLibFunc(&thumbnailIO.bitmapCreate, cg, "CGBitmapContextCreate")
	purego.RegisterLibFunc(&thumbnailIO.contextDraw, cg, "CGContextDrawImage")
	symbol := func(lib uintptr, name string) uintptr {
		p, err := purego.Dlsym(lib, name)
		if err != nil {
			panic(err)
		}
		return p
	}
	ref := func(lib uintptr, name string) uintptr {
		var value uintptr
		var pin runtime.Pinner
		pin.Pin(&value)
		copyMemory(uintptr(unsafe.Pointer(&value)), symbol(lib, name), uint64(unsafe.Sizeof(value)))
		pin.Unpin()
		return value
	}
	thumbnailIO.always = ref(io, "kCGImageSourceCreateThumbnailFromImageAlways")
	thumbnailIO.transform = ref(io, "kCGImageSourceCreateThumbnailWithTransform")
	thumbnailIO.maxPixel = ref(io, "kCGImageSourceThumbnailMaxPixelSize")
	thumbnailIO.cache = ref(io, "kCGImageSourceShouldCache")
	thumbnailIO.trueValue = ref(cf, "kCFBooleanTrue")
	thumbnailIO.falseValue = ref(cf, "kCFBooleanFalse")
	thumbnailIO.keyCallbacks = symbol(cf, "kCFTypeDictionaryKeyCallBacks")
	thumbnailIO.valueCallbacks = symbol(cf, "kCFTypeDictionaryValueCallBacks")
}
func decodeHistoryThumbnail(encoded []byte, ref imageAttachment, maxSide int) (*image.RGBA, error) {
	if maxSide < 1 || maxSide > maxNativeThumbnailSide {
		return nil, errors.New("原生缩略图边长必须在 1..480 范围内")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	media := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}[format]
	if config.Width != ref.Width || config.Height != ref.Height || media != ref.MediaType {
		return nil, errors.New("图片尺寸或类型与附件不匹配")
	}
	thumbnailIO.once.Do(initThumbnailIO)
	if thumbnailIO.err != nil {
		return nil, thumbnailIO.err
	}
	api := &thumbnailIO
	data := api.cfDataCreate(0, unsafe.Pointer(unsafe.SliceData(encoded)), int64(len(encoded)))
	runtime.KeepAlive(encoded)
	if data == 0 {
		return nil, errors.New("ImageIO 数据创建失败")
	}
	defer api.cfRelease(data)
	options := api.cfDictCreate(0, 4, api.keyCallbacks, api.valueCallbacks)
	if options == 0 {
		return nil, errors.New("ImageIO 选项创建失败")
	}
	defer api.cfRelease(options)
	size := int32(maxSide)
	number := api.cfNumberCreate(0, 3, unsafe.Pointer(&size))
	runtime.KeepAlive(size)
	if number == 0 {
		return nil, errors.New("ImageIO 尺寸创建失败")
	}
	defer api.cfRelease(number)
	api.cfDictSet(options, api.always, api.trueValue)
	api.cfDictSet(options, api.transform, api.trueValue)
	api.cfDictSet(options, api.maxPixel, number)
	api.cfDictSet(options, api.cache, api.falseValue)
	source := api.sourceCreate(data, options)
	if source == 0 {
		return nil, errors.New("ImageIO 无法读取图片")
	}
	defer api.cfRelease(source)
	thumb := api.sourceThumbnail(source, 0, options)
	if thumb == 0 {
		return nil, errors.New("ImageIO 无法生成缩略图")
	}
	defer api.cfRelease(thumb)
	w, h := api.imageWidth(thumb), api.imageHeight(thumb)
	if w == 0 || h == 0 || w > uint64(maxSide) || h > uint64(maxSide) {
		return nil, errors.New("ImageIO 缩略图尺寸超出边界")
	}
	result := image.NewRGBA(image.Rect(0, 0, int(w), int(h)))
	var pin runtime.Pinner
	pin.Pin(unsafe.SliceData(result.Pix))
	defer pin.Unpin()
	space := api.colorSpaceCreate()
	if space == 0 {
		return nil, errors.New("缩略图色彩空间创建失败")
	}
	defer api.cfRelease(space)
	// Big-endian RGBA, premultiplied last, matching image.RGBA exactly.
	context := api.bitmapCreate(unsafe.Pointer(unsafe.SliceData(result.Pix)), w, h, 8, uint64(result.Stride), space, 0x4001)
	if context == 0 {
		return nil, errors.New("缩略图画布创建失败")
	}
	defer api.cfRelease(context)
	api.contextDraw(context, cgThumbnailRect{W: float64(w), H: float64(h)}, thumb)
	runtime.KeepAlive(result)
	return result, nil
}
