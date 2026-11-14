package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestBridgeFloodHelper(t *testing.T) {
	if os.Getenv("NATIVE_DSH_BRIDGE_TEST_CHILD") != "1" {
		return
	}
	if os.Getenv("NATIVE_DSH_BRIDGE_BLOCK_INPUT") == "1" {
		fmt.Println(`{"method":"ready","params":{}}`)
		<-time.After(time.Hour)
		os.Exit(0)
	}
	for i := 0; i < 10000; i++ {
		fmt.Printf("{\"method\":\"snapshot\",\"params\":{\"sequence\":%d}}\n", i)
	}
	var req struct {
		ID uint64 `json:"id"`
	}
	_ = json.NewDecoder(os.Stdin).Decode(&req)
	fmt.Printf("{\"id\":%d,\"result\":{}}\n", req.ID)
	os.Exit(0)
}

func TestCallDeadlineBreaksBlockedPipeWrite(t *testing.T) {
	t.Setenv("NATIVE_DSH_BRIDGE_TEST_CHILD", "1")
	t.Setenv("NATIVE_DSH_BRIDGE_BLOCK_INPUT", "1")
	c, err := Start(context.Background(), os.Args[0], "-test.run=^TestBridgeFloodHelper$")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	select {
	case <-c.Events:
	case <-time.After(5 * time.Second):
		t.Fatal("helper not ready")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := c.Call(ctx, "large", strings.Repeat("x", 512*1024)); result <- err }()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("deadline did not interrupt pipe write")
	}
	drained := make(chan struct{})
	go func() {
		for range c.Events {
		}
		close(drained)
	}()
	select {
	case <-drained:
	case <-time.After(5 * time.Second):
		t.Fatal("canceled write left helper alive")
	}
}

func TestCloseAndContextCancelBreakNotificationBackpressure(t *testing.T) {
	for _, mode := range []string{"close", "context"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("NATIVE_DSH_BRIDGE_TEST_CHILD", "1")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c, err := Start(ctx, os.Args[0], "-test.run=^TestBridgeFloodHelper$")
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			deadline := time.Now().Add(5 * time.Second)
			for len(c.Events) < cap(c.Events) {
				if time.Now().After(deadline) {
					t.Fatal("helper did not fill event queue")
				}
				runtime.Gosched()
			}
			callDone := make(chan error, 1)
			go func() { _, err := c.Call(context.Background(), "status", nil); callDone <- err }()
			if mode == "close" {
				_ = c.Close()
			} else {
				cancel()
			}
			select {
			case err := <-callDone:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("call error %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("call stuck behind notification flood")
			}
			drained := make(chan struct{})
			go func() {
				for range c.Events {
				}
				close(drained)
			}()
			select {
			case <-drained:
			case <-time.After(5 * time.Second):
				t.Fatal("notification reader/process teardown hung")
			}
		})
	}
}
