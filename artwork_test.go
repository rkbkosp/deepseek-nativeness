package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// icon() takes artwork names as string literals across the view code. A name
// without an embedded asset is a build mistake; besides the runtime fallback,
// this check keeps such a name out of the tree.
func TestIconLiteralsHaveArtwork(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			ident, ok := call.Fun.(*ast.Ident)
			if !ok || ident.Name != "icon" || len(call.Args) < 2 {
				return true
			}
			lit, ok := call.Args[1].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			glyph, err := strconv.Unquote(lit.Value)
			if err != nil {
				t.Errorf("%s: unquote icon %s: %v", fset.Position(call.Pos()), lit.Value, err)
				return true
			}
			checked++
			path := "assets/icons/" + glyph + ".svg"
			if _, err := artwork.ReadFile(path); err != nil {
				t.Errorf("%s: icon(%q) has no embedded %s", fset.Position(call.Pos()), glyph, path)
			}
			return true
		})
	}
	if checked == 0 {
		t.Fatal("no icon literals were checked")
	}
}
