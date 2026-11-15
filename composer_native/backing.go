package composer_native

import (
	"errors"
	"fmt"
	"image/color"
)

// OpaqueBackingToken resolves a straight-alpha sRGB UI token over its actual
// opaque Go host color, before crossing the NativeView hole. The result must
// not be blended a second time against an unrelated system window color.
func OpaqueBackingToken(token, host color.NRGBA) (string, error) {
	if host.A != 255 {
		return "", errors.New("native backing needs the resolved opaque Go host color")
	}
	channel := func(f, b uint8) uint8 {
		return uint8((uint32(f)*uint32(token.A) + uint32(b)*uint32(255-token.A) + 127) / 255)
	}
	return fmt.Sprintf("#%02x%02x%02x", channel(token.R, host.R), channel(token.G, host.G), channel(token.B, host.B)), nil
}
