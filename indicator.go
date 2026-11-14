package main

import (
	"math"
	"time"

	"github.com/egoist/mygo/ui"
)

const spinnerPeriod = 1500 * time.Millisecond

// CSS ease-in-out is cubic-bezier(.42,0,.58,1), not a sine wave.
func easeInOut(x float64) float64 {
	lo, hi := 0.0, 1.0
	for range 18 {
		u := (lo + hi) / 2
		v := 3*(1-u)*(1-u)*u*.42 + 3*(1-u)*u*u*.58 + u*u*u
		if v < x {
			lo = u
		} else {
			hi = u
		}
	}
	u := (lo + hi) / 2
	return 3*(1-u)*u*u + u*u*u
}

func spinnerGeometry(elapsed time.Duration) (rotation, length, offset float64) {
	phase := math.Mod(float64(elapsed)/float64(spinnerPeriod), 1)
	if phase < 0 {
		phase++
	}
	breath := phase * 2
	if breath > 1 {
		breath = 2 - breath
	}
	breath = easeInOut(breath)
	return phase * 2 * math.Pi, 12 + 12*breath, -6 * breath
}

type renderStats struct {
	Builds          uint64 `json:"viewBuilds"`
	IndicatorPaints uint64 `json:"indicatorPaints"`
	AnimationFrames uint64 `json:"animationFrames"`
	lastPaint       time.Time
	FixedTime       *time.Duration `json:"-"`
}

func stateIndicator(c *ui.Context, running bool, epoch time.Time, color ui.Color, stats *renderStats) {
	if !running {
		ui.Box(c).Size(14, 14).Draw(func(p *ui.Painter, r ui.Rect) {
			p.Fill(ui.Rect{X: r.X + 5, Y: r.Y + 5, W: 4, H: 4}, color.Alpha(.4), 2)
		})
		return
	}
	reduce := c.Preferences().ReduceMotion
	ui.Box(c).Size(14, 14).Label("正在运行").Role(ui.RoleProgress).Draw(func(p *ui.Painter, r ui.Rect) {
		elapsed := p.Now().Sub(epoch)
		if stats != nil {
			stats.IndicatorPaints++
			if !p.Now().Equal(stats.lastPaint) {
				stats.lastPaint = p.Now()
				stats.AnimationFrames++
			}
			if stats.FixedTime != nil {
				elapsed = *stats.FixedTime
			}
		}
		rotation, length, offset := spinnerGeometry(elapsed)
		if reduce {
			rotation, length, offset = 0, 18, -3
		}
		cx, cy, radius := r.X+r.W/2, r.Y+r.H/2, r.W*9.5/24
		var track, arc ui.Path
		track.Circle(cx, cy, radius)
		p.StrokePath(&track, r.W*2/24, color.Alpha(.25))
		// Preserve the SVG dash lengths and round stroke ends at a 24-unit viewbox.
		start := rotation - offset/9.5
		end := start + length/9.5
		for i := 0; i <= 32; i++ {
			t := start + (end-start)*float64(i)/32
			x, y := cx+radius*float32(math.Cos(t)), cy+radius*float32(math.Sin(t))
			if i == 0 {
				arc.MoveTo(x, y)
			} else {
				arc.LineTo(x, y)
			}
		}
		arc.Cap(ui.RoundCap)
		p.StrokePath(&arc, r.W*2/24, color)
		if !reduce && (stats == nil || stats.FixedTime == nil) {
			p.AnimationFrame()
		}
	})
}
