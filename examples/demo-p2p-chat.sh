#!/bin/bash
# Demo: 2-node P2P chat
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_DIR="/tmp/openchat-demo-$$"
mkdir -p "$DEMO_DIR/node1" "$DEMO_DIR/node2"

echo "=== OpenChat P2P Demo ==="
echo "Starting 2 bridge nodes on ports 3801 and 3802..."
echo

# Node 1
OPENCHAT_DATA_DIR="$DEMO_DIR/node1" node "$DIR/bridge/src/main.js" --port=3801 --no-direct &
PID1=$!

# Node 2 (connects to node1)
sleep 2
OPENCHAT_DATA_DIR="$DEMO_DIR/node2" node "$DIR/bridge/src/main.js" --port=3802 --direct-connect=localhost:3801 --no-direct &
PID2=$!

echo
echo "Nodes running. Try:"
echo "  curl http://localhost:3801/health"
echo "  curl http://localhost:3802/health"
echo
echo "Press Ctrl+C to stop."
wait $PID1 $PID2 2>/dev/null
echo "Demo stopped."
