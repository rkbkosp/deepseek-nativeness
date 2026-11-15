#!/bin/zsh
set -euo pipefail
proof_dir=${0:A:h}
desktop_dir=${proof_dir:h:h}
proof_bundle="$proof_dir/build/Native Composer Proof.app"
mkdir -p "$proof_bundle/Contents/MacOS" "$proof_bundle/Contents/Frameworks"
swiftc -swift-version 5 -target arm64-apple-macos15.0 -emit-library -o "$proof_bundle/Contents/Frameworks/libComposerProof.dylib" "$proof_dir/ComposerProof.swift"
cd "$desktop_dir"
CGO_ENABLED=0 go build -o "$proof_bundle/Contents/MacOS/native-composer-proof" ./qa/nstext-proof
cat > "$proof_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>native-composer-proof</string><key>CFBundleIdentifier</key><string>local.native-dsh.composer-proof</string><key>CFBundleName</key><string>Native Composer Proof</string><key>LSMinimumSystemVersion</key><string>15.8</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>
PLIST
codesign --force --sign - "$proof_bundle/Contents/Frameworks/libComposerProof.dylib"
codesign --force --sign - "$proof_bundle"
if [[ "${1:-}" == "--build-only" ]]; then
  exit 0
fi
/usr/bin/open -n "$proof_bundle" --args "$@"
