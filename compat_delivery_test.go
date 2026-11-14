package main

import (
	"context"
	"errors"
	"native-dsh/desktop/internal/bridge"
	"testing"
)

func TestCompatRPCFailurePreservesDeliveryCertainty(t *testing.T) {
	for _, tt := range []struct {
		name           string
		err            error
		code, delivery string
	}{
		{"remote stale", &bridge.RemoteError{Code: "STALE_CONTEXT", Message: "old page", Delivery: "rejected"}, "STALE_CONTEXT", "rejected"},
		{"host rejection", &bridge.RemoteError{Code: "REVISION_CONFLICT", Message: "changed", Delivery: "rejected"}, "REVISION_CONFLICT", "rejected"},
		{"local pre-dispatch rejection", compatRejectedError("unsupported page method"), "CLIENT_REJECTED", "rejected"},
		{"request cancellation", context.Canceled, "CLIENT_ERROR", "unknown"},
		{"missing reply", errors.New("pipe closed"), "CLIENT_ERROR", "unknown"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			out := compatRPCFailure(tt.err)
			err := out["error"].(map[string]string)
			if out["ok"] != false || err["code"] != tt.code || err["delivery"] != tt.delivery {
				t.Fatalf("%+v", out)
			}
		})
	}
}
