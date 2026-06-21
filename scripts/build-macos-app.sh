#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="ChatGPT2LocalBridge"
BUNDLE_ID="com.harzva.chatgpt2localbridge.rs"
VERSION="0.1.0"
BUILD_DIR="$ROOT_DIR/build/macos"
APP_PATH="$BUILD_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
ICONSET_DIR="$BUILD_DIR/$APP_NAME.iconset"
MODULE_CACHE_DIR="$BUILD_DIR/module-cache"
ICON_PNG="$ROOT_DIR/docs/assets/logo.png"
ICON_ICNS="$RESOURCES_DIR/AppIcon.icns"
RUST_MANIFEST="$ROOT_DIR/rust/chatgpt2localbridge-rs/Cargo.toml"
RUST_BINARY="$ROOT_DIR/rust/chatgpt2localbridge-rs/target/release/chatgpt2localbridge-rs"
SWIFT_SOURCE="$ROOT_DIR/macos/ChatGPT2LocalBridgeNative/ChatGPT2LocalBridgeApp.swift"
INSTALL_APP=0

for arg in "$@"; do
  case "$arg" in
    --install)
      INSTALL_APP=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$ICON_PNG" ]]; then
  echo "Missing icon source: $ICON_PNG" >&2
  exit 1
fi

command -v cargo >/dev/null
command -v iconutil >/dev/null
command -v sips >/dev/null
command -v swiftc >/dev/null
command -v node >/dev/null

npm run build >/dev/null
cargo build --release --manifest-path "$RUST_MANIFEST"

rm -rf "$APP_PATH" "$ICONSET_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$ICONSET_DIR" "$MODULE_CACHE_DIR"

sips -z 16 16 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
if ! iconutil -c icns "$ICONSET_DIR" -o "$ICON_ICNS" 2>/dev/null; then
  sips -s format icns "$ICON_PNG" --out "$ICON_ICNS" >/dev/null
fi

cp "$RUST_BINARY" "$RESOURCES_DIR/chatgpt2localbridge-rs"
chmod 755 "$RESOURCES_DIR/chatgpt2localbridge-rs"
node "$ROOT_DIR/scripts/export-mcp-tools.mjs" --out "$RESOURCES_DIR/mcp-tools.json" --quiet

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

swiftc \
  -O \
  -parse-as-library \
  -target arm64-apple-macosx14.0 \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -framework SwiftUI \
  -framework AppKit \
  "$SWIFT_SOURCE" \
  -o "$MACOS_DIR/$APP_NAME"
chmod 755 "$MACOS_DIR/$APP_NAME"

plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
xattr -cr "$APP_PATH" 2>/dev/null || true
codesign --force --deep --sign - "$APP_PATH" >/dev/null

if [[ "$INSTALL_APP" == "1" ]]; then
  rm -rf "/Applications/$APP_NAME.app"
  ditto "$APP_PATH" "/Applications/$APP_NAME.app"
  xattr -cr "/Applications/$APP_NAME.app" 2>/dev/null || true
  codesign --force --deep --sign - "/Applications/$APP_NAME.app" >/dev/null
  echo "/Applications/$APP_NAME.app"
else
  echo "$APP_PATH"
fi
