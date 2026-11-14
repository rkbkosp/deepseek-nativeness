package main

import (
	"bytes"
	"github.com/egoist/mygo/ui"
	"image"
)

// Source admission remains with the composer. Only the thumbnail crosses this
// shared bridge: ImageIO downsamples before any Go RGBA or Bitmap allocation.
func composerThumbnail(raw []byte, maxPixel int) (ui.ImageSource, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	ref := imageAttachment{Width: config.Width, Height: config.Height, MediaType: map[string]string{"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}[format]}
	thumbnail, err := decodeHistoryThumbnail(raw, ref, maxPixel)
	if err != nil {
		return nil, err
	}
	return ui.NewBitmap(thumbnail), nil
}
