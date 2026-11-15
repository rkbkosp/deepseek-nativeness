package main

// Local runtime boot: resolve the payload, take the profile, start the Host and
// publish the page the original web client is served from.
//
// Everything the shell needs at runtime lives in localRuntime, so the shared
// `app` struct only gains one field.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

type localRuntime struct {
	payload *runtimePayload
	host    *runtimeHost
	page    *mygo.WebView
	url     string
	home    string

	// status is the human-readable phase while starting; err is terminal.
	status  string
	err     string
	started time.Time
}

// runtimeTopic is the small amount of state the shell shows about the Host.
type runtimeTopic struct {
	Kind string
	Text string
}

// startLocalRuntime boots the local Host asynchronously and publishes the page
// when it is ready. It is safe to call from the UI thread: the blocking work
// happens in a goroutine and state changes are applied through a.update.
func (a *app) startLocalRuntime() {
	if a.localRuntime != nil {
		if a.localRuntime.page != nil {
			return
		}
		if a.localRuntime.host != nil {
			return // already starting
		}
	}
	local := &localRuntime{status: "正在查找本地运行时…", started: time.Now()}
	a.localRuntime = local
	a.update(func() { a.error = "" })

	go func() {
		payload, err := resolveRuntimePayload()
		if err != nil {
			a.failLocalRuntime(local, err.Error())
			return
		}
		home, err := runtimeHome()
		if err != nil {
			a.failLocalRuntime(local, "无法确定 Harness 主目录："+err.Error())
			return
		}
		a.update(func() { local.payload, local.home = payload, home })
		a.update(func() { local.status = "正在检查 profile 占用…" })
		if err := ensureProfileAvailable(home); err != nil {
			a.failLocalRuntime(local, err.Error())
			return
		}
		a.update(func() {
			local.status = fmt.Sprintf("正在启动本地运行时 %s …", payload.Version)
		})
		launch := runtimeLaunch{
			Command: payload.Node,
			Args: []string{
				payload.Launcher,
				"--home", home,
				"--runtime", payload.Dsh,
				"--node", payload.Node,
				"--primary-runtime", payload.PrimaryRuntime,
				"--pnpm", payload.Pnpm,
				"--bin", payload.NodeBin,
				"--client-version", payload.Version,
			},
			Env:      inheritedEnvironment(),
			Dir:      payload.Root,
			OnEvent:  a.onRuntimeEvent(local),
			ReadyTimeout: 240 * time.Second,
		}
		host := newRuntimeHost(launch)
		a.update(func() { local.host = host })
		if err := host.start(); err != nil {
			a.failLocalRuntime(local, "启动器无法执行："+err.Error())
			return
		}
		ready, err := host.waitReady(a.ctx)
		if err != nil {
			a.failLocalRuntime(local, err.Error())
			return
		}
		if err := probeHostAlive(ready.URL); err != nil {
			// The Host answered `ready` but not HTTP: report the process output
			// instead of showing a blank page.
			a.failLocalRuntime(local, "本地 Host 未响应 HTTP："+err.Error())
			return
		}
		a.update(func() {
			local.url = ready.URL
			local.status = ""
		})
		a.openLocalPage(local)
	}()
}

// onRuntimeEvent keeps the last Host event for diagnostics. It must not touch
// UI state directly: events arrive on the supervisor goroutine.
func (a *app) onRuntimeEvent(local *localRuntime) func(json.RawMessage) {
	return func(raw json.RawMessage) {
		var event struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &event) != nil || event.Type == "" {
			return
		}
		switch event.Type {
		case "platform-session":
			// Credential updates for embedded Platform views are not used by this
			// shell yet; ignoring them keeps the channel drained.
		default:
			a.update(func() {
				if local.payload == nil {
					return
				}
			})
		}
	}
}

func (a *app) failLocalRuntime(local *localRuntime, message string) {
	a.update(func() {
		if local.host != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			_ = local.host.stop(ctx)
			local.host = nil
		}
		local.err = message
		local.status = ""
		a.error = message
	})
}

