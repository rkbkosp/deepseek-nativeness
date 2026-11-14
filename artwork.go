package main

import (
	"embed"
	"github.com/egoist/mygo/ui"
)

// Official DSH artwork is retained under its MIT license; see assets/NOTICE.md.
//
//go:embed assets/*.svg assets/icons/*.svg
var artwork embed.FS

var brand = loadArtwork("assets/welcome-brand.svg")
var brandDark = loadArtwork("assets/welcome-brand-dark.svg")
var icons = map[string]*ui.SVG{}

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
