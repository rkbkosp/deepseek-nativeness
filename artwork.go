package main

import (
	"embed"
	"github.com/egoist/mygo/ui"
)

// Official DSH artwork is retained under its MIT license; see assets/NOTICE.md.
//
//go:embed assets/*.svg assets/icons/*.svg assets/app-icon.png
var artwork embed.FS

var brand = loadArtwork("assets/welcome-brand.svg")
var brandDark = loadArtwork("assets/welcome-brand-dark.svg")
var icons = map[string]*ui.SVG{}

// appIconPNG is the official DeepSeek Harness application icon (1024×1024),
// reused here so the client shows the same Dock icon as the original app.
// MyGo sets the Dock image from PNG bytes; the bundle carries the .icns form.
var appIconPNG = loadArtworkBytes("assets/app-icon.png")

func loadArtworkBytes(path string) []byte {
	data, err := artwork.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return data
}

func loadArtwork(path string) *ui.SVG {
	data, err := artwork.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return ui.MustParseSVG(data)
}
func icon(c *ui.Context, name string, size float32) ui.Element {
	s, ok := icons[name]
	if !ok {
		s = loadArtwork("assets/icons/" + name + ".svg")
		icons[name] = s
	}
	return ui.Icon(c, s).Size(size, size)
}
