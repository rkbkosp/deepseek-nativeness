//go:build !darwin

package main

import (
	"bytes"
	"errors"
	"golang.org/x/image/draw"
	"image"
	"math"
)

// Non-product test hosts use a bounded fallback. The supported product is macOS.
func decodeHistoryThumbnail(data []byte, ref imageAttachment, maxSide int) (*image.RGBA, error) {
	if maxSide < 1 || maxSide > maxNativeThumbnailSide {
		return nil, errors.New("原生缩略图边长必须在 1..480 范围内")
	}
	c, _, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil {
		return nil, e
	}
	if c.Width != ref.Width || c.Height != ref.Height || int64(c.Width)*int64(c.Height) > 4*1024*1024 {
		return nil, errors.New("test-host thumbnail decoder size limit")
	}
	src, _, e := image.Decode(bytes.NewReader(data))
	if e != nil {
		return nil, e
	}
	scale := math.Min(1, float64(maxSide)/math.Max(float64(c.Width), float64(c.Height)))
	w, h := max(1, int(float64(c.Width)*scale)), max(1, int(float64(c.Height)*scale))
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(out, out.Bounds(), src, src.Bounds(), draw.Src, nil)
	return out, nil
}
