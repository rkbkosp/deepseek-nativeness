#!/bin/zsh
set -euo pipefail
proof_dir=${0:A:h}
desktop_dir=${proof_dir:h:h}
proof_bundle="$proof_dir/build/Native Composer Next.app"
mkdir -p "$proof_bundle/Contents/MacOS" "$proof_bundle/Contents/Resources" "$proof_bundle/Contents/Frameworks"
cd "$desktop_dir"
swiftc -swift-version 5 -target arm64-apple-macos15.8 -emit-library -Xlinker -install_name -Xlinker '@rpath/libNativeComposer.dylib' -o "$proof_bundle/Contents/Frameworks/libNativeComposer.dylib" composer_native/ComposerEditor.swift composer_native/ReferenceGlyphs.swift qa/nstext-proof/EditorChecks.swift
CGO_ENABLED=0 go build -o "$proof_bundle/Contents/MacOS/native-composer-next" ./qa/native-editor-next
mkdir -p "$proof_bundle/Contents/Resources/runtime"
cp "$(command -v node)" "$proof_bundle/Contents/Resources/runtime/node"
codesign --force --sign - "$proof_bundle/Contents/Resources/runtime/node"
node qa/native-editor-next/bundle-fixture.mjs "$proof_bundle/Contents/Resources/composer-wire-fixture.mjs"
cat > "$proof_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>native-composer-next</string><key>CFBundleIdentifier</key><string>local.native-dsh.composer-next</string><key>CFBundleName</key><string>Native Composer Next</string><key>LSMinimumSystemVersion</key><string>15.8</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>
PLIST
codesign --force --sign - "$proof_bundle/Contents/Frameworks/libNativeComposer.dylib"
codesign --force --sign - "$proof_bundle"
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
/usr/bin/open -n "$proof_bundle" --args "$@"
