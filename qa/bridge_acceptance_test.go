package qa

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"testing"

	"native-dsh/desktop/internal/bridge"
)

// This fixture is an owned subprocess, never the installed Remote plugin.
func TestBridgeFixtureProcess(t *testing.T) {
	mode := ""
	for index, argument := range os.Args {
		if argument == "--qa-helper" && index+1 < len(os.Args) {
			mode = os.Args[index+1]
		}
	}
	if mode == "" {
		t.Skip("subprocess fixture only")
	}
	if mode == "backlog" {
		for index := 0; index < 512; index++ {
			fmt.Printf("{\"method\":\"session\",\"params\":{\"seq\":%d}}\n", index)
		}
	}
	input := bufio.NewScanner(os.Stdin)
	for input.Scan() {
		var request struct {
			ID uint64 `json:"id"`
		}
		if json.Unmarshal(input.Bytes(), &request) != nil {
			os.Exit(2)
		}
		fmt.Printf("{\"id\":%d,\"result\":{\"accepted\":true}}\n", request.ID)
	}
	os.Exit(0)
}

func startFixture(t *testing.T, mode string) (*bridge.Client, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	client, err := bridge.Start(ctx, executable, "-test.run=^TestBridgeFixtureProcess$", "--", "--qa-helper", mode)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client, cancel
}

func TestBridgeRequestAndOwnedShutdown(t *testing.T) {
	client, _ := startFixture(t, "requests")
	result, err := client.Call(t.Context(), "session.list", struct{}{})
	if err != nil || string(result) != `{"accepted":true}` {
		t.Fatalf("response %s, error %v", result, err)
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	for range client.Events {
	}
}

func TestBridgeShutdownWithUnconsumedDurableBacklog(t *testing.T) {
	for _, termination := range []string{"close", "context"} {
		t.Run(termination, func(t *testing.T) {
			client, cancel := startFixture(t, "backlog")
			// Wait for an observed full queue; no wall-clock timing decides success.
			for len(client.Events) < cap(client.Events) {
				select {
				case <-t.Context().Done():
					t.Fatal("test cancelled before backlog filled")
				default:
					runtime.Gosched()
				}
			}
			settled := make(chan error, 1)
			go func() {
				_, err := client.Call(context.Background(), "read-only.probe", struct{}{})
				settled <- err
			}()
			if termination == "close" {
				if err := client.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				cancel()
			}
			if err := <-settled; err == nil {
				t.Fatal("pending request succeeded after an unconsumed backlog was cancelled")
			}
			count := 0
			for range client.Events {
				count++
			}
			if count < cap(client.Events) {
				t.Fatalf("shutdown silently discarded buffered notifications: got %d", count)
			}
		})
	}
}
