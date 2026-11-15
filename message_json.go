package main

import "encoding/json"

func (m *message) UnmarshalJSON(raw []byte) error {
	type fields message
	value := struct {
		*fields
		Seq *int64 `json:"seq"`
	}{fields: (*fields)(m)}
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	m.seqPresent = value.Seq != nil
	if value.Seq != nil {
		m.Seq = *value.Seq
	}
	return nil
}
