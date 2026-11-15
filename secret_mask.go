package main

// Display masking for recognized credentials, ported from the pinned upstream
// rules in packages/client/ui-secret-mask/src/client:
//
//   - credential-formats.ts          the format table (literals, shapes, sizes)
//   - credential-scanner.ts          candidate validation (bounds, boundaries)
//   - credential-masks.ts            the display form (eight visible characters,
//                                    one mark per hidden character, key blocks
//                                    keeping their BEGIN/END lines)
//
// Two rule families are added here because this client draws tool commands and
// tool output, which the upstream UserText matcher never sees:
//
//   - `NAME=value` / `"name": "value"` assignments whose name names a credential
//   - `Authorization:`/`Proxy-Authorization:` header values, by scheme
//
// Masking is a display transform only. The wire payload keeps the original
// characters, exactly as upstream documents ("Masking changes only what is
// drawn; the message text, the copy action, and the model input keep the
// original characters" — ui-secret-mask/README.md). Rewriting the prompt would
// hand a build script `sk-********`.

import (
	"sort"
	"strings"
)

// credentialKind is the literal kind that owns a masked range. Same-start
// candidates resolve by ascending kind, so a token used as an address password
// is masked completely.
type credentialKind int

const (
	credentialKeyBlock credentialKind = iota
	credentialAddress
	credentialPrefixed
)

// credentialShape is how a prefixed format's character run is validated.
type credentialShape int

const (
	shapeRun credentialShape = iota
	shapeBounded
	shapeSK
	shapeGoogle
	shapeJWT
)

// credentialClass is the ASCII class a prefixed format's run uses.
type credentialClass int

const (
	classKey        credentialClass = iota // [A-Za-z0-9_-]
	classAlnum                             // [A-Za-z0-9]
	classWord                              // \w
	classAlnumDash                         // [A-Za-z0-9-]
	classUpperAlnum                        // [A-Z0-9]
)

// visiblePrefix is the number of leading characters a key or token keeps; the
// upstream CredentialMasks uses the same constant. A password keeps none.
const visiblePrefix = 8

type credentialFormat struct {
	literal string
	kind    credentialKind
	shape   credentialShape
	run     credentialClass
	min     int
	max     int
}

func prefixedFormat(literal string, shape credentialShape, run credentialClass, min, max int) credentialFormat {
	return credentialFormat{literal: literal, kind: credentialPrefixed, shape: shape, run: run, min: min, max: max}
}

