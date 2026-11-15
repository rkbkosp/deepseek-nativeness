package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo/ui"
)

const unknownJSONMaxChars = 20_000

type unknownJSONState struct {
	Open   bool
	source *byte
	size   int
	body   string
}

// The payload is immutable message-arena data. Cache only the bounded display
// on this visible element, never a second full formatted copy of its history.
func (s *unknownJSONState) display(raw json.RawMessage) string {
	if !s.Open {
		s.source, s.size, s.body = nil, 0, ""
		return ""
	}
	var source *byte
	if len(raw) > 0 {
		source = &raw[0]
	}
	if s.body == "" || s.source != source || s.size != len(raw) {
		s.body = formatUnknownJSON(raw)
		s.source, s.size = source, len(raw)
	}
	return s.body
}

func (a *app) unknownAssistantBlock(c *ui.Context, raw json.RawMessage) {
	// JsonBlock's own aliases, without changing the app-wide palette.
	label, foreground, background, border := ui.Hex("#61666b"), ui.Hex("#0f1115"), ui.Hex("#f9fafb"), ui.RGBA(0, 0, 0, .04)
	if a.theme.Dark {
		label, foreground, background, border = ui.Hex("#cfd3d6"), ui.Hex("#f9fafb"), ui.Hex("#1b1b1c"), ui.RGBA(255, 255, 255, .06)
	}
	root := ui.Column(c).MinWidth(0).Shrink(0).Margin(4, 0)
	s := ui.Local(root, "unknown-json", func() unknownJSONState { return unknownJSONState{} })
	root.Children(func() {
		arrow := "▸"
		if s.Open {
			arrow = "▾"
		}
		if ui.ButtonBase(c).AlignSelf(ui.Start).Padding(2, 6).Radius(8).Label("未知内容块").Children(func() {
			ui.Text(c, arrow+" 未知内容块").FontSize(12).FixedLineHeight(18).TextColor(label)
		}).Clicked() {
			s.Open = !s.Open
		}
		body := s.display(raw) // Closed blocks do not parse or format their payload.
		if !s.Open {
			return
		}
		// The original pre uses content-box max-height:200 plus 8px padding
		// and .5px borders. MyGo dimensions include those in its border box.
		ui.ScrollBoth(c).MaxHeight(217).MinWidth(0).Shrink(0).Focusable().Label("未知内容块 JSON").Margin(4, 0, 0).Padding(8).Radius(16).Border(.5, border).Background(background).Children(func() {
			font := a.uiPrefs.CodeFontFamily
			if font == "" {
				font = "SF Mono, Menlo"
			}
			ui.Text(c, body).Font(font).FontSize(11).FixedLineHeight(16).NoWrap().Selectable().TextColor(foreground)
		})
	})
}

// JSON arriving from the helper has already been JSON.stringify-normalized.
// Token formatting preserves object order and canonical numeric wire tokens,
// decodes strings, and adds the original two-space indentation. Unlike a full
// MarshalIndent, the writer retains at most the original 20,000 UTF-16 units.
func formatUnknownJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "undefined"
	}
	out := &jsonDisplayWriter{raw: raw}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := writeJSONDisplay(decoder, out, 0); err != nil {
		out = &jsonDisplayWriter{}
		out.write(string(raw))
	}
	body := out.prefix.String()
	if out.total > unknownJSONMaxChars {
		body += fmt.Sprintf("\n… 已截断，共 %d 字符", out.total)
	}
	return body
}

type jsonDisplayWriter struct {
	prefix strings.Builder
	total  int
	raw    []byte
}

func (w *jsonDisplayWriter) write(text string) {
	for _, r := range text {
		units := 1
		if r > 0xffff {
			units = 2
		}
		remaining := unknownJSONMaxChars - w.total
		if remaining >= units {
			w.prefix.WriteRune(r)
		} else if remaining == 1 {
			// JS slice can end on a lone high surrogate. Native text renders
			// that final UTF-16 unit as the same replacement glyph.
			w.prefix.WriteRune(utf8.RuneError)
		}
		w.total += units
	}
}

func (w *jsonDisplayWriter) indent(depth int) {
	spaces := depth * 2
	for i := 0; i < min(spaces, max(0, unknownJSONMaxChars-w.total)); i++ {
		w.prefix.WriteByte(' ')
	}
	w.total += spaces
}

func (w *jsonDisplayWriter) quote(text string) {
	w.write("\"")
	w.quoteContent(text)
	w.write("\"")
}