// openLocalPage creates the web view for the served client. It runs on the main
// thread because the view belongs to the window.
func (a *app) openLocalPage(local *localRuntime) {
	mygo.RunOnMain(func() {
		if a.localRuntime != local || a.win == nil {
			return
		}
		a.closeCompat()
		a.closeWeb()
		view, err := a.win.NewWebView(mygo.WebViewOptions{
			URL: local.url,
			// The served application is not a native trusted page: it gets no
			// bindings, exactly like the untrusted Remote Web surface.
			Page:            mygo.PageOptions{Untrusted: true},
			BackgroundColor: webViewBackground(a.effectiveDark),
		})
		if err != nil {
			a.failLocalRuntime(local, "无法创建本地工作区视图："+err.Error())
			return
		}
		local.page = view
		if os.Getenv("NATIVE_DSH_LOCAL_DEBUG") != "" {
			log.Printf("local: created view for %s", local.url)
			view.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
				log.Printf("local: navigating to %s", e.URL)
			})
			view.Page().OnDidFinishLoad(func() {
				log.Printf("local: load finished")
				// A window capture can omit the hosted web content, so QA can also
				// ask for the web view's own snapshot.
				if shot := os.Getenv("NATIVE_DSH_LOCAL_SHOT"); shot != "" {
					go func() {
						time.Sleep(4 * time.Second)
						data, err := view.CapturePage()
						if err != nil {
							log.Printf("local: web capture: %v", err)
							return
						}
						if err := os.WriteFile(shot, data, 0o600); err != nil {
							log.Printf("local: web capture write: %v", err)
							return
						}
						log.Printf("local: web capture %s", shot)
					}()
				}
			})
		}
		view.Page().OnDidFailLoad(func(e *mygo.LoadError) {
			if a.localRuntime == local && local.page == view {
				a.error = "本地工作区加载失败：" + e.Description
				a.closeLocalRuntime()
			}
		})
		view.Page().OnRenderProcessGone(func(reason string) {
			if a.localRuntime == local && local.page == view {
				a.error = "本地工作区已停止（" + reason + "），可重新打开。"
				a.closeLocalRuntime()
			}
		})
		a.win.Invalidate()
	})
}

// closeLocalRuntime stops the Host and destroys the view. The Host is owned by
// this process, so closing the window terminates it.
func (a *app) closeLocalRuntime() {
	local := a.localRuntime
	if local == nil {
		return
	}
	a.localRuntime = nil
	page, host := local.page, local.host
	local.page, local.host = nil, nil
	mygo.RunOnMain(func() {
		if page != nil {
			page.Destroy()
		}
		if a.win != nil {
			a.win.Invalidate()
		}
	})
	if host != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = host.stop(ctx)
		}()
	}
}

// probeHostAlive checks that the Host answers HTTP at all. It deliberately does
// not consume the launch token: that token is single-use per launch and the web
// view still needs it, so the probe only looks for any response.
func probeHostAlive(rawURL string) error {
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Get(rawURL)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	return nil
}

// hostReachable is a cheaper liveness check used for status text.
func hostReachable(rawURL string) bool {
	u := strings.TrimPrefix(strings.TrimPrefix(rawURL, "http://"), "https://")
	if index := strings.IndexAny(u, "/?#"); index >= 0 {
		u = u[:index]
	}
	conn, err := net.DialTimeout("tcp", u, 800*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

var _ = errors.Is

// stopLocalRuntimeForQuit stops the owned Host synchronously, so quitting
// reports shutdown-complete instead of killing it mid-task without notice.
func (a *app) stopLocalRuntimeForQuit() {
	local := a.localRuntime
	if local == nil {
		return
	}
	page, host := local.page, local.host
	a.localRuntime = nil
	local.page, local.host = nil, nil
	if page != nil {
		mygo.RunOnMain(func() { page.Destroy() })
	}
	if host != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := host.stop(ctx); err != nil {
			log.Printf("local: shutdown during quit: %v", err)
		}
	}
}
