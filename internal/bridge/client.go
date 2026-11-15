// Package bridge owns the client-side subprocess protocol. It never launches a
// Harness backend; the optional helper owns only Remote transport and identity.
package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
)

type Notification struct {
	Method string             `json:"method"`
	Params json.RawMessage    `json:"params"`
	Scope  *NotificationScope `json:"scope,omitempty"`
}
type NotificationScope struct {
	HostID       string `json:"hostId"`
	Generation   uint64 `json:"generation"`
	AccountScope string `json:"accountScope"`
}

// MaxRequestBytes bounds a single JSON-lines request. Large local attachments
// need a staged/chunked client transport before this can safely be relaxed.
const MaxRequestBytes = 1024 * 1024

type RemoteError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Delivery string `json:"delivery"`
	// Details is the Host's own failure detail object, kept raw so a caller can
	// discriminate on it (a missing capability names which one this backend
	// serves) without this package learning each endpoint's vocabulary.
	Details json.RawMessage `json:"details,omitempty"`
}

func (e *RemoteError) Error() string { return e.Message }
func (e *RemoteError) Rejected() bool {
	if e.Delivery == "rejected" {
		return true
	}
	switch e.Code {
	case "INVALID_ARGUMENT", "INVALID_REQUEST_ID", "REQUEST_ID_CONFLICT", "READ_ONLY", "STALE_CONTEXT", "UNSUPPORTED_OPERATION", "REMOTE_NAMESPACE_FROZEN", "REMOTE_PLUGIN_FROZEN", "FEATURE_NOT_SUPPORTED", "SESSION_NOT_FOUND", "NOT_CONNECTED":
		return true
	}
	return false
}

type response struct {
	ID     uint64          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
	Notification
}

type Client struct {
	cmd       *exec.Cmd
	input     io.WriteCloser
	writes    chan writeRequest
	mu        sync.Mutex
	pending   map[uint64]chan response
	next      atomic.Uint64
	done      chan struct{}
	cancel    context.CancelFunc
	ctx       context.Context
	closeOnce sync.Once
	Events    chan Notification
	err       error
}

type writeRequest struct {
	ctx    context.Context
	data   []byte
	result chan error
}

func Start(ctx context.Context, command string, args ...string) (*Client, error) {
	life, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(life, command, args...)
	cmd.Stderr = os.Stderr // The helper must redact secrets before writing diagnostics.
	out, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	in, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		cancel()
		return nil, err
	}
	c := &Client{cmd: cmd, input: in, pending: make(map[uint64]chan response), done: make(chan struct{}), Events: make(chan Notification, 128), cancel: cancel, ctx: life, writes: make(chan writeRequest, 32)}
	go c.read(out)
	go c.write()
	go func() {
		select {
		case <-life.Done():
			c.stop(life.Err())
		case <-c.done:
		}
	}()
	return c, nil
}

func (c *Client) write() {
	for {
		select {
		case <-c.done:
			return
		case req := <-c.writes:
			if err := req.ctx.Err(); err != nil {
				req.result <- err
				continue
			}
			written := make(chan struct{})
			// A canceled write has an unknown delivery outcome. Close this
			// transport to unblock the pipe; never replay the business operation.
			go func() {
				select {
				case <-req.ctx.Done():
					select {
					case <-written:
					default:
						c.stop(req.ctx.Err())
					}
				case <-written:
				case <-c.done:
				}
			}()
			_, err := c.input.Write(req.data)
			close(written)
			req.result <- err
			if err != nil {
				c.stop(err)
				return
			}
		}
	}
}

func (c *Client) read(r io.Reader) {
	defer close(c.Events)
	defer func() {
		c.cancel()
		err := c.cmd.Wait()
		if err == nil {
			err = io.EOF
		}
		c.finish(err)
	}()
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for s.Scan() {
		var msg response
		if err := json.Unmarshal(s.Bytes(), &msg); err != nil {
			c.finish(fmt.Errorf("remote helper emitted invalid JSON"))
			_ = c.cmd.Process.Kill()
			return
		}
		if msg.ID != 0 {
			c.mu.Lock()
			ch := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ch != nil {
				ch <- msg
			}
		} else if msg.Method != "" {
			select {
			case c.Events <- msg.Notification:
			case <-c.done:
				return
			}
		}
	}
	if err := s.Err(); err != nil {
		c.finish(err)
	}
}

func (c *Client) finish(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-c.done:
		return
	default:
	}
	c.err = err
	close(c.done)
}

func (c *Client) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.next.Add(1)
	ch := make(chan response, 1)
	c.mu.Lock()
	select {
	case <-c.done:
		err := c.err
		c.mu.Unlock()
		return nil, err
	default:
	}
	c.pending[id] = ch
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	data, err := json.Marshal(struct {
		ID     uint64 `json:"id"`
		Method string `json:"method"`
		Params any    `json:"params"`
	}{id, method, params})
	if err != nil {
		return nil, &RemoteError{Code: "INVALID_ARGUMENT", Message: err.Error(), Delivery: "rejected"}
	}
	if len(data) > MaxRequestBytes {
		return nil, &RemoteError{Code: "REQUEST_TOO_LARGE", Message: "请求超过当前客户端 1 MiB 传输上限，请缩小内容后重试。草稿和附件已保留。", Delivery: "rejected"}
	}
	req := writeRequest{ctx: ctx, data: append(data, '\n'), result: make(chan error, 1)}
	select {
	case c.writes <- req:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		return nil, c.closedError()
	}
	select {
	case err = <-req.result:
		if err != nil {
			if e := c.ctx.Err(); e != nil {
				return nil, e
			}
			return nil, err
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		return nil, c.closedError()
	}
	select {
	case msg := <-ch:
		if len(msg.Error) != 0 && string(msg.Error) != "null" {
			var e RemoteError
			if json.Unmarshal(msg.Error, &e) == nil && e.Message != "" {
				return nil, &e
			}
			return nil, errors.New("Remote request failed")
		}
		return msg.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		c.mu.Lock()
		err := c.err
		c.mu.Unlock()
		return nil, err
	}
}

func (c *Client) closedError() error { c.mu.Lock(); defer c.mu.Unlock(); return c.err }

func (c *Client) stop(err error) {
	c.closeOnce.Do(func() { c.finish(err); c.cancel(); _ = c.input.Close() })
}

// Close cancels only this transport. It never issues a Session cancellation or
// retries a business request whose outcome may already have been committed.
func (c *Client) Close() error { c.stop(context.Canceled); return nil }
