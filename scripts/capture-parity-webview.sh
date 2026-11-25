#!/bin/bash
# Capture a native window that contains a WKWebView.
#
# The window snapshot used by --capture does not composite the WebKit layer, so
# compatibility pages come out black. This script launches the state, reads the
# window bounds, brings it forward, and captures the screen region at 2x.
#
# Usage: scripts/capture-parity-webview.sh <ui-state> <output.png> [extra args...]
#   NATIVE_BIN=build/_tmp/native-dsh-parity
#   DSH_HOME=/tmp/parity-same-.../native
set -eu
state=${1:?ui state}
out=${2:?output png}
shift 2
bin=${NATIVE_BIN:-build/_tmp/native-dsh-parity}
diag=$(mktemp /tmp/native-dsh-window.XXXXXX.json)
screen=$(mktemp /tmp/native-dsh-screen.XXXXXX.png)

"$bin" --local-native --theme dark --ui-state "$state" \
  --window-diagnostics "$diag" --exit-after 25s "$@" >/tmp/native-dsh-webview.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -f "$diag" "$screen"' EXIT

# The diagnostics file appears after the first frame; the page then needs time
# to settle and paint.
i=0
while [ ! -s "$diag" ] && [ "$i" -lt 40 ]; do sleep 0.25; i=$((i + 1)); done
settle=${SETTLE_SECONDS:-7}
sleep "$settle"
osascript -e 'tell application "System Events" to set frontmost of process "native-dsh-parity" to true' >/dev/null 2>&1 || true
sleep 2
screencapture -x "$screen"

# Retina screen: window bounds are points, the capture is 2x.
read -r x y w h < <(python3 - "$diag" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))["bounds"]
print(b["X"], b["Y"], b["Width"], b["Height"])
PY
)
# screencapture includes the 28pt titlebar/traffic-light strip; the reference
# view captures start at the content area, so drop that strip and pad the
# bottom to keep the reference's 1280x820 canvas.
content_h=$((h - 28))
magick "$screen" -crop "$((w * 2))x$((content_h * 2))+$((x * 2))+$(((y + 28) * 2))" +repage -background '#141414' -gravity north -extent "$((w * 2))x$((h * 2))" "$out"
echo "webview capture: $out (includes window shadow/traffic lights; the page area starts at x=280 CSS)"
