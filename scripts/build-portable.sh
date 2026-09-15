#!/bin/bash
# scripts/build-portable.sh
# Build a zero-attribution, self-contained portable package for Linux.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$(mktemp -d)"
DIST_DIR="$ROOT_DIR/dist"

echo "🔨 Preparing portable build directory in $BUILD_DIR..."
mkdir -p "$BUILD_DIR/video-downloader/bin"
mkdir -p "$BUILD_DIR/video-downloader/data/cookies"
mkdir -p "$BUILD_DIR/video-downloader/downloads"
mkdir -p "$DIST_DIR"

cd "$BUILD_DIR/video-downloader"

# Setup binary cache directory
CACHE_DIR="${PORTABLE_CACHE_DIR:-$ROOT_DIR/.cache-bin}"
mkdir -p "$CACHE_DIR"

# 1. Official yt-dlp binaries (Linux + Windows) with caching
if [ ! -f "$CACHE_DIR/yt-dlp" ] || [ ! -f "$CACHE_DIR/yt-dlp.exe" ]; then
  echo "⬇️ Fetching standalone yt-dlp binaries (caching for future builds)..."
  curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "$CACHE_DIR/yt-dlp"
  curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -o "$CACHE_DIR/yt-dlp.exe"
  chmod +x "$CACHE_DIR/yt-dlp"
else
  echo "⚡ Using cached standalone yt-dlp binaries..."
fi
cp "$CACHE_DIR/yt-dlp" bin/yt-dlp
cp "$CACHE_DIR/yt-dlp.exe" bin/yt-dlp.exe
chmod +x bin/yt-dlp

# 2. Official static Linux x86_64 ffmpeg with caching
if [ ! -f "$CACHE_DIR/ffmpeg" ] || [ ! -f "$CACHE_DIR/ffprobe" ]; then
  echo "⬇️ Fetching static Linux ffmpeg build (caching for future builds)..."
  FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg-static.tar.xz
  mkdir -p /tmp/ffmpeg-extracted
  tar -xf /tmp/ffmpeg-static.tar.xz -C /tmp/ffmpeg-extracted --strip-components=1
  cp /tmp/ffmpeg-extracted/ffmpeg "$CACHE_DIR/ffmpeg"
  cp /tmp/ffmpeg-extracted/ffprobe "$CACHE_DIR/ffprobe"
  chmod +x "$CACHE_DIR/ffmpeg" "$CACHE_DIR/ffprobe"
  rm -rf /tmp/ffmpeg-static.tar.xz /tmp/ffmpeg-extracted
else
  echo "⚡ Using cached static ffmpeg and ffprobe..."
fi
cp "$CACHE_DIR/ffmpeg" bin/ffmpeg
cp "$CACHE_DIR/ffprobe" bin/ffprobe
chmod +x bin/ffmpeg bin/ffprobe

# 3. Official static Linux x86_64 Node.js LTS with caching
NODE_VER="v22.14.0"
if [ ! -f "$CACHE_DIR/node" ]; then
  echo "⬇️ Fetching standalone Linux Node.js binary (caching for future builds)..."
  NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz"
  curl -fsSL "$NODE_URL" -o /tmp/node-linux.tar.xz
  mkdir -p /tmp/node-extracted
  tar -xf /tmp/node-linux.tar.xz -C /tmp/node-extracted --strip-components=1
  cp /tmp/node-extracted/bin/node "$CACHE_DIR/node"
  chmod +x "$CACHE_DIR/node"
  rm -rf /tmp/node-linux.tar.xz /tmp/node-extracted
else
  echo "⚡ Using cached standalone Node.js..."
fi
cp "$CACHE_DIR/node" bin/node
chmod +x bin/node

# 4. Copy app files & multi-platform launchers
echo "📁 Copying application source files..."
cp "$ROOT_DIR/server.js" ./
cp "$ROOT_DIR/package.json" ./
cp -r "$ROOT_DIR/public" ./
cp -r "$ROOT_DIR/chrome-extension" ./
cp "$ROOT_DIR/start.sh" ./
cp "$ROOT_DIR/VideoDownloader.desktop" ./
cp "$ROOT_DIR/VideoDownloader.bat" ./ 2>/dev/null || true
cp "$ROOT_DIR/start.bat" ./ 2>/dev/null || true
cp "$ROOT_DIR/create-desktop-shortcut.bat" ./ 2>/dev/null || true
cp "$ROOT_DIR/VideoDownloader.command" ./ 2>/dev/null || true
cp "$ROOT_DIR/start.command" ./ 2>/dev/null || true
chmod +x start.sh VideoDownloader.desktop VideoDownloader.command start.command 2>/dev/null || true

# 5. Install minimal production dependencies
echo "📦 Copying production node_modules..."
if [ -d "$ROOT_DIR/node_modules" ]; then
  cp -r "$ROOT_DIR/node_modules" ./
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "video-downloader-app"; then
  docker cp video-downloader-app:/app/node_modules ./
elif command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund
fi

# 6. Add clean README with multi-platform instructions
cat << 'EOF' > README-LOCAL.md
# Codeeve - Video & Audio Downloader (Portable)

A self-contained, local video and audio downloader.
Runs 100% on your machine with zero external dependencies.

## Quick Start:

### Windows:
1. Extract the `.zip` archive into any folder.
2. Double-click `VideoDownloader.bat` (or run `create-desktop-shortcut.bat`).
3. Your browser opens automatically at: http://127.0.0.1:3000

### macOS:
1. Extract the archive into any folder.
2. Double-click `VideoDownloader.command`.
3. Your browser opens automatically at: http://127.0.0.1:3000

### Linux:
1. Extract the archive into any folder.
2. Double-click `VideoDownloader.desktop` OR run `./start.sh` in terminal.
3. Your browser opens automatically at: http://127.0.0.1:3000
EOF

# 7. Add cookie placeholder (no private cookies included!)
cat << 'EOF' > data/cookies/README.md
# Optional Cookies Directory

If downloading from platforms that require login (e.g. age-restricted videos):
Place your exported Netscape-format cookie file here named `account.txt`.
EOF

# 8. Create stripped, zero-attribution packages
echo "📦 Compressing into zero-attribution packages..."
cd "$BUILD_DIR"

TAR_OUT="$DIST_DIR/video-downloader-linux.tar.gz"
ZIP_OUT="$DIST_DIR/video-downloader-portable.zip"
rm -f "$TAR_OUT" "$ZIP_OUT"

# Strip host UID/GID and timestamps for zero forensic fingerprinting
tar \
  --owner=0 --group=0 --numeric-owner \
  --mtime='2026-01-01 00:00:00Z' \
  -czf "$TAR_OUT" video-downloader

# Also create universal .zip archive for Windows & macOS users
if command -v zip >/dev/null 2>&1; then
  echo "📦 Compressing into universal ZIP for Windows and macOS..."
  zip -rq "$ZIP_OUT" video-downloader
fi

rm -rf "$BUILD_DIR"
echo "✅ Build completed successfully:"
echo "   Linux tar.gz:  $TAR_OUT ($(du -h "$TAR_OUT" 2>/dev/null | cut -f1))"
if [ -f "$ZIP_OUT" ]; then
  echo "   Universal zip: $ZIP_OUT ($(du -h "$ZIP_OUT" 2>/dev/null | cut -f1))"
fi
exit 0
