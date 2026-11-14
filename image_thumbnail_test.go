package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestNativeThumbnailBoundsAndPixelOrientation(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 100, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 100; x++ {
			v := color.RGBA{255, 0, 0, 255}
			if y >= 100 {
				v = color.RGBA{0, 0, 255, 255}
			}
			source.SetRGBA(x, y, v)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	got, err := decodeHistoryThumbnail(encoded.Bytes(), imageAttachment{Width: 100, Height: 200, MediaType: "image/png"}, 40)
	if err != nil {
		t.Fatal(err)
	}
	if got.Bounds().Dx() > 40 || got.Bounds().Dy() > 40 {
		t.Fatal(got.Bounds())
	}
	top, bottom := got.RGBAAt(got.Bounds().Dx()/2, 1), got.RGBAAt(got.Bounds().Dx()/2, got.Bounds().Dy()-2)
	if top.R < 200 || top.B > 30 || bottom.B < 200 || bottom.R > 30 {
		t.Fatalf("ImageIO orientation/RGBA mismatch top=%v bottom=%v", top, bottom)
	}
}

func TestNativeThumbnailRejectsUnboundedCallers(t *testing.T) {
	for _, size := range []int{0, -1, 481, 1 << 30} {
		if _, err := decodeHistoryThumbnail(nil, imageAttachment{}, size); err == nil {
			t.Fatal("unbounded thumbnail size accepted", size)
		}
	}
}
