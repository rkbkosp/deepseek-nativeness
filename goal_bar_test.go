package main

import (
	"encoding/json"
	"testing"
)

func TestGoalProjectionParses(t *testing.T) {
	var values composerProjectionValues
	if err := json.Unmarshal([]byte(`{"goal":{"goal":{"id":"g1","revision":2,"objective":"完成 parity","phase":"active","maxGoalRounds":80},"roundsStarted":3}}`), &values); err != nil {
		t.Fatal(err)
	}
	if values.Goal == nil || values.Goal.Goal == nil || values.Goal.Goal.Objective != "完成 parity" || values.Goal.Goal.Phase != "active" || values.Goal.RoundsStarted != 3 {
		t.Fatalf("goal = %+v", values.Goal)
	}
}
