#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Flags that compose with the asset selection below.
with_runtime=0
sign_identity=""
sign_requested=0
remaining_args=""
for argument in "$@"; do
  case "$argument" in
    --with-runtime) with_runtime=1 ;;
    --sign) sign_requested=1 ;;
    --sign=*) sign_requested=1; sign_identity="${argument#--sign=}" ;;
    *) remaining_args="$remaining_args $argument" ;;
  esac
done
# shellcheck disable=SC2086
set -- $remaining_args
if [ $# -eq 0 ]; then set --; fi

bundle="build/DeepSeek Nativeness.app"
bundle_name="DeepSeek Nativeness"
# The bundle identifier is the app's stable identity: renaming the product must
# not make macOS treat a rebuilt app as a different one.
bundle_id="cn.rkbkosp.native-dsh.remote"
# Build a fresh tree so old chunks/dependencies cannot survive a candidate.
app="build/.native-dsh-stage-$$"
assets="dist"
remote_assets="dist"
if [ "${1:-}" = "--use-next-assets" ]; then
  assets="dist-next"
fi
if [ "${1:-}" = "--use-perf-assets" ]; then
  assets="dist-perf-next"
fi
remote_assets="$assets"
if [ "${1:-}" = "--use-layout-assets" ]; then
  assets="dist-layout-next"
  remote_assets="dist-export-next"
  # Preserve the GUI7 review/fallback application byte-for-byte.
  bundle="build/Native DSH Remote GUI8.app"
fi
if [ "${1:-}" = "--use-forced-layout-assets" ]; then
  assets="dist-layout-forced-test"
  remote_assets="dist-export-next"
  bundle="build/Native DSH Remote Anchor QA.app"
  bundle_name="Native DSH Remote Anchor QA"
  bundle_id="cn.rkbkosp.native-dsh.remote.anchor-qa"
fi
if [ "${1:-}" = "--use-gui9-assets" ]; then
  assets="dist-anchor-reflow-next"
  remote_assets="dist-export-next"
  bundle="build/Native DSH Remote GUI9.app"
fi
if [ "${1:-}" = "--use-gui9-forced-assets" ]; then
  assets="dist-anchor-reflow-forced-test"
  remote_assets="dist-export-next"
  bundle="build/Native DSH Remote Anchor QA GUI9.app"
  bundle_name="Native DSH Remote Anchor QA GUI9"
  bundle_id="cn.rkbkosp.native-dsh.remote.anchor-qa"
fi
if [ "${1:-}" = "--use-gui10-assets" ]; then
  assets="dist-anchor-reflow-next"
  remote_assets="dist-export-next"
  bundle="build/Native DSH Remote GUI10.app"
fi
if [ "${1:-}" = "--use-gui10-forced-assets" ]; then
  assets="dist-anchor-reflow-forced-test"
  remote_assets="dist-export-next"
  bundle="build/Native DSH Remote Anchor QA GUI10.app"
  bundle_name="Native DSH Remote Anchor QA GUI10"
  bundle_id="cn.rkbkosp.native-dsh.remote.anchor-qa"
fi
if [ "${1:-}" = "--use-gui11-assets" ]; then
  assets="dist-anchor-reflow-next"
  remote_assets="dist-chat-process-next"
  bundle="build/Native DSH Remote GUI11.app"
fi
if [ "${1:-}" = "--use-gui11-forced-assets" ]; then
  assets="dist-anchor-reflow-forced-test"
  remote_assets="dist-chat-process-next"
  bundle="build/Native DSH Remote Anchor QA GUI11.app"
  bundle_name="Native DSH Remote Anchor QA GUI11"
  bundle_id="cn.rkbkosp.native-dsh.remote.anchor-qa"
fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/remote"
case "${1:-}" in
  --use-built-assets|--use-next-assets|--use-perf-assets|--use-layout-assets|--use-forced-layout-assets|--use-gui9-assets|--use-gui9-forced-assets|--use-gui10-assets|--use-gui10-forced-assets|--use-gui11-assets|--use-gui11-forced-assets) ;;
  *) npm run --prefix remote build; npm run --prefix compat build ;;
esac
CGO_ENABLED=0 go build -buildvcs=false -trimpath -tags mygo_noinspector -ldflags '-s -w -X github.com/egoist/mygo.production=1' -o "$app/Contents/MacOS/native-dsh" .
if [ "$remote_assets" = "dist-chat-process-next" ]; then
  cp "build/runtime-chat-process-next/node" "$app/Contents/MacOS/node"
else
  # Prefer the runtime's own Node so a packaged build never embeds the
  # developer's interpreter; fall back to PATH only without a payload.
  payload_node="build/runtime/primary-runtime/dependencies/node/bin/node"
  if [ "$with_runtime" -eq 1 ] && [ -x "$payload_node" ]; then
    cp "$payload_node" "$app/Contents/MacOS/node"
  else
    cp "$(command -v node)" "$app/Contents/MacOS/node"
  fi
fi
if [ ! -f "remote/$remote_assets/bridge.bundle.mjs" ] || [ ! -f "compat/$assets/index.html" ]; then
  echo 'Build the selected Remote and compatibility assets before packaging.' >&2
  exit 1
fi
if [ "$remote_assets" = "dist-chat-process-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-chat-process-next
elif [ "$remote_assets" = "dist-export-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-export-next
elif [ "$remote_assets" = "dist-perf-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-perf-next
elif [ "$remote_assets" = "dist-next" ]; then
  node remote/package-runtime.mjs "$app/Contents/Resources/remote" --source-next
else
  node remote/package-runtime.mjs "$app/Contents/Resources/remote"
fi
cp "remote/$remote_assets/bridge.bundle.mjs" "$app/Contents/Resources/remote/bridge.mjs"
cp "remote/$remote_assets/build-meta.json" "$app/Contents/Resources/remote/source-manifest.json"
mkdir -p "$app/Contents/Resources/compat"
cp -R "compat/$assets/." "$app/Contents/Resources/compat/"
# The original DeepSeek Harness app icon, reused verbatim (see assets/NOTICE.md).
cp assets/app-icon.icns "$app/Contents/Resources/icon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>native-dsh</string>
<key>CFBundleIdentifier</key><string>$bundle_id</string>
<key>CFBundleName</key><string>$bundle_name</string>
<key>CFBundleDisplayName</key><string>$bundle_name</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
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
if [ "$with_runtime" -eq 1 ]; then
  if [ "$sign_requested" -eq 1 ]; then
    sh scripts/package-runtime.sh "$bundle" --sign ${sign_identity:+"$sign_identity"}
  else
    sh scripts/package-runtime.sh "$bundle"
  fi
fi
case "${1:-}" in
  --use-gui11-assets|--use-gui11-forced-assets)
    # Preserve the exact common Go linker output before binding the local app
    # identity/resources. Sign only this outer app; nested Node/wrtc stay intact.
    preseal="build/gui-checkpoints/gui11-normal-preseal-native"
    if [ "${1:-}" = "--use-gui11-forced-assets" ]; then
      preseal="build/gui-checkpoints/gui11-forced-preseal-native"
    fi
    cp "$bundle/Contents/MacOS/native-dsh" "$preseal"
    codesign --force --sign - --timestamp=none "$bundle"
    codesign --verify --strict --verbose=2 "$bundle"
    ;;
esac
printf '%s\n' "$bundle"
