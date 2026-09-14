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

# 1. Download official Linux x86_64 yt-dlp binary
echo "⬇️ Fetching standalone yt-dlp binary..."
curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp
chmod +x bin/yt-dlp

# 2. Download official static Linux x86_64 ffmpeg
echo "⬇️ Fetching static Linux ffmpeg build..."
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg-static.tar.xz
mkdir -p /tmp/ffmpeg-extracted
tar -xf /tmp/ffmpeg-static.tar.xz -C /tmp/ffmpeg-extracted --strip-components=1
cp /tmp/ffmpeg-extracted/ffmpeg bin/ffmpeg
cp /tmp/ffmpeg-extracted/ffprobe bin/ffprobe
chmod +x bin/ffmpeg bin/ffprobe
rm -rf /tmp/ffmpeg-static.tar.xz /tmp/ffmpeg-extracted

# 3. Download official static Linux x86_64 Node.js LTS
echo "⬇️ Fetching standalone Linux Node.js binary..."
NODE_VER="v22.14.0"
NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz"
curl -fsSL "$NODE_URL" -o /tmp/node-linux.tar.xz
mkdir -p /tmp/node-extracted
tar -xf /tmp/node-linux.tar.xz -C /tmp/node-extracted --strip-components=1
cp /tmp/node-extracted/bin/node bin/node
chmod +x bin/node
rm -rf /tmp/node-linux.tar.xz /tmp/node-extracted

# 4. Copy app files
echo "📁 Copying application source files..."
cp "$ROOT_DIR/server.js" ./
cp "$ROOT_DIR/package.json" ./
cp -r "$ROOT_DIR/public" ./
cp "$ROOT_DIR/start.sh" ./
cp "$ROOT_DIR/VideoDownloader.desktop" ./
chmod +x start.sh VideoDownloader.desktop

# 5. Install minimal production dependencies
echo "📦 Copying production node_modules..."
if [ -d "$ROOT_DIR/node_modules" ]; then
  cp -r "$ROOT_DIR/node_modules" ./
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "video-downloader-app"; then
  docker cp video-downloader-app:/app/node_modules ./
elif command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund
fi

# 6. Add clean README with Linux instructions
cat << 'EOF' > README-LOCAL.md
# Video Downloader (Portable)

A self-contained, local video and audio downloader.
Runs 100% on your machine with zero external dependencies.

## Quick Start on Linux:

1. Extract this archive into any folder.
2. Double-click `VideoDownloader.desktop` OR run `./start.sh` in terminal.
3. Your browser will open to: http://127.0.0.1:3000

## Notes:
- Fully portable: includes bundled Node.js, yt-dlp, and ffmpeg.
- Downloads are saved to the `downloads/` folder inside this directory.
EOF

# 7. Add cookie placeholder (no private cookies included!)
cat << 'EOF' > data/cookies/README.md
# Optional Cookies Directory

If downloading from platforms that require login (e.g. age-restricted videos):
Place your exported Netscape-format cookie file here named `account.txt`.
EOF

# 8. Create stripped, zero-attribution archive
echo "📦 Compressing into zero-attribution tarball..."
cd "$BUILD_DIR"

TAR_OUT="$DIST_DIR/video-downloader-linux.tar.gz"
rm -f "$TAR_OUT"

# Strip host UID/GID and timestamps for zero forensic fingerprinting
tar \
  --owner=0 --group=0 --numeric-owner \
  --mtime='2026-01-01 00:00:00Z' \
  -czf "$TAR_OUT" video-downloader

rm -rf "$BUILD_DIR"
echo "✅ Build completed successfully: $TAR_OUT ($(du -h "$TAR_OUT" | cut -f1))"
