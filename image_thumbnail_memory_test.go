//go:build darwin

package main

import (
	"bytes"
	"image"
	"image/jpeg"
	"runtime"
	"testing"
)

func twelveMegapixelJPEG(t *testing.T) []byte {
	t.Helper()
	source := image.NewYCbCr(image.Rect(0, 0, 4000, 3000), image.YCbCrSubsampleRatio420)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, source, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

// This bounds Go heap allocation in the decoder and the returned thumbnail.
// It does not measure ImageIO's native peak or whole-app memory.
func TestImageIODownsamplesTwelveMegapixelsBeforeAllocatingGoRGBA(t *testing.T) {
	encoded := twelveMegapixelJPEG(t)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	got, err := decodeHistoryThumbnail(encoded, imageAttachment{Width: 4000, Height: 3000, MediaType: "image/jpeg"}, 160)
	if err != nil {
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)
	if got.Bounds().Dx() > 160 || got.Bounds().Dy() > 160 || len(got.Pix) > 160*160*4 {
		t.Fatal(got.Bounds(), len(got.Pix))
	}
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > 2*1024*1024 {
		t.Fatalf("decoder allocated %d Go bytes, likely decoded original RGBA", allocated)
	}
}