// credentialFormats is the pinned table, literal for literal.
// Source: ui-secret-mask/src/client/credential-formats.ts:67-100.
var credentialFormats = []credentialFormat{
	{literal: "-----BEGIN ", kind: credentialKeyBlock, shape: shapeRun},
	{literal: "://", kind: credentialAddress, shape: shapeRun},

	// Model services: `sk-` keys carry a digit, which hyphenated identifiers rarely do.
	prefixedFormat("sk-", shapeSK, classKey, 20, 0),
	prefixedFormat("AIza", shapeGoogle, classKey, 35, 0),

	// Code hosting and package registries.
	prefixedFormat("ghp_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("gho_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("ghu_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("ghs_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("ghr_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("github_pat_", shapeRun, classWord, 22, 0),
	prefixedFormat("glpat-", shapeRun, classKey, 20, 0),
	prefixedFormat("npm_", shapeRun, classAlnum, 36, 0),
	prefixedFormat("hf_", shapeRun, classAlnum, 30, 0),

	// Cloud access key IDs.
	prefixedFormat("AKIA", shapeBounded, classUpperAlnum, 16, 16),
	prefixedFormat("ASIA", shapeBounded, classUpperAlnum, 16, 16),
	prefixedFormat("LTAI", shapeBounded, classAlnum, 12, 20),
	prefixedFormat("AKID", shapeBounded, classAlnum, 28, 36),

	// Collaboration and payment services.
	prefixedFormat("xoxa-", shapeRun, classAlnumDash, 10, 0),
	prefixedFormat("xoxb-", shapeRun, classAlnumDash, 10, 0),
	prefixedFormat("xoxp-", shapeRun, classAlnumDash, 10, 0),
	prefixedFormat("xoxr-", shapeRun, classAlnumDash, 10, 0),
	prefixedFormat("xoxs-", shapeRun, classAlnumDash, 10, 0),
	prefixedFormat("sk_live_", shapeRun, classAlnum, 16, 0),
	prefixedFormat("sk_test_", shapeRun, classAlnum, 16, 0),
	prefixedFormat("rk_live_", shapeRun, classAlnum, 16, 0),
	prefixedFormat("rk_test_", shapeRun, classAlnum, 16, 0),
	prefixedFormat("whsec_", shapeRun, classAlnum, 24, 0),
	prefixedFormat("eyJ", shapeJWT, classKey, 8, 2048),
}

// literalStarts indexes the table by first byte, so one pass over the text
// tests only the formats that can begin at each offset.
var literalStarts = func() [256][]credentialFormat {
	var table [256][]credentialFormat
	for _, format := range credentialFormats {
		first := format.literal[0]
		table[first] = append(table[first], format)
	}
	return table
}()

// secretRange is one masked range: [start, end) over the original text.
type secretRange struct {
	start int
	end   int
	kind  credentialKind
}

// maskSecrets returns text with every recognized credential drawn masked. The
// original characters of the run never reach the returned string beyond the
// visible prefix, and every surrounding character is preserved.
func maskSecrets(text string) string {
	if text == "" {
		return text
	}
	text = maskCredentialFormats(text)
	text = maskAssignments(text)
	return maskAuthorizationHeaders(text)
}

// maskCredentialFormats applies the pinned format table.
func maskCredentialFormats(text string) string {
	ranges := credentialRanges(text)
	if len(ranges) == 0 {
		return text
	}
	var b strings.Builder
	b.Grow(len(text))
	last := 0
	for _, r := range ranges {
		b.WriteString(text[last:r.start])
		b.WriteString(maskedRange(text, r))
		last = r.end
	}
	b.WriteString(text[last:])
	return b.String()
}

// credentialRanges collects every candidate the table recognizes, merging
// overlapping candidates under the earliest one, as the upstream scanner does.
func credentialRanges(text string) []secretRange {
	if text == "" {
		return nil
	}
	var ranges []secretRange
	for at := 0; at < len(text); at++ {
		for _, format := range literalStarts[text[at]] {
			if !strings.HasPrefix(text[at:], format.literal) {
				continue
			}
			switch format.kind {
			case credentialAddress:
				if r, ok := addressRange(text, at); ok {
					ranges = append(ranges, r)
				}
			case credentialKeyBlock:
				if end := keyBlockEnd(text, at); end > 0 {
					ranges = append(ranges, secretRange{start: at, end: end, kind: credentialKeyBlock})
				}
			default:
				if end := prefixedFormatEnd(text, format, at); end > 0 {
					ranges = append(ranges, secretRange{start: at, end: end, kind: credentialPrefixed})
				}
			}
		}
	}
	return mergeSecretRanges(ranges)
}

// mergeSecretRanges sorts candidates and joins every overlap into the earliest.
func mergeSecretRanges(ranges []secretRange) []secretRange {
	if len(ranges) < 2 {
		return ranges
	}
	sort.SliceStable(ranges, func(i, j int) bool {
		if ranges[i].start != ranges[j].start {
			return ranges[i].start < ranges[j].start
		}
		return ranges[i].end > ranges[j].end
	})
	merged := ranges[:1]
	for _, r := range ranges[1:] {
		last := &merged[len(merged)-1]
		if r.start < last.end {
			if r.end > last.end {
				last.end = r.end
			}
			continue
		}
		merged = append(merged, r)
	}
	return merged
}

// maskedRange is the display form of one range. Key blocks keep their BEGIN
// and END lines and every line break; a key or token keeps its first eight
// characters; an address password or a password value keeps nothing.
func maskedRange(text string, r secretRange) string {
	switch r.kind {
	case credentialKeyBlock:
		return maskedKeyBlock(text, r.start, r.end)
	case credentialAddress:
		return maskRun(text[r.start:r.end], true, 0)
	default:
		return maskRun(text[r.start:r.end], false, visiblePrefix)
	}
}

// maskedKeyBlock keeps the first line through its break, keeps the END line,
// and masks the body while preserving its line breaks.
func maskedKeyBlock(text string, start, end int) string {
	bodyStart := start
	for i := start; i < end; i++ {
		if text[i] == '\n' {
			bodyStart = i + 1
			break
		}
	}
	bodyEnd := end
	for i := end - len("\n-----END"); i >= bodyStart; i-- {
		if text[i] == '\n' && strings.HasPrefix(text[i+1:], "-----END") {
			bodyEnd = i
			break
		}
	}
	if bodyEnd < bodyStart {
		bodyEnd = bodyStart
	}
	return text[start:bodyStart] + maskRun(text[bodyStart:bodyEnd], true, 0) + text[bodyEnd:end]
}

// maskRun replaces every hidden character with one mark. Line breaks stay when
// keepBreaks is set; visible is the number of leading characters kept.
func maskRun(run string, keepBreaks bool, visible int) string {
	var b strings.Builder
	b.Grow(len(run))
	count := 0
	for _, r := range run {
		if keepBreaks && (r == '\n' || r == '\r') {
			b.WriteRune(r)
			continue
		}
		if count < visible {
			b.WriteRune(r)
		} else {
			b.WriteByte('*')
		}
		count++
	}
	return b.String()
}

// byteAt is the byte at index, or 0 out of range.
func byteAt(text string, index int) byte {
	if index < 0 || index >= len(text) {
		return 0
	}
	return text[index]
}

// isWordAt reports an ASCII word character, matching the upstream `\b` checks.
func isWordAt(text string, index int) bool {
	c := byteAt(text, index)
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_':
		return true
	}
	return false
}

// isSpaceByte reports the ASCII members of the ECMAScript `\s` class.
func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'
}

// classAllows reports the ASCII members of a prefixed format's run class.
func classAllows(class credentialClass, c byte) bool {
	switch class {
	case classAlnum:
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
	case classWord:
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_'
	case classAlnumDash:
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-'
	case classUpperAlnum:
		return c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
	default:
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_'
	}
}

// classRunEnd is the offset after the run of class characters at start.
func classRunEnd(text string, start int, class credentialClass) int {
	end := start
	for end < len(text) && classAllows(class, text[end]) {
		end++
	}
	return end
}

// prefixedFormatEnd validates the run after a prefixed literal, or returns -1.
// Source: credential-scanner.ts:330-357.
func prefixedFormatEnd(text string, format credentialFormat, at int) int {
	if isWordAt(text, at-1) {
		return -1
	}
	start := at + len(format.literal)
	if start > len(text) {
		return -1
	}
	switch format.shape {
	case shapeSK:
		// `(?=[A-Za-z0-9_-]{0,255}\d)[A-Za-z0-9_-]{20,}`: a digit inside the
		// first 256 characters of the run, and at least `min` characters.
		end := classRunEnd(text, start, classKey)
		if end-start < format.min {
			return -1
		}
		digits := start
		for digits < end && (text[digits] < '0' || text[digits] > '9') {
			digits++
		}
		if digits-start > 255 || digits >= end {
			return -1
		}
		return end
	}
	end := classRunEnd(text, start, format.run)
	length := end - start
	if length < format.min {
		return -1
	}
	switch format.shape {
	case shapeGoogle:
		return start + format.min
	case shapeBounded:
		if length > format.max || isWordAt(text, end) {
			return -1
		}
		return end
	case shapeJWT:
		// `[A-Za-z0-9_-]{8,2048}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`
		if length > format.max || !strings.HasPrefix(text[end:], ".eyJ") {
			return -1
		}
		payloadStart := end + len(".eyJ")
		payloadEnd := classRunEnd(text, payloadStart, classKey)
		if payloadEnd-payloadStart < format.min || byteAt(text, payloadEnd) != '.' {
			return -1
		}
		signatureStart := payloadEnd + 1
		signatureEnd := classRunEnd(text, signatureStart, classKey)
		if signatureEnd-signatureStart < format.min {
			return -1
		}
		return signatureEnd
	}
	return end
}

// labelEnd is the offset after `[A-Z0-9 ]{0,40}PRIVATE KEY-----` at start, or
// -1. It reads at most 52 characters. Source: credential-scanner.ts:230-242.
func labelEnd(text string, start int) int {
	limit := start + 52
	if limit > len(text) {
		limit = len(text)
	}
	index := start
	for index < limit {
		c := text[index]
		if c > 127 || !(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == ' ') {
			break
		}
		index++
	}
	const tail = "PRIVATE KEY-----"
	tailStart := index - len("PRIVATE KEY")
	if index < start+52 && tailStart >= start && strings.HasPrefix(text[tailStart:], tail) {
		return tailStart + len(tail)
	}
	return -1
}

// keyBlockEnd is the offset after a private key block starting at at: after its
// first complete END line, or the end of the text. Source: credential-scanner.ts:248-264.
func keyBlockEnd(text string, at int) int {
	header := labelEnd(text, at+len("-----BEGIN "))
	if header < 0 {
		return -1
	}
	for search := header; ; {
		found := strings.Index(text[search:], "-----END ")
		if found < 0 {
			break
		}
		line := search + found
		if end := labelEnd(text, line+len("-----END ")); end > 0 {
			return end
		}
		search = line + 1
	}
	return len(text)
}

// schemeBefore reports whether `\b[a-z][a-z0-9+.-]{1,15}` ends at at.
// Source: credential-scanner.ts:267-276.
func schemeBefore(text string, at int) bool {
	for start := at - 1; start >= 0 && start >= at-16; start-- {
		c := text[start]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '.' || c == '-') {
			return false
		}
		if c >= 'a' && c <= 'z' && at-start >= 2 && !isWordAt(text, start-1) {
			return true
		}
	}
	return false
}

