#!/usr/bin/env bash
# Build a Linux AppImage of the cellforge desktop app.
#
# Runs from CI (release.yml) and locally. Detects webkit2gtk-4.1 on both
# Debian/Ubuntu (multiarch path) and Arch/CachyOS (/usr/lib/webkit2gtk-4.1/).
#
# Inputs (env vars):
#   CELLFORGE_APP_BIN   path to a pre-built cellforge-app binary (skips cargo)
#   APPIMAGE_OUT        output path for the final .AppImage
#
# Without env vars, does a full `cargo build --release -p cellforge-app` and
# `npm run build` then packages the result.
#
# Requires: gcc, patchelf, wget. Plus cargo + npm for the full build path.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BUILD_DIR="$REPO_ROOT/build/appimage"
APPDIR="$BUILD_DIR/AppDir"
OUT="${APPIMAGE_OUT:-$BUILD_DIR/cellforge-linux-x64-desktop.AppImage}"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$APPDIR"

if [ -n "${CELLFORGE_APP_BIN:-}" ]; then
  echo "==> Using pre-built binary at $CELLFORGE_APP_BIN"
  APP_BIN="$CELLFORGE_APP_BIN"
else
  echo "==> Building frontend"
  ( cd frontend && npm ci && npm run build )

  echo "==> Building cellforge-app (release)"
  cargo build --release -p cellforge-app
  APP_BIN="$REPO_ROOT/target/release/cellforge-app"
fi

echo "==> Staging AppDir"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
cp "$APP_BIN" "$APPDIR/usr/bin/cellforge-app"
chmod +x "$APPDIR/usr/bin/cellforge-app"
cp assets/icon.png "$APPDIR/usr/share/icons/hicolor/256x256/apps/cellforge.png"

# Locate webkit2gtk-4.1 libexec dir — the helpers (WebKitWebProcess,
# WebKitNetworkProcess, WebKitGPUProcess) live next to libwebkit2gtk-4.1.so
# but linuxdeploy-plugin-gtk copies libs only, not these helper binaries.
WEBKIT_SRC=""
for candidate in \
    /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
    /usr/lib/webkit2gtk-4.1 \
    /usr/lib64/webkit2gtk-4.1; do
  if [ -d "$candidate" ] && [ -f "$candidate/WebKitWebProcess" ]; then
    WEBKIT_SRC="$candidate"
    break
  fi
done
if [ -z "$WEBKIT_SRC" ]; then
  echo "error: webkit2gtk-4.1 helpers not found on this system" >&2
  exit 1
fi
echo "==> Using webkit2gtk-4.1 from $WEBKIT_SRC"

# Always place helpers at the canonical AppDir path; the LD_PRELOAD shim
# normalises any incoming path containing /webkit2gtk-4.1/<helper> to this
# layout regardless of what prefix was baked into libwebkit.so.
WEBKIT_DST="$APPDIR/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
mkdir -p "$WEBKIT_DST"
cp -rL "$WEBKIT_SRC"/* "$WEBKIT_DST/"

echo "==> Patching RPATH on webkit helpers"
# WebKit strips LD_LIBRARY_PATH when spawning helpers for security, so their
# transitive libs (libicudata, libgstreamer, ...) have to be discoverable via
# ELF RPATH. $ORIGIN/../.. lands in AppDir/usr/lib where linuxdeploy puts libs.
for bin in "$WEBKIT_DST"/WebKit*Process "$WEBKIT_DST"/MiniBrowser; do
  [ -f "$bin" ] && patchelf --set-rpath '$ORIGIN:$ORIGIN/..:$ORIGIN/../..' "$bin"
done

echo "==> Compiling LD_PRELOAD path-rewrite shim"
mkdir -p "$APPDIR/usr/lib"
gcc -shared -fPIC -O2 -Wall \
  -o "$APPDIR/usr/lib/libwebkit-shim.so" \
  packaging/linux/webkit-shim.c -ldl

echo "==> Installing AppRun hook"
mkdir -p "$APPDIR/apprun-hooks"
cat > "$APPDIR/apprun-hooks/webkit.sh" <<'EOF'
export LD_PRELOAD="${APPDIR}/usr/lib/libwebkit-shim.so${LD_PRELOAD:+:${LD_PRELOAD}}"
# Disable webkit's DMABUF renderer: the bundled Mesa/libgbm don't interact
# well with an unprivileged AppImage on many Wayland hosts, causing
# "Failed to create GBM buffer" and a blank gray window. Software
# compositing works fine for our HTML UI and is the standard workaround
# for Tauri/wry AppImages on Linux.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
EOF

echo "==> Fetching linuxdeploy"
cd "$BUILD_DIR"
if [ ! -d linuxdeploy-extracted ]; then
  wget -q https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
  chmod +x linuxdeploy-x86_64.AppImage
  ./linuxdeploy-x86_64.AppImage --appimage-extract >/dev/null
  mv squashfs-root linuxdeploy-extracted
fi
if [ ! -f linuxdeploy-plugin-gtk.sh ]; then
  wget -q https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh
  chmod +x linuxdeploy-plugin-gtk.sh
fi

echo "==> Running linuxdeploy"
export DEPLOY_GTK_VERSION=3
export PATH="$BUILD_DIR:$PATH"
# Arch/CachyOS binutils emits DT_RELR (.relr.dyn) compact relocations; the
# strip bundled inside linuxdeploy is older and fails on those libs with a
# flood of "unknown type [0x13]" errors. Disable stripping — the AppImage
# is slightly larger but the build runs clean on rolling distros.
export NO_STRIP=1
./linuxdeploy-extracted/AppRun \
  --appdir "$APPDIR" \
  --plugin gtk \
  --desktop-file "$REPO_ROOT/assets/app.cellforge.desktop" \
  --icon-file "$REPO_ROOT/assets/icon.png" \
  --output appimage

# linuxdeploy drops the AppImage in cwd with whatever name it picked
for f in CellForge*.AppImage cellforge*.AppImage *.AppImage; do
  [ -f "$f" ] || continue
  mv "$f" "$OUT"
  break
done

echo
echo "==> Built: $OUT"
ls -lh "$OUT"
