#!/bin/sh
# Package the vendored dsh runtime into an application bundle and sign it.
#
# The payload is the official runtime copied out of the installed application by
# scripts/vendor-runtime.mjs; nothing in it is modified. Signing order matches
# the official build: every nested Mach-O first (the Host loads them at runtime),
# then the bundle itself.
#
#   sh scripts/package-runtime.sh "build/DeepSeek Nativeness.app"
#   sh scripts/package-runtime.sh "build/DeepSeek Nativeness.app" --sign "Developer ID Application: ..."
#   sh scripts/package-runtime.sh "build/DeepSeek Nativeness.app" --verify
#
# --sign without a value auto-detects a Developer ID Application identity.
# --timestamp adds an Apple timestamp (needs network; required only before
# notarization).
set -eu
cd "$(dirname "$0")/.."

bundle=""
identity=""
want_sign=0
timestamp=0
verify_only=0
notarize=0
no_sign=0

while [ $# -gt 0 ]; do
  case "$1" in
    --verify) verify_only=1; shift ;;
    --notarize) notarize=1; shift ;;
    --no-sign) no_sign=1; shift ;;
    --timestamp) timestamp=1; shift ;;
    --sign)
      want_sign=1
      if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then identity="$2"; shift 2; else shift; fi ;;
    --*) echo "package-runtime: unknown option $1" >&2; exit 64 ;;
    *)
      if [ -z "$bundle" ]; then bundle="$1"; else echo "package-runtime: unexpected argument $1" >&2; exit 64; fi
      shift ;;
  esac
done

if [ -z "$bundle" ]; then
  echo "usage: package-runtime.sh <app bundle> [--sign [identity]] [--timestamp] [--verify]" >&2
  exit 64
fi
if [ ! -d "$bundle" ]; then
  echo "package-runtime: no bundle at $bundle" >&2
  exit 1
fi

if [ "$want_sign" -eq 1 ] && [ -z "$identity" ]; then
  identity=$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/sed -n 's/.*"\(Developer ID Application: [^"]*\)"/\1/p' | head -1)
fi

support="$bundle/Contents/Resources/runtime"
payload="build/runtime"

# Print every Mach-O file under a directory (thin and universal magics).
list_macho() {
  find "$1" -type f 2>/dev/null | while read -r file; do
    magic=$(/usr/bin/xxd -p -l 4 "$file" 2>/dev/null || true)
    case "$magic" in
      cffaedfe|cefaedfe|feedfacf|feedface|cfcafeba|cafebabe|bebafeca) printf '%s\n' "$file" ;;
    esac
  done
}

if [ "$verify_only" -eq 0 ]; then
  if [ ! -d "$payload/dsh" ]; then
    echo "package-runtime: no vendored payload at $payload (run node scripts/vendor-runtime.mjs)" >&2
    exit 1
  fi
  if [ ! -f "$payload/launcher.mjs" ]; then
    echo "package-runtime: payload has no launcher.mjs" >&2
    exit 1
  fi
  echo "packaging runtime payload into $support"
  rm -rf "$support"
  mkdir -p "$support"
  # ditto preserves executable bits, resource forks and the symlinks the Python
  # aliases inside primary-runtime rely on.
  ditto "$payload/dsh" "$support/dsh"
  ditto "$payload/primary-runtime" "$support/primary-runtime"
  for entry in versions.json bin cli launcher.mjs manifest.json; do
    if [ -e "$payload/$entry" ]; then ditto "$payload/$entry" "$support/$entry"; fi
  done

  plist="$bundle/Contents/Info.plist"
  if ! /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$plist" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'dsh'" "$plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleTypeRole string Editor" "$plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string dsh" "$plist"
  fi
  if ! /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$plist" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string '语音输入需要使用麦克风。'" "$plist"
  fi
fi

if [ ! -d "$support" ]; then
  echo "package-runtime: no packaged runtime at $support" >&2
  exit 1
fi

resources="$bundle/Contents/Resources"
# Every Mach-O in the bundle must carry a Developer ID signature before
# notarization: the runtime payload, the frozen Remote helper's native addons
# (wrtc), and the Node copy in Contents/MacOS.
nested_count=0
for directory in "$support" "$resources/remote"; do
  [ -d "$directory" ] || continue
  count=$(list_macho "$directory" | wc -l | tr -d ' ')
  nested_count=$((nested_count + count))