// addressRange is the password of `scheme://user:password@`. The scheme, user
// name and `@` stay readable. Source: credential-scanner.ts:284-295.
func addressRange(text string, at int) (secretRange, bool) {
	if !schemeBefore(text, at) {
		return secretRange{}, false
	}
	userStart := at + len("://")
	userEnd := userStart
	for userEnd < len(text) && !isSpaceByte(text[userEnd]) && !strings.ContainsRune("/:@?#", rune(text[userEnd])) {
		userEnd++
	}
	if userEnd-userStart > 256 || byteAt(text, userEnd) != ':' {
		return secretRange{}, false
	}
	start := userEnd + 1
	end := start
	for end < len(text) && !isSpaceByte(text[end]) && !strings.ContainsRune("/@?#", rune(text[end])) {
		end++
	}
	if end == start || byteAt(text, end) != '@' {
		return secretRange{}, false
	}
	return secretRange{start: start, end: end, kind: credentialAddress}, true
}

// nameByte reports the bytes an assignment name may contain, matching
// `[A-Za-z0-9_.-]` in the Host's own vocabulary.
func nameByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-'
}

// nameStartByte reports the bytes a name may begin with, `[A-Za-z_]`.
func nameStartByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_'
}

// valueDelimiters end an assignment value: whitespace, a quote, a JSON/argument
// boundary, or a shell separator.
func valueDelimiters(c byte) bool {
	switch c {
	case ' ', '\t', '\n', '\r', '\f', '\v', '"', '\'', '`', ',', ';', '}', ']', ')', '|', '&', '<', '>':
		return true
	}
	return false
}

