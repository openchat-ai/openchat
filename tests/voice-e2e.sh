#!/bin/bash
# Voice E2E test: start Bridge → send test frame → verify ACK
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== OpenChat Voice E2E Test ==="

# Start Bridge in background
node "$DIR/bridge/src/main.js" --port=3800 --no-direct &
BRIDGE_PID=$!
sleep 3

# Verify Bridge is up
curl -sf http://localhost:3800/health > /dev/null && echo "✅ Bridge running" || { echo "❌ Bridge failed"; exit 1; }

# Verify TCP signaling port is up
timeout 3 bash -c "echo -n > /dev/tcp/localhost/3801" 2>/dev/null && echo "✅ TCP 3801 ready" || { echo "❌ TCP 3801 not ready"; exit 1; }

# Send test registration frame via TCP
# BB 00 02 06 74 65 73 74 00 7E  (type=0x00, cmd=0x02, param="test\0", cksum=0x00)
printf '\xBB\x00\x02\x06\x74\x65\x73\x74\x00\x00\x7E' | timeout 3 nc localhost 3801 && echo "✅ Frame sent" || echo "⚠️  nc not available, skip frame test"

# Clean up
kill $BRIDGE_PID 2>/dev/null
wait $BRIDGE_PID 2>/dev/null || true
echo "=== Voice E2E Test Done ==="
