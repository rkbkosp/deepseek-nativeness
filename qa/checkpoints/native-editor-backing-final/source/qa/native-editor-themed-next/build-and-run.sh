#!/bin/zsh
set -euo pipefail
proof_dir=${0:A:h}
desktop_dir=${proof_dir:h:h}
proof_bundle="$proof_dir/build/Native Composer Theme Proof.app"
frozen_bundle="$desktop_dir/qa/native-editor-next/build/Native Composer Next.app"
mkdir -p "$proof_bundle/Contents/MacOS" "$proof_bundle/Contents/Resources/runtime" "$proof_bundle/Contents/Frameworks"
cd "$desktop_dir"
swiftc -swift-version 5 -target arm64-apple-macos15.8 -emit-library -Xlinker -install_name -Xlinker '@rpath/libNativeComposer.dylib' -o "$proof_bundle/Contents/Frameworks/libNativeComposer.dylib" composer_native/*.swift
CGO_ENABLED=0 go build -o "$proof_bundle/Contents/MacOS/native-composer-theme-proof" ./qa/native-editor-themed-next
# These are the already reviewed local mock-Host helper/runtime, not an
# installed backend, credentials, or a mutable copy of any running task.
cp "$frozen_bundle/Contents/Resources/composer-wire-fixture.mjs" "$proof_bundle/Contents/Resources/composer-wire-fixture.mjs"
cp "$frozen_bundle/Contents/Resources/runtime/node" "$proof_bundle/Contents/Resources/runtime/node"
cat > "$proof_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>native-composer-theme-proof</string><key>CFBundleIdentifier</key><string>local.native-dsh.composer-theme-proof</string><key>CFBundleName</key><string>Native Composer Theme Proof</string><key>LSMinimumSystemVersion</key><string>15.8</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>
PLIST
codesign --force --sign - "$proof_bundle/Contents/Resources/runtime/node"
codesign --force --sign - "$proof_bundle/Contents/Frameworks/libNativeComposer.dylib"
codesign --force --sign - "$proof_bundle"
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
/usr/bin/open -n "$proof_bundle" --args "$@"
