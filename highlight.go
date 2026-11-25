package main

import (
	"strings"
	"unicode"

	"github.com/egoist/mygo/ui"
)

func codeLanguage(path string) string {
	switch strings.ToLower(strings.TrimPrefix(path[strings.LastIndex(path, ".")+1:], ".")) {
	case "go":
		return "go"
	case "js", "jsx", "mjs", "cjs":
		return "js"
	case "ts", "tsx":
		return "ts"
	case "py":
		return "python"
	case "rs":
		return "rust"
	case "sh", "bash", "zsh":
		return "sh"
	}
	return ""
}

var highlightKeywords = map[string]bool{
	"package": true, "func": true, "var": true, "const": true, "type": true, "struct": true,
	"interface": true, "map": true, "chan": true, "go": true, "defer": true, "return": true,
	"if": true, "else": true, "for": true, "range": true, "switch": true, "case": true,
	"default": true, "break": true, "continue": true, "select": true, "import": true,
	"class": true, "function": true, "let": true, "new": true, "async": true, "await": true,
	"export": true, "from": true, "extends": true, "implements": true, "public": true,
	"private": true, "static": true, "try": true, "catch": true, "throw": true, "finally": true,
	"def": true, "elif": true, "pass": true, "with": true, "as": true, "lambda": true,
	"fn": true, "impl": true, "match": true, "use": true, "mod": true, "pub": true,
	"true": true, "false": true, "nil": true, "null": true, "undefined": true,
}

// highlightSpans colors one line for the read card. It is intentionally a
// small, line-scoped lexer: keywords, strings, numbers and line comments are
// enough to match the reference's code read at a glance, and it never needs
// to carry parser state across the folded window.
func highlightSpans(line, lang string, normal, keyword, str, comment, number ui.Color) []ui.Span {
	lower := strings.ToLower(lang)
	hashComment := lower == "py" || lower == "python" || lower == "sh" || lower == "bash" || lower == "yaml" || lower == "toml" || lower == "ruby"
	var spans []ui.Span
	add := func(text string, color ui.Color) {
		if text == "" {
			return
		}
		if n := len(spans); n > 0 && spans[n-1].Color == color {
			spans[n-1].Text += text
			return
		}
		spans = append(spans, ui.Span{Text: text, Color: color})
	}
	for i := 0; i < len(line); {
		c := line[i]
		if strings.HasPrefix(line[i:], "//") || (hashComment && c == '#') {
			add(line[i:], comment)
			break
		}
		if strings.HasPrefix(line[i:], "/*") {
			end := strings.Index(line[i+2:], "*/")
			if end < 0 {
				add(line[i:], comment)
				break
			}
			add(line[i:i+2+end+2], comment)
			i += 2 + end + 2
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			j := i + 1
			for j < len(line) {
				if line[j] == '\\' {
					j += 2
					continue
				}
				if line[j] == c {
					j++
					break
				}
				j++
			}
			if j > len(line) {
				j = len(line)
			}
			add(line[i:j], str)
			i = j
			continue
		}
		if unicode.IsDigit(rune(c)) {
			j := i + 1
			for j < len(line) && (unicode.IsDigit(rune(line[j])) || strings.ContainsRune(".xXabcdefABCDEF_", rune(line[j]))) {
				j++
			}
			add(line[i:j], number)
			i = j
			continue
		}
		if c == '_' || unicode.IsLetter(rune(c)) {
			j := i + 1
			for j < len(line) && (line[j] == '_' || unicode.IsLetter(rune(line[j])) || unicode.IsDigit(rune(line[j]))) {
				j++
			}
			word := line[i:j]
			if highlightKeywords[word] {
				add(word, keyword)
			} else {
				add(word, normal)
			}
			i = j
			continue
		}
		add(line[i:i+1], normal)
		i++
	}
	return spans
}
