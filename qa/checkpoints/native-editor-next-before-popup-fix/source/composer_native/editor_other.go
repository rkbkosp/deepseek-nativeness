//go:build !darwin

package composer_native

import "errors"

type Editor struct{}

func New(string, func(Snapshot)) (*Editor, error) {
	return nil, errors.New("native composer requires macOS15.8+")
}
func (*Editor) NativeView() uintptr { return 0 }
func (*Editor) Apply(Command) (Snapshot, error) {
	return Snapshot{}, errors.New("native composer requires macOS")
}
func (*Editor) Close() {}

func (*Editor) Valid() bool   { return false }
func (*Editor) Error() string { return "native composer requires macOS" }