// assignmentValueEnd is the offset where the value starting at start ends.
func assignmentValueEnd(text string, start int) int {
	end := start
	for end < len(text) && !valueDelimiters(text[end]) {
		end++
	}
	return end
}

// separatorAt reports whether the byte at index separates a name from a value
// rather than belonging to a longer operator, a path or a label.
func separatorAt(text string, index int) bool {
	switch text[index] {
	case ':':
		// `::`, `:=` and a Windows drive or URL scheme are not assignments.
		if index+1 < len(text) && (text[index+1] == ':' || text[index+1] == '=') {
			return false
		}
	case '=':
		if index+1 < len(text) && text[index+1] == '=' {
			return false
		}
		if index > 0 && text[index-1] == '=' {
			return false
		}
	default:
		return false
	}
	if index > 0 {
		switch text[index-1] {
		case '=', '!', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '~', '?':
			return false
		}
	}
	return true
}

// maskAssignments masks the value of an assignment whose name names a
// credential. Source: this client only — upstream leaves named assignments
// plain because the same names label ordinary values. The scan is one pass so a
// large tool result costs what its bytes cost.
func maskAssignments(text string) string {
	var b strings.Builder
	last := 0
	for i := 0; i < len(text); i++ {
		if !separatorAt(text, i) {
			continue
		}
		// The name may be separated from the separator by blanks, and a quoted
		// name closes before them.
		nameEnd := i
		for nameEnd > 0 && (text[nameEnd-1] == ' ' || text[nameEnd-1] == '\t') {
			nameEnd--
		}
		if nameEnd > 0 && (text[nameEnd-1] == '"' || text[nameEnd-1] == '\'') {
			nameEnd--
		}
		nameStart := nameEnd
		for nameStart > 0 && i-nameStart <= 64 && nameByte(text[nameStart-1]) {
			nameStart--
		}
		if nameStart == nameEnd || !nameStartByte(text[nameStart]) {
			continue
		}
		valueStart := i + 1
		for valueStart < len(text) && (text[valueStart] == ' ' || text[valueStart] == '\t') {
			valueStart++
		}
		if valueStart < len(text) && (text[valueStart] == '"' || text[valueStart] == '\'') {
			valueStart++
		}
		valueEnd := assignmentValueEnd(text, valueStart)
		if valueEnd <= valueStart || valueStart < last {
			continue
		}
		visible, ok := secretAssignment(text[nameStart:nameEnd], text[valueStart:valueEnd])
		if !ok {
			continue
		}
		b.WriteString(text[last:valueStart])
		b.WriteString(maskRun(text[valueStart:valueEnd], false, visible))
		last = valueEnd
		i = valueEnd - 1
	}
	if last == 0 {
		return text
	}
	b.WriteString(text[last:])
	return b.String()
}

