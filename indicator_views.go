package main

import (
	"time"

	"github.com/egoist/mygo/ui"
)

// The window owns a bounded pool of native views. NativeView keeps embedded
// handles until its window closes; reuse idle handles rather than allocating
// another retained platform view every time a session row returns.
type indicatorBacking struct {
	Color ui.Color
	Wash  uintptr
}

const (
	indicatorWashNone uintptr = iota
	indicatorWashLight
	indicatorWashDark
)

type indicatorView interface {
	ui.PlatformView
	Update(ui.Color, indicatorBacking, time.Time)
	Stop()
	Close()
}
type indicatorViewPool struct {
	create func() indicatorView
	all    []indicatorView
	idle   []indicatorView
	closed bool
}
type indicatorLease struct {
	pool *indicatorViewPool
	view indicatorView
}

func (p *indicatorViewPool) acquire() *indicatorLease {
	if p == nil || p.closed {
		return nil
	}
	var v indicatorView
	if n := len(p.idle); n > 0 {
		v = p.idle[n-1]
		p.idle = p.idle[:n-1]
	} else {
		v = p.create()
		if v == nil {
			return nil
		}
		p.all = append(p.all, v)
	}
	return &indicatorLease{pool: p, view: v}
}
func (l *indicatorLease) NativeView() uintptr {
	if l == nil || l.view == nil || l.pool.closed {
		return 0
	}
	return l.view.NativeView()
}
func (l *indicatorLease) Close() error {
	if l == nil || l.view == nil {
		return nil
	}
	if !l.pool.closed {
		l.view.Stop()
		l.pool.idle = append(l.pool.idle, l.view)
	}
	l.view = nil
	return nil
}
func (p *indicatorViewPool) Close() {
	if p == nil || p.closed {
		return
	}
	p.closed = true
	for _, v := range p.all {
		v.Close()
	}
	p.all, p.idle = nil, nil
}
func nativeStateIndicator(c *ui.Context, e ui.Element, epoch time.Time, color ui.Color, stats *renderStats, allowed bool, backing indicatorBacking) bool {
	if stats == nil || stats.indicators == nil {
		return false
	}
	lease := ui.Local(e, "native-indicator", func() *indicatorLease { return nil })
	if !allowed {
		if *lease != nil {
			(*lease).Close()
			*lease = nil
		}
		return false
	}
	if *lease == nil {
		*lease = stats.indicators.acquire()
	}
	if *lease == nil || (*lease).NativeView() == 0 {
		return false
	}
	(*lease).view.Update(color, backing, epoch)
	e.Children(func() { ui.NativeView(c, *lease).Size(14, 14).TabStop(false) })
	return true
}

// Match the wash painted over the native sidebar material in sidebarFrame.
func (a *app) indicatorSidebarBacking(c *ui.Context) indicatorBacking {
	if c.Preferences().ReduceTransparency {
		return indicatorBacking{Color: a.colors.Sidebar.Alpha(.9)}
	}
	if a.theme.Dark {
		return indicatorBacking{Color: ui.RGBA(27, 27, 28, .5), Wash: indicatorWashDark}
	}
	return indicatorBacking{Color: ui.RGBA(245, 247, 251, .4), Wash: indicatorWashLight}
}
