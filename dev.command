#!/bin/bash
# Double-click to start Clod in live-reload dev mode.
# Renderer edits hot-reload; main/preload edits auto-restart the app.
# Close this window (or press Ctrl+C) to stop the dev server.
cd "$(dirname "$0")"
echo "Starting Clod dev server…"
echo "Leave this window open while iterating. Ctrl+C to stop."
echo
exec npm run dev