// authorizationSchemes are the value schemes a credential header can carry.
var authorizationSchemes = []string{"bearer", "basic", "token", "digest"}

// maskAuthorizationHeaders masks the credential after an authorization scheme.
// The scan is one pass for the same reason the assignment scan is.
func maskAuthorizationHeaders(text string) string {
	const keyword = "authorization"
	var b strings.Builder
	last := 0
	for i := 0; i+len(keyword) <= len(text); i++ {
		if c := text[i]; c != 'a' && c != 'A' {
			continue
		}
		if !strings.EqualFold(text[i:i+len(keyword)], keyword) {
			continue
		}
		j := i + len(keyword)
		for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
			j++
		}
		if j < len(text) && (text[j] == '"' || text[j] == '\'') {
			j++
		}
		if j < len(text) && (text[j] == ':' || text[j] == '=') {
			j++
		} else {
			continue
		}
		for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
			j++
		}
		if j < len(text) && (text[j] == '"' || text[j] == '\'') {
			j++
		}
		scheme, schemeEnd := "", j
		for _, candidate := range authorizationSchemes {
			if len(candidate) <= len(text)-j && strings.EqualFold(text[j:j+len(candidate)], candidate) {
				scheme, schemeEnd = candidate, j+len(candidate)
				break
			}
		}
		if scheme == "" {
			continue
		}
		valueStart := schemeEnd
		for valueStart < len(text) && (text[valueStart] == ' ' || text[valueStart] == '\t') {
			valueStart++
		}
		if valueStart == schemeEnd {
			continue
		}
		valueEnd := assignmentValueEnd(text, valueStart)
		if valueEnd <= valueStart || valueStart < last {
			continue
		}
		value := text[valueStart:valueEnd]
		if !secretValueShaped(value) {
			continue
		}
		// Base64 user:password credentials keep nothing; a bearer token keeps the
		// same eight-character prefix a key does.
		visible := visiblePrefix
		if scheme == "basic" || scheme == "digest" {
			visible = 0
		}
		b.WriteString(text[last:valueStart])
		b.WriteString(maskRun(value, false, visible))
		last = valueEnd
		i = valueEnd - 1
	}
	if last == 0 {
		return text
	}
	b.WriteString(text[last:])
	return b.String()
}

