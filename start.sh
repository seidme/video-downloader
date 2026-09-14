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

# Try to open the browser in the background after a brief delay
(
  sleep 1.5
  if command -v xdg-open >/dev/null 2>&1; then
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
