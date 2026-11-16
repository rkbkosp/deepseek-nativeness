package main

import (
	"embed"
	"log"

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

// icon shows one named glyph from the embedded artwork. A name with no asset is
// a build mistake, not an operator error: report it once and draw the row
// without the glyph instead of tearing the window down mid-action.
func icon(c *ui.Context, name string, size float32) ui.Element {
	s, ok := icons[name]
	if !ok {
		path := "assets/icons/" + name + ".svg"
		data, err := artwork.ReadFile(path)
		if err != nil {
			log.Printf("icon: no embedded artwork %s: %v", path, err)
			icons[name] = nil // negative cache: one report per name
			return ui.Element{}
		}
		s = ui.MustParseSVG(data)
		icons[name] = s
	}
	if s == nil {
		return ui.Element{}
	}
	return ui.Icon(c, s).Size(size, size)
}