// secretAssignment reports whether an assignment's value is a credential and
// how many leading characters the mask may keep: none for a password value,
// the pinned eight for a key or token.
func secretAssignment(name, value string) (visible int, ok bool) {
	if !secretValueShaped(value) {
		return 0, false
	}
	normalized := strings.ToUpper(strings.NewReplacer("-", "_", ".", "_").Replace(name))
	// A public key is not a credential; `_KEY` alone would otherwise catch it.
	if strings.Contains(normalized, "PUBLIC") {
		return 0, false
	}
	if strings.Contains(normalized, "PASSWORD") ||
		strings.Contains(normalized, "PASSWD") ||
		strings.HasSuffix(normalized, "_PWD") {
		// Upstream masks an address password completely; a password value keeps
		// no fragment either.
		return 0, len([]rune(value)) >= 6
	}
	if !secretName(normalized) || len([]rune(value)) < 8 {
		return 0, false
	}
	// A bare noun also labels ordinary prose ("token: something"), so its value
	// must look machine-made; a qualified name already carries the signal.
	if bareCredentialNoun(normalized) && !machineShaped(value) {
		return 0, false
	}
	return visiblePrefix, true
}

// secretName reports a name whose assignments are credentials. Separators are
// normalized to `_` before the check, so `API-KEY`, `apiKey` and `API_KEY` all
// reach the same suffix.
func secretName(normalized string) bool {
	for _, suffix := range []string{
		"_KEY", "_TOKEN", "_SECRET", "_CREDENTIAL", "_CREDENTIALS", "_AUTH", "_APIKEY", "_ACCESSKEY", "_PASSWD", "_PASSWORD",
		// camelCase names carry no separator before the noun.
		"APIKEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD",
	} {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	switch normalized {
	case "APIKEY", "API_TOKEN", "APITOKEN", "ACCESS_TOKEN", "ACCESSTOKEN", "SECRET", "SECRET_KEY", "CREDENTIAL", "CREDENTIALS", "AUTHORIZATION", "BEARER":
		return true
	}
	return false
}

// bareCredentialNoun reports a name that is only the credential noun.
func bareCredentialNoun(normalized string) bool {
	switch normalized {
	case "TOKEN", "SECRET", "BEARER", "AUTHORIZATION", "CREDENTIAL", "CREDENTIALS":
		return true
	}
	return false
}

// machineShaped reports a value with a digit, a symbol, or enough length to be
// a generated secret rather than an English word.
func machineShaped(value string) bool {
	if len([]rune(value)) >= 20 {
		return true
	}
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' {
			continue
		}
		return true
	}
	return false
}

// placeholderValues are values that name a placeholder rather than a secret.
var placeholderValues = map[string]bool{
	"null": true, "true": true, "false": true, "none": true, "undefined": true,
	"redacted": true, "changeme": true, "placeholder": true, "example": true,
	"your_key": true, "your_token": true, "your_api_key": true, "todo": true, "tbd": true,
}

// secretValueShaped rejects values that cannot be a credential literal: an
// environment reference, a placeholder, a bare number, an all-mark mask, or a
// path/flag. This is what keeps long hexadecimal digests and digit runs plain.
func secretValueShaped(value string) bool {
	if value == "" || len([]rune(value)) < 6 {
		return false
	}
	switch value[0] {
	case '$', '{', '<', '%', '/', '~', '-', '*', '#', '@':
		return false
	}
	if strings.Contains(value, "{{") {
		return false
	}
	if placeholderValues[strings.ToLower(value)] {
		return false
	}
	digits, marks, same := true, true, true
	var first rune
	for i, r := range value {
		if i == 0 {
			first = r
		}
		if r < '0' || r > '9' {
			digits = false
		}
		if r != '*' {
			marks = false
		}
		if r != first {
			same = false
		}
	}
	return !digits && !marks && !same
}