done
if [ -f "$bundle/Contents/MacOS/node" ]; then nested_count=$((nested_count + 1)); fi
echo "nested Mach-O in bundle: $nested_count"

# Notarization requires a secure timestamp, so signing an identity-bound build
# always asks Apple's timestamp server (needs network).
sign_flags="--force --options runtime"
if [ "$timestamp" -eq 1 ] || [ -n "$identity" ]; then sign_flags="$sign_flags --timestamp"; fi

if [ "$no_sign" -eq 1 ]; then
  echo "keeping the existing signature (--no-sign)"
elif [ -n "$identity" ]; then
  echo "signing nested binaries with: $identity"
  {
    list_macho "$support"
    if [ -d "$resources/remote" ]; then list_macho "$resources/remote"; fi
    if [ -f "$bundle/Contents/MacOS/node" ]; then printf '%s\n' "$bundle/Contents/MacOS/node"; fi
  } | while read -r binary; do
    case "$binary" in
      *"/node/bin/node")
        # The bundled Node keeps the vendor's JIT grants; it runs plugin code.
        /usr/bin/codesign $sign_flags \
          --entitlements scripts/node-runtime-entitlements.plist \
          --sign "$identity" "$binary" ;;
      *)
        /usr/bin/codesign $sign_flags --sign "$identity" "$binary" ;;
    esac
  done
  echo "signing bundle"
  # The shell loads third-party plugin code, so the outer signature must not
  # enforce library validation, exactly like the official application.
  /usr/bin/codesign $sign_flags \
    --entitlements scripts/app-entitlements.plist \
    --sign "$identity" "$bundle"
else
  echo "no identity available: sealing the bundle ad hoc only"
  /usr/bin/codesign --force --sign - "$bundle"
fi

echo "verifying"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$bundle" 2>&1 | tail -3
du -sh "$bundle"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$bundle/Contents/Info.plist"
echo "package-runtime: ok"

if [ "$notarize" -eq 1 ]; then
  # Notarization needs an Apple credential. Accept either a stored notarytool
  # keychain profile or the three environment values, and say exactly what is
  # missing instead of failing somewhere inside notarytool.
  # Keep the archive under build/: the sandbox denies the system temp area.
  mkdir -p build
  archive="build/notary-submit-$$.zip"
  echo "archiving for submission: $archive"
  ditto -c -k --keepParent "$bundle" "$archive"

  if [ -n "${NOTARY_PROFILE:-}" ]; then
    echo "submitting with keychain profile: $NOTARY_PROFILE"
    xcrun notarytool submit "$archive" --wait --keychain-profile "$NOTARY_PROFILE"
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "submitting as $APPLE_ID (team $APPLE_TEAM_ID)"
    xcrun notarytool submit "$archive" --wait \
      --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
  else
    rm -f "$archive"
    cat >&2 <<'MESSAGE'
package-runtime: 没有可用公证凭据，未提交。
请任选其一后重跑 --notarize：
  xcrun notarytool store-credentials native-dsh-notary \
    --apple-id <你的 Apple ID> --team-id <Team ID> --password <App 专用密码>
  然后：NOTARY_PROFILE=native-dsh-notary sh scripts/package-runtime.sh "<app>" --sign "Developer ID Application: ..." --notarize
或者直接提供环境变量 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID。
MESSAGE
    exit 2
  fi

  rm -f "$archive"
  echo "stapling"
  # stapler writes its intermediate ticket through confstr(_CS_DARWIN_USER_TEMP_DIR),
  # which a sandboxed build cannot write. Notarization still stands: Gatekeeper
  # finds the ticket online, so this only affects offline first launch.
  if xcrun stapler staple "$bundle" 2>&1 | tail -2 && xcrun stapler validate "$bundle" >/dev/null 2>&1; then
    echo "ticket stapled"
  else
    echo "package-runtime: 未 staple（沙箱无法写系统临时目录）。在普通终端重跑："
    echo "  xcrun stapler staple \"$bundle\""
  fi
  echo "gatekeeper check"
  spctl -a -vv "$bundle" 2>&1 | head -4 || true
fi
