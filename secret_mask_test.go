package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// The mask table is the pinned upstream format list plus this client's two
// display-only additions. Each expected value is built by reimplementing the
// pinned display policy (eight visible characters, one mark per hidden
// character), so a change to either side of the rule fails here.
//
// Fixtures are assembled from fragments so that no single source literal is
// itself a credential; TestSecretMaskFixturesAreShaped proves each fixture has
// the shape its rule requires.

const (
	// `sk-` needs a digit inside its first 256 characters.
	skKey = "sk-" + "proj-" + "Ab3dE5fG7hI9jK1lM3nO5pQ7"
	// `ghp_` needs 36 or more run characters.
	ghToken = "ghp_" + "aB3d" + "E5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7b"
	// `AKIA` is bounded to exactly 16 uppercase characters.
	awsKey = "AKIA" + "IOSFODNN7EXAMPLE"
	jwt    = "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
	// A plain credential with no published prefix.
	plainToken = "aB3d" + "E5fG7hI9"
	// A password value and a base64 user:password credential.
	pwValue = "pw" + "aB3dE5fG"
	basic   = "dXNlcj" + "pwYXNzd29yZA=="
	pemBody = "MIIEowIBAAKCAQEAw7f3"
	pemKey  = "-----BEGIN " + "RSA " + "PRIVATE KEY-----\n" + pemBody + "\n" + "-----END " + "RSA " + "PRIVATE KEY-----"
	pemOne  = "-----BEGIN " + "RSA " + "PRIVATE KEY----- " + pemBody
)

// The Google format masks exactly its 35 measured characters, so its fixture
// keeps no tail to leave readable.
var runThirtyFive = strings.Repeat("B3dE", 8) + "B3d"

// prefixedForm is the pinned display form of a prefixed range: the first eight
// characters stay and every character after them becomes one mark.
func prefixedForm(run string) string {
	r := []rune(run)
	return string(r[:visiblePrefix]) + strings.Repeat("*", len(r)-visiblePrefix)
}

// fullForm is the display form of a value that keeps nothing.
func fullForm(run string) string {
	return strings.Repeat("*", len([]rune(run)))
}

// The fixtures must be the shapes the table claims, or every case below would
// pass for the wrong reason.
func TestSecretMaskFixturesAreShaped(t *testing.T) {
	if len(skKey) < 20 || !strings.HasPrefix(skKey, "sk-") {
		t.Fatalf("sk fixture length %d", len(skKey))
	}
	digits := 0
	for _, r := range skKey {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	if digits == 0 {
		t.Fatal("sk fixture has no digit")
	}
	if len(ghToken) < 40 || !strings.HasPrefix(ghToken, "ghp_") {
		t.Fatalf("gh fixture length %d", len(ghToken))
	}
	if len(awsKey) != 20 || !strings.HasPrefix(awsKey, "AKIA") {
		t.Fatalf("aws fixture length %d", len(awsKey))
	}
	if len(jwt) < 60 || !strings.HasPrefix(jwt, "eyJ") || strings.Count(jwt, ".") != 2 {
		t.Fatalf("jwt fixture length %d", len(jwt))
	}
	if len(plainToken) < 12 || strings.ContainsAny(plainToken, "-_") {
		t.Fatalf("plain fixture length %d", len(plainToken))
	}
	if len(runThirtyFive) != 35 {
		t.Fatalf("google run length %d", len(runThirtyFive))
	}
	if len(pemBody) != 20 {
		t.Fatalf("pem body length %d", len(pemBody))
	}
}

func TestMaskSecretsCredentialFormats(t *testing.T) {
	address := "postgres://user:" + pwValue + "@db.example.com/app"
	for _, tc := range []struct {
		name string
		in   string
		want string
	}{
		{"model service key", skKey, prefixedForm(skKey)},
		{"github token", ghToken, prefixedForm(ghToken)},
		{"google api key", "AIza" + runThirtyFive, prefixedForm("AIza" + runThirtyFive)},
		{"gitlab token", "glpat-" + "aB3dE5fG7hI9jK1lM3nO5", prefixedForm("glpat-" + "aB3dE5fG7hI9jK1lM3nO5")},
		{"npm token", "npm_" + strings.Repeat("aB3d", 9), prefixedForm("npm_" + strings.Repeat("aB3d", 9))},
		{"hugging face token", "hf_" + strings.Repeat("aB3dE", 6), prefixedForm("hf_" + strings.Repeat("aB3dE", 6))},
		{"aws access key id", awsKey, prefixedForm(awsKey)},
		{"alibaba access key id", "LTAI" + strings.Repeat("B3dE5f", 2) + "B3dE", prefixedForm("LTAI" + strings.Repeat("B3dE5f", 2) + "B3dE")},
		{"slack token", "xoxb-" + strings.Repeat("aB3d", 5), prefixedForm("xoxb-" + strings.Repeat("aB3d", 5))},
		{"stripe key", "sk_live_" + strings.Repeat("aB3dE", 4), prefixedForm("sk_live_" + strings.Repeat("aB3dE", 4))},
		{"webhook secret", "whsec_" + strings.Repeat("aB3dE", 5), prefixedForm("whsec_" + strings.Repeat("aB3dE", 5))},
		{"json web token", jwt, prefixedForm(jwt)},
		{"address password", address, "postgres://user:" + fullForm(pwValue) + "@db.example.com/app"},
		{"private key block", pemKey, "-----BEGIN RSA PRIVATE KEY-----\n" + strings.Repeat("*", len(pemBody)) + "\n-----END RSA PRIVATE KEY-----"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := maskSecrets(tc.in); got != tc.want {
				t.Fatalf("maskSecrets(%q)\n got %q\nwant %q", tc.in, got, tc.want)
			}
		})
	}
}

