#!/bin/bash
# ==============================================================================
# Codeeve Video Downloader - macOS 1-Click Launcher
# Double-click this file in Finder to launch the app and open your browser.
# ==============================================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Ensure Homebrew and common binary locations are on PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$DIR/bin:$PATH"

echo "===================================================="
echo "🚀 Starting Codeeve Video Downloader locally..."
echo "🌐 Interface: http://127.0.0.1:3000"
echo "===================================================="

# Automatically open default browser in the background after 1.5 seconds
(
  sleep 1.5
  open "http://127.0.0.1:3000" >/dev/null 2>&1 || true
) &

# Run Node server
if [ -f "$DIR/bin/node" ]; then
  exec "$DIR/bin/node" server.js
elif command -v node >/dev/null 2>&1; then
  exec node server.js
else
  echo ""
  echo "⚠️  Node.js was not found on your Mac."
  echo "Please install Node.js from https://nodejs.org or via Homebrew: brew install node"
  echo ""
  read -p "Press Enter to exit..."
  exit 1
fi
