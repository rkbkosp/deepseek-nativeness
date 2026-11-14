#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bundle="build/Native DSH Remote.app"
# Build a fresh tree so old chunks/dependencies cannot survive a candidate.
app="build/.native-dsh-stage-$$"
assets="dist"
if [ "${1:-}" = "--use-next-assets" ]; then
  assets="dist-next"
fi
if [ "${1:-}" = "--use-perf-assets" ]; then
  assets="dist-perf-next"
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/remote"
if [ "${1:-}" != "--use-built-assets" ] && [ "${1:-}" != "--use-next-assets" ] && [ "${1:-}" != "--use-perf-assets" ]; then
  npm run --prefix remote build
  npm run --prefix compat build
fi
CGO_ENABLED=0 go build -buildvcs=false -trimpath -tags mygo_noinspector -ldflags '-s -w -X github.com/egoist/mygo.production=1' -o "$app/Contents/MacOS/native-dsh" .
cp "$(command -v node)" "$app/Contents/MacOS/node"
if [ ! -f "remote/$assets/bridge.bundle.mjs" ] || [ ! -f "compat/$assets/index.html" ]; then
  echo 'Build the selected Remote and compatibility assets before packaging.' >&2
  exit 1
fi
if [ "$assets" = "dist-perf-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-perf-next
elif [ "$assets" = "dist-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-next
else
  node remote/package-runtime.mjs "$app/Contents/Resources/remote"
fi
cp "remote/$assets/bridge.bundle.mjs" "$app/Contents/Resources/remote/bridge.mjs"
cp "remote/$assets/build-meta.json" "$app/Contents/Resources/remote/source-manifest.json"
mkdir -p "$app/Contents/Resources/compat"
cp -R "compat/$assets/." "$app/Contents/Resources/compat/"
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
<key>LSMinimumSystemVersion</key><string>15.8</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
mkdir -p build/gui-checkpoints
if [ -d "$bundle" ]; then
  mv "$bundle" "build/gui-checkpoints/retired-bundle-$$"
fi
mv "$app" "$bundle"
printf '%s\n' "$bundle"