// The mask keeps the surrounding text and only ever hides the credential run.
func TestMaskSecretsKeepsSurroundingText(t *testing.T) {
	in := "curl -H 'Authorization: Bearer " + skKey + "' https://api.example.com/v1/chat"
	got := maskSecrets(in)
	if strings.Contains(got, skKey) || strings.Contains(got, "Ab3dE5fG7hI9jK1") {
		t.Fatalf("credential leaked: %q", got)
	}
	for _, keep := range []string{"curl -H 'Authorization: Bearer ", "' https://api.example.com/v1/chat"} {
		if !strings.Contains(got, keep) {
			t.Fatalf("mask swallowed %q in %q", keep, got)
		}
	}
	if !strings.HasPrefix(got, "curl -H 'Authorization: Bearer "+string([]rune(skKey)[:8])) {
		t.Fatalf("the pinned eight-character prefix is missing: %q", got)
	}
	if len([]rune(got)) != len([]rune(in)) {
		t.Fatalf("mask changed the rune count: %d -> %d", len([]rune(in)), len([]rune(got)))
	}
}

// Assignment names this client adds: a key or token keeps the pinned prefix, a
// password keeps nothing.
func TestMaskSecretsAssignments(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   string
		want string
	}{
		{"env key", "GITHUB_TOKEN=" + plainToken, "GITHUB_TOKEN=" + prefixedForm(plainToken)},
		{"exported env key", "export DEEPSEEK_API_KEY=" + plainToken, "export DEEPSEEK_API_KEY=" + prefixedForm(plainToken)},
		{"prefixed value stays at eight", "DEEPSEEK_API_KEY=" + skKey, "DEEPSEEK_API_KEY=" + prefixedForm(skKey)},
		{"password keeps nothing", "PASSWORD=" + pwValue, "PASSWORD=" + fullForm(pwValue)},
		{"json api key", `{"apiKey":"` + plainToken + `"}`, `{"apiKey":"` + prefixedForm(plainToken) + `"}`},
		{"json client secret", `{"clientSecret":"` + plainToken + `"}`, `{"clientSecret":"` + prefixedForm(plainToken) + `"}`},
		{"yaml style", "api_key: " + plainToken, "api_key: " + prefixedForm(plainToken)},
		{"x api key header", "x-api-key: " + plainToken, "x-api-key: " + prefixedForm(plainToken)},
		{"bearer header", "Authorization: Bearer " + plainToken, "Authorization: Bearer " + prefixedForm(plainToken)},
		{"basic header keeps nothing", "Authorization: Basic " + basic, "Authorization: Basic " + fullForm(basic)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := maskSecrets(tc.in); got != tc.want {
				t.Fatalf("maskSecrets(%q)\n got %q\nwant %q", tc.in, got, tc.want)
			}
		})
	}
}

