#!/bin/bash
# Portable Video Downloader Launcher
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PATH="$DIR/bin:$PATH"

echo "=========================================="
echo "🚀 Starting Video Downloader locally..."
echo "🌐 Interface: http://127.0.0.1:3000"
echo "=========================================="

# Try to open the browser in the background with extension preloaded if available
(
  sleep 1.5
  EXT_OPT=""
  if [ -d "$DIR/chrome-extension" ]; then
    EXT_OPT="--load-extension=$DIR/chrome-extension"
  fi

  if command -v google-chrome >/dev/null 2>&1; then
    google-chrome $EXT_OPT "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v chromium >/dev/null 2>&1; then
    chromium $EXT_OPT "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v brave-browser >/dev/null 2>&1; then
    brave-browser $EXT_OPT "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v chromium-browser >/dev/null 2>&1; then
    chromium-browser $EXT_OPT "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:3000" >/dev/null 2>&1 || true
  fi
) &

# Run local node server
if [ -f "$DIR/bin/node" ]; then
  exec "$DIR/bin/node" server.js
else
  exec node server.js
fi
