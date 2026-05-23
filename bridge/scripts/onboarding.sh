#!/usr/bin/env bash
set -euo pipefail

# OpenChat Onboarding — 5 minutes from clone to voice call
# OpenChat 新手引导：5 分钟从 clone 到语音通话

echo "=== OpenChat Onboarding ==="
echo ""

# 1. Check prerequisites / 检查前置条件
echo "[1/5] Checking prerequisites... / 检查环境..."
NODE_REQ=24
FLUTTER_REQ="3.11"

if ! command -v node &>/dev/null; then echo "Missing Node.js / 缺少 Node.js"; exit 1; fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt "$NODE_REQ" ]; then echo "Node.js $NODE_REQ+ required"; exit 1; fi

if ! command -v flutter &>/dev/null; then echo "Missing Flutter / 缺少 Flutter"; exit 1; fi
FLUTTER_VER=$(flutter --version 2>/dev/null | head -1 | sed 's/Flutter //' | cut -d. -f1,2)

if command -v git &>/dev/null; then
  echo "  git: $(git --version | head -1)"
fi
echo "  node: $(node -v)"
echo "  flutter: $(flutter --version 2>/dev/null | head -1)"
echo ""

# 2. Install bridge dependencies / 安装后端依赖
echo "[2/5] Installing Bridge dependencies... / 安装后端依赖..."
cd "$(dirname "$0")/.."
npm install --silent 2>/dev/null || npm install
echo ""

# 3. Run Bridge tests / 运行后端测试
echo "[3/5] Running Bridge tests... / 运行测试..."
npm test 2>/dev/null || { echo "Tests failed / 测试失败"; exit 1; }
echo "  $(npm test 2>&1 | grep -c 'pass') tests passed"
echo ""

# 4. Start Bridge / 启动后端
echo "[4/5] Starting Bridge in background... / 启动后端..."
node src/main.js --headless &
BRIDGE_PID=$!
echo "  Bridge PID: $BRIDGE_PID"

# Wait for health check / 等待健康检查
for i in $(seq 1 10); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    echo "  Bridge is ready at http://localhost:3000"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "  Bridge failed to start / 启动失败"
    kill $BRIDGE_PID 2>/dev/null
    exit 1
  fi
  sleep 2
done
echo ""

# 5. Flutter setup / 安装 Flutter 依赖
echo "[5/5] Setting up Flutter client... / 安装移动端依赖..."
cd "$(dirname "$0")/../../openchat-flutter"
flutter pub get 2>/dev/null || flutter pub get
echo ""
echo "=== Onboarding complete! / 引导完成! ==="
echo ""
echo "Bridge is running at: http://localhost:3000"
echo "Flutter project ready in: openchat-flutter/"
echo ""
echo "To run Flutter app: cd openchat-flutter && flutter run"
echo "To stop Bridge: kill $BRIDGE_PID"
echo ""
echo "Next steps / 下一步:"
echo "  - Open http://localhost:3000/live in your browser"
echo "  - Run 'flutter run' for mobile client"
echo "  - Check CONTRIBUTING.md for development guide"
