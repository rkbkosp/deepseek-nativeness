package main

import "fmt"

type chatMessageDelta struct {
	BaselineSerial         uint64  `json:"baselineSerial"`
	PresentationEpoch      string  `json:"presentationEpoch"`
	PresentationRevision   *uint64 `json:"presentationRevision"`
	MessageID              string  `json:"messageId"`
	TextAppend             string  `json:"textAppend"`
	ReasoningAppend        string  `json:"reasoningAppend"`
	Streaming              bool    `json:"streaming"`
	ReasoningDisplay       *string `json:"reasoningDisplay"`
	ReasoningDisplayAppend string  `json:"reasoningDisplayAppend"`
	TextBlockIndex         *int    `json:"textBlockIndex"`
	ReasoningBlockIndex    *int    `json:"reasoningBlockIndex"`
}

func validateChatMessageDelta(m *message, p chatMessageDelta) error {
	for _, block := range []struct {
		index *int
		kind  string
	}{{p.TextBlockIndex, "text"}, {p.ReasoningBlockIndex, "reasoning"}} {
		if block.index != nil && (*block.index < 0 || *block.index >= len(m.AssistantBlocks) || m.AssistantBlocks[*block.index].Kind != block.kind) {
			return fmt.Errorf("远程内容块增量缺少对应基线，请重新打开会话")
		}
	}
	return nil
}
func appendChatMessageDelta(m *message, p chatMessageDelta) {
	m.Text += p.TextAppend
	m.Reasoning += p.ReasoningAppend
	if p.ReasoningDisplay != nil {
		m.ReasoningDisplay = *p.ReasoningDisplay
	}
	m.ReasoningDisplay += p.ReasoningDisplayAppend
	if p.TextBlockIndex != nil {
		m.AssistantBlocks[*p.TextBlockIndex].Text += p.TextAppend
	}
	if p.ReasoningBlockIndex != nil {
		m.AssistantBlocks[*p.ReasoningBlockIndex].Text += p.ReasoningAppend
	}
	m.Streaming = p.Streaming
}
