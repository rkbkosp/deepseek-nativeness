package composer_native

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"image/color"
	"testing"
)

func TestOpaqueBackingComposesExactlyOnceAgainstActualGoHost(t *testing.T) {
	for _, base := range []color.NRGBA{{21, 21, 23, 255}, {255, 255, 255, 255}} {
		for _, a := range []uint8{0, 20, 31, 128, 255} {
			token := color.NRGBA{255, 255, 255, a}
			if base.R == 255 {
				token.R = 0
				token.G = 0
				token.B = 0
			}
			got, err := OpaqueBackingToken(token, base)
			if err != nil {
				t.Fatal(err)
			}
			over := (ui.Color{R: token.R, G: token.G, B: token.B, A: token.A}).Over(ui.Color{R: base.R, G: base.G, B: base.B, A: base.A})
			want := fmt.Sprintf("#%02x%02x%02x", over.R, over.G, over.B)
			if got != want {
				t.Fatalf("alpha compounded or wrong backing: got%s want%s", got, want)
			}
		}
	}
	if _, err := OpaqueBackingToken(color.NRGBA{255, 255, 255, 31}, color.NRGBA{21, 21, 23, 128}); err == nil {
		t.Fatal("unresolved translucent host accepted")
	}
}
