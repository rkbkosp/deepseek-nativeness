#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
check_dir=build/indicator-check
mkdir -p "$check_dir"
cp indicator_native/tests/main.swift "$check_dir/main.swift"
case "$(go env GOARCH)" in
  arm64) indicator_arch=arm64 ;;
  amd64) indicator_arch=x86_64 ;;
  *) echo 'Unsupported macOS indicator architecture' >&2; exit 1 ;;
esac
swiftc -target "$indicator_arch-apple-macos15.8" -O \
  indicator_native/Indicator.swift "$check_dir/main.swift" \
  -o "$check_dir/check" -framework AppKit -framework QuartzCore
"$check_dir/check"