// False positives are worse than a missed credential: they change text the
// user needs. Digests, digit runs, counts, prose assignments and reference
// forms all stay as written.
func TestMaskSecretsLeavesOrdinaryTextAlone(t *testing.T) {
	for _, in := range []string{
		"commit 3f2b9c1a4d5e6f708192a3b4c5d6e7f80912a3b4",
		"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		"processed 1234567890123 records",
		"max_tokens=4096",
		"tokenUsage: 123456",
		"TOKEN_COUNT=7",
		"key=value",
		"the key is not written here",
		"sk-" + "hyphenated-identifier-without-digits", // `sk-` needs a digit
		"AKIASHORT",
		"ANA" + "KIA" + "IOSFODNN7EXAMPLE", // embedded in a longer word
		"https://example.com/a/b?c=d",      // no credentials in the authority
		"https://user@example.com/repo",    // a user name without a password
		"AP_KEY_PATH=/etc/keys/app.pem",    // a path, not a key
		"API_URL=https://api.example.com",  // a URL, not a key
		"TOKEN=${DEEPSEEK_API_TOKEN}",      // a reference, not a literal
		"the password is written in a sentence",
		"11111111",             // a digit run
		"deadbeefcafebabe",     // bare hexadecimal
		"MONKEY=" + plainToken, // the name is not a credential name
		"token: something",     // a bare noun in prose, not a generated value
		"note: something else", // an ordinary label
		"12:30:45",             // a clock
		"C:\\keys\\app.pem",    // a drive path
		"a == b",
		"if (x >= 1) { y = 2 }",
		"https://example.com:8443/x", // a port, not a value
	} {
		if got := maskSecrets(in); got != in {
			t.Fatalf("maskSecrets(%q) changed ordinary text to %q", in, got)
		}
	}
}

// A credential nested in JSON is masked in place, and because one mark replaces
// one character, the document stays valid JSON with the same keys.
func TestMaskSecretsNestedJSON(t *testing.T) {
	in := `{"headers":{"Authorization":"Bearer ` + skKey + `"},"env":{"DEEPSEEK_API_KEY":"` + skKey + `","LOG":"quiet"},"retries":3}`
	got := maskSecrets(in)
	if strings.Contains(got, skKey) {
		t.Fatalf("credential leaked: %q", got)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("masked JSON is invalid: %v\n%s", err, got)
	}
	masked := prefixedForm(skKey)
	headers := decoded["headers"].(map[string]any)
	if headers["Authorization"] != "Bearer "+masked {
		t.Fatalf("header = %q", headers["Authorization"])
	}
	env := decoded["env"].(map[string]any)
	if env["DEEPSEEK_API_KEY"] != masked || env["LOG"] != "quiet" {
		t.Fatalf("env = %v", env)
	}
	if decoded["retries"].(float64) != 3 {
		t.Fatalf("retries = %v", decoded["retries"])
	}
}

// Running the mask over already masked text changes nothing, so a redraw or a
// second pass cannot erase the visible prefix.
func TestMaskSecretsIsIdempotent(t *testing.T) {
	for _, in := range []string{
		"DEEPSEEK_API_KEY=" + skKey,
		"Authorization: Bearer " + plainToken,
		pemKey,
		`{"apiKey":"` + plainToken + `"}`,
	} {
		once := maskSecrets(in)
		if twice := maskSecrets(once); twice != once {
			t.Fatalf("second pass changed %q to %q", once, twice)
		}
	}
}

// A block with no END line runs to the end of the text, and a block written on
// one line has no body to keep, so it is masked whole — both as upstream does.
func TestMaskSecretsKeyBlockBounds(t *testing.T) {
	if got := maskSecrets(pemOne); got != strings.Repeat("*", len(pemOne)) {
		t.Fatalf("one-line block = %q", got)
	}
	header := "-----BEGIN " + "OPENSSH " + "PRIVATE KEY-----"
	unterminated := header + "\n" + pemBody + "\n"
	got := maskSecrets(unterminated)
	if strings.Contains(got, pemBody) || !strings.HasPrefix(got, header+"\n") {
		t.Fatalf("unterminated block = %q", got)
	}
}

// An empty or credential-free string is returned unchanged.
func TestMaskSecretsEmpty(t *testing.T) {
	for _, in := range []string{"", "hello", "a\nb\nc"} {
		if got := maskSecrets(in); got != in {
			t.Fatalf("maskSecrets(%q) = %q", in, got)
		}
	}
}

// A tool result can be a few hundred kilobytes, and the transcript redraws on
// every streaming frame, so masking has to stay linear and cheap.
func BenchmarkMaskSecrets(b *testing.B) {
	paragraph := "the build logged a normal line of text without credentials\n"
	bulk := strings.Repeat(paragraph, 2000) + "DEEPSEEK_API_KEY=" + skKey + "\n" + pemKey + "\n"
	b.SetBytes(int64(len(bulk)))
	for i := 0; i < b.N; i++ {
		if got := maskSecrets(bulk); len(got) == 0 {
			b.Fatal("mask returned nothing")
		}
	}
}
