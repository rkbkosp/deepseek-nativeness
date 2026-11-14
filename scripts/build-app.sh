#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
app="build/Native DSH Remote.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/remote"
if [ "${1:-}" != "--use-built-assets" ]; then
  npm run --prefix remote build
  npm run --prefix compat build
fi
CGO_ENABLED=0 go build -buildvcs=false -trimpath -tags mygo_noinspector -ldflags '-s -w -X github.com/egoist/mygo.production=1' -o "$app/Contents/MacOS/native-dsh" .
cp "$(command -v node)" "$app/Contents/MacOS/node"
if [ ! -f remote/dist/bridge.bundle.mjs ]; then
  echo 'Build remote/dist/bridge.bundle.mjs before packaging.' >&2
  exit 1
fi
rm -rf "$app/Contents/Resources/remote/node_modules"
node remote/package-runtime.mjs "$app/Contents/Resources/remote"
rm -rf "$app/Contents/Resources/compat"
mkdir -p "$app/Contents/Resources/compat"
cp -R compat/dist/. "$app/Contents/Resources/compat/"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>native-dsh</string>
<key>CFBundleIdentifier</key><string>cn.rkbkosp.native-dsh.remote</string>
<key>CFBundleName</key><string>Native DSH Remote</string>
<key>CFBundleDisplayName</key><string>Native DSH Remote</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
printf '%s\n' "$app"