func (w *jsonDisplayWriter) quoteContent(text string) {
	for _, r := range text {
		switch r {
		case '"', '\\':
			w.write("\\" + string(r))
		case '\b':
			w.write(`\b`)
		case '\f':
			w.write(`\f`)
		case '\n':
			w.write(`\n`)
		case '\r':
			w.write(`\r`)
		case '\t':
			w.write(`\t`)
		default:
			if r < 0x20 {
				w.write(fmt.Sprintf(`\u%04x`, r))
			} else {
				w.write(string(r))
			}
		}
	}
}

func unicodeJSONEscape(raw []byte, at int) (uint16, bool) {
	if at+6 > len(raw) || raw[at] != '\\' || raw[at+1] != 'u' {
		return 0, false
	}
	var unit uint16
	for _, ch := range raw[at+2 : at+6] {
		unit <<= 4
		switch {
		case ch >= '0' && ch <= '9':
			unit |= uint16(ch - '0')
		case ch >= 'a' && ch <= 'f':
			unit |= uint16(ch-'a') + 10
		case ch >= 'A' && ch <= 'F':
			unit |= uint16(ch-'A') + 10
		default:
			return 0, false
		}
	}
	return unit, true
}

// Go's decoder replaces existing lone UTF-16 surrogates with U+FFFD. The
// original JSON.stringify instead prints their six-character escaped form.
// Consult just this token's original spelling for that uncommon case; normal
// pairs, escaped backslashes, controls and CJK still use decoded string data.
func (w *jsonDisplayWriter) quoteToken(start, end int64, decoded string) {
	token := w.raw[start:end]
	first := bytes.IndexByte(token, '"')
	if first < 0 {
		w.quote(decoded)
		return
	}
	inner := token[first+1 : len(token)-1]
	type loneUnit struct {
		at   int
		unit uint16
	}
	var lone []loneUnit
	for i := 0; i < len(inner); {
		if inner[i] != '\\' {
			i++
			continue
		}
		unit, ok := unicodeJSONEscape(inner, i)
		if !ok {
			i += 2
			continue
		}
		if unit >= 0xd800 && unit <= 0xdbff {
			if low, ok := unicodeJSONEscape(inner, i+6); ok && low >= 0xdc00 && low <= 0xdfff {
				i += 12
				continue
			}
			lone = append(lone, loneUnit{i, unit})
		} else if unit >= 0xdc00 && unit <= 0xdfff {
			lone = append(lone, loneUnit{i, unit})
		}
		i += 6
	}
	if len(lone) == 0 {
		w.quote(decoded)
		return
	}
	w.write("\"")
	segment := func(raw []byte) {
		quoted := make([]byte, len(raw)+2)
		quoted[0], quoted[len(quoted)-1] = '"', '"'
		copy(quoted[1:], raw)
		var text string
		_ = json.Unmarshal(quoted, &text) // Token() already validated this string.
		w.quoteContent(text)
	}
	at := 0
	for _, unit := range lone {
		segment(inner[at:unit.at])
		w.write(fmt.Sprintf(`\u%04x`, unit.unit))
		at = unit.at + 6
	}
	segment(inner[at:])
	w.write("\"")
}

func writeJSONDisplay(d *json.Decoder, w *jsonDisplayWriter, depth int) error {
	start := d.InputOffset()
	token, err := d.Token()
	if err != nil {
		return err
	}
	switch value := token.(type) {
	case json.Delim:
		w.write(string(value))
		first := true
		for d.More() {
			if !first {
				w.write(",")
			}
			w.write("\n")
			w.indent(depth + 1)
			if value == '{' {
				keyStart := d.InputOffset()
				key, err := d.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok {
					return fmt.Errorf("invalid JSON object key")
				}
				w.quoteToken(keyStart, d.InputOffset(), name)
				w.write(": ")
			}
			if err := writeJSONDisplay(d, w, depth+1); err != nil {
				return err
			}
			first = false
		}
		end, err := d.Token()
		if err != nil {
			return err
		}
		if !first {
			w.write("\n")
			w.indent(depth)
		}
		w.write(fmt.Sprint(end))
	case string:
		w.quoteToken(start, d.InputOffset(), value)
	case json.Number:
		w.write(string(value))
	case bool:
		w.write(fmt.Sprint(value))
	case nil:
		w.write("null")
	default:
		return io.ErrUnexpectedEOF
	}
	return nil
}
