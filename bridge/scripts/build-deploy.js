#!/usr/bin/env node
/**
 * build-deploy.js — 一键构建 deploy/ 部署网站
 *
 * 执行：node scripts/build-deploy.js
 * 输出：deploy/      ← 完整的跨平台部署包 + HTTP 页面
 *
 * 每次改完 bridge/src/ 后跑一次，deploy/ 自动更新。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEPLOY = path.resolve(ROOT, '..', 'deploy');
const ENV_FILE = path.join(ROOT, '.env');

// ==================== 配置 ====================

const PLATFORMS = [
  { dir: 'windows-x64',     nodeFile: 'node.exe',            script: 'install.bat',        icon: '🪟' },
  { dir: 'windows-arm64',   nodeFile: 'node.exe',            script: 'install.bat',        icon: '🪟' },
  { dir: 'macos-arm64',     nodeFile: 'node',                script: 'install.command',    icon: '🍎' },
  { dir: 'macos-x64',       nodeFile: 'node',                script: 'install.command',    icon: '🍎' },
  { dir: 'linux-x64',       nodeFile: 'node',                script: 'install.sh',         icon: '🐧' },
  { dir: 'linux-arm64',     nodeFile: 'node',                script: 'install.sh',         icon: '🐧' },
  { dir: 'linux-armv7l',    nodeFile: 'node',                script: 'install.sh',         icon: '🍓' },
  { dir: 'linux-riscv64',   nodeFile: 'node',                script: 'install.sh',         icon: '🐧' },
  { dir: 'unix',            nodeFile: 'node',                script: 'install.sh',         icon: '🔵' },
];

// ==================== 配置 ====================

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '';
}

// 优先环境变量 → 自动检测 → 交互式输入
let MOTHER_IP   = process.env.MOTHER_IP   || getLocalIP() || '';
let MOTHER_PORT = process.env.MOTHER_PORT || '3802';
let BRIDGE_NAME = process.env.BRIDGE_NAME || 'bridge-child';
let LLM_MODE    = process.env.LLM_MODE    || 'proxy';

// ==================== 交互式配置 ====================

async function promptConfig() {
  if (MOTHER_IP) return; // 环境变量或自动检测已赋值，跳过

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (query) => new Promise(resolve => rl.question(query, resolve));

  MOTHER_IP = await q('请输入母桥 IP 地址: ');
  MOTHER_IP = MOTHER_IP.trim() || getLocalIP() || '<母桥IP>';

  const portStr = await q(`母桥 P2P 端口 [${MOTHER_PORT}]: `);
  if (portStr.trim()) MOTHER_PORT = portStr.trim();

  rl.close();
}

// ==================== 工具函数 ====================

function mkdir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function cp(src, dst) {
  if (!fs.existsSync(src)) return;
  mkdir(path.dirname(dst));
  try { fs.cpSync(src, dst, { recursive: true, force: true }); }
  catch { /* 跨驱动器可能失败，忽略 */ }
}

function writeFile(p, content) {
  mkdir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
}

function sizeStr(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ==================== 1. 创建目录结构 ====================

function createDirs() {
  console.log('\n📁 创建目录结构...');
  mkdir(DEPLOY);

  // 清理旧残余（避免增量构建后面打包时超时）
  for (const p of PLATFORMS) {
    mkdir(path.join(DEPLOY, p.dir, 'bridge', 'src'));
    const oldNm = path.join(DEPLOY, p.dir, 'bridge', 'node_modules');
    if (fs.existsSync(oldNm)) {
      fs.rmSync(oldNm, { recursive: true, force: true });
      console.log('   🧹 清理旧 node_modules: ' + p.dir);
    }
  }
  console.log('   ✅ deploy/ 及子目录已创建');
}

// ==================== 2. 复制源码 ====================

function copySource() {
  console.log('\n📄 复制 bridge 源码...');

  const srcDir = path.join(ROOT, 'src');
  const pkgFile = path.join(ROOT, 'package.json');

  if (!fs.existsSync(srcDir)) {
    console.log('   ⚠️  未找到 bridge/src/，跳过');
    return;
  }

  for (const p of PLATFORMS) {
    const dst = path.join(DEPLOY, p.dir, 'bridge', 'src');
    cp(srcDir, dst);
    cp(pkgFile, path.join(DEPLOY, p.dir, 'bridge', 'package.json'));
  }
  console.log(`   ✅ 源码已复制到 ${PLATFORMS.length} 个平台目录`);
}

// ==================== 3. 生成 install.bat (Windows) ====================

function generateInstallBat(platform) {
  return `@echo off
title OpenChat Bridge

cd /d "%~dp0"

:: 检测架构
set "NODE_ARCH=win-x64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=win-arm64"
if "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "NODE_ARCH=win-arm64"

:: 检查或下载 Node.js 便携版
if not exist "..\\node.exe" (
    echo ⬇️  下载 Node.js 便携版 (%%NODE_ARCH%%)...
    powershell -Command "$zip='%TEMP%\\node.zip';$url='https://nodejs.org/dist/v22.14.0/node-v22.14.0-%%NODE_ARCH%%.zip';Invoke-WebRequest $url -OutFile $zip -UseBasicParsing;Expand-Archive $zip ([System.IO.Path]::GetDirectoryName((Get-Location).Path)+'\\..') -Force;[System.IO.File]::Move((Get-ChildItem -Recurse ([System.IO.Path]::GetDirectoryName((Get-Location).Path)+'\\..') -Filter node.exe | Select-Object -First 1).FullName,([System.IO.Path]::GetDirectoryName((Get-Location).Path)+'\\..\\node.exe')) -Force;Remove-Item $zip"
)

:: 安装依赖（首次）
if not exist "node_modules" (
    echo 📦 安装依赖...
    "..\\node.exe" npm-cli.js install --production
)

:: 启动 Bridge
set "PATH=%~dp0..;%PATH%"
start /b ..\\node.exe src\\main.js --save-config > ..\\bridge.log 2>&1

echo.
echo ================================
echo   OpenChat Bridge 已启动
echo   PID: 查看 ..\\bridge.log
echo   HTTP: http://localhost:3000
echo ================================
echo.
pause
`;
}

// ==================== 5. 生成 install.command (macOS) ====================

function generateInstallCommand(platform) {
  return `#!/bin/bash
# OpenChat Bridge — macOS 安装脚本

DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$DIR/..:$PATH"

# 检测架构
ARCH=$(uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')
NODE_ARCH="darwin-\${ARCH}"
NODE="$DIR/../node"

# 检查或下载便携版 Node.js
if [ ! -f "$NODE" ]; then
  echo "⬇️  下载 Node.js (\$NODE_ARCH)..."
  curl -sL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-\${NODE_ARCH}.tar.gz" -o /tmp/node.tar.gz
  tar -xzf /tmp/node.tar.gz -C /tmp --strip-components=2 "node-v22.14.0-\${NODE_ARCH}/bin/node"
  mv /tmp/node "$NODE"
  chmod +x "$NODE"
  rm /tmp/node.tar.gz
fi

# 安装依赖（首次）
if [ ! -d "$DIR/node_modules" ]; then
  echo "📦 安装依赖..."
  "$NODE" "$DIR/npm-cli.js" install --production --prefix "$DIR"
fi

echo "🚀 启动 OpenChat Bridge..."
"$NODE" "$DIR/src/main.js" --save-config &
echo "✅ Bridge 已启动，PID=$!"
echo "   HTTP: http://localhost:3000"
`;
}

// ==================== 6. 生成 install.sh (Linux/Unix) ====================

function generateInstallSh(platform) {
  return `#!/bin/bash
# OpenChat Bridge — Linux/Unix 安装脚本

DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$DIR/..:$PATH"

# 检测架构
ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/;s/armv7l/armv7l/')
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
NODE_ARCH="\${OS}-\${ARCH}"

# RISC-V / FreeBSD 无官方 Node.js 二进制
if [ "$ARCH" = "riscv64" ]; then
  echo "⚠️  Node.js 暂无 riscv64 官方二进制"
  echo "  请手动安装: https://github.com/riscv-forks/node/releases"
  exit 1
fi
if [ "$OS" = "freebsd" ]; then
  echo "⚠️  Node.js 无 FreeBSD 官方二进制"
  echo "  请用 pkg 安装: pkg install node22"
  echo "  然后: node src/main.js --save-config"
  exit 1
fi

NODE="$DIR/../node"

# 检查或下载便携版 Node.js
if [ ! -f "$NODE" ]; then
  echo "⬇️  下载 Node.js (\$NODE_ARCH)..."
  curl -sL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-\${NODE_ARCH}.tar.gz" -o /tmp/node.tar.gz
  tar -xzf /tmp/node.tar.gz -C /tmp --strip-components=2 "node-v22.14.0-\${NODE_ARCH}/bin/node"
  mv /tmp/node "$NODE"
  chmod +x "$NODE"
  rm /tmp/node.tar.gz
fi

# 安装依赖（首次）
if [ ! -d "$DIR/node_modules" ]; then
  echo "📦 安装依赖..."
  "$NODE" "$DIR/npm-cli.js" install --production --prefix "$DIR"
fi

echo "🚀 启动 OpenChat Bridge..."
"$NODE" "$DIR/src/main.js" --save-config &
echo "✅ Bridge 已启动，PID=$!"
echo "   HTTP: http://localhost:3000"
`;
}

// ==================== 7. 生成 deploy.ps1 (Windows 远程安装) ====================

function generateDeployPs1() {
  return `# OpenChat Bridge — Windows 远程部署脚本
# 使用: iex "& { $(iwr http://<BridgeIP>:3001/deploy/deploy.ps1).Content } <BridgeIP>"

param([string]$Server = "localhost:3001")
$url = "http://$Server/deploy"
$dest = "$env:ProgramFiles\\OpenChat"

Write-Host "🚀 正在安装 OpenChat Bridge..." -ForegroundColor Cyan
try {
  # 下载源码 + 脚本
  Invoke-WebRequest "$url/windows/bridge-deploy.zip" -OutFile "$env:TEMP\\bridge.zip"
  Expand-Archive "$env:TEMP\\bridge.zip" -DestinationPath "$dest" -Force
  Write-Host "✅ 源码已解压到 $dest" -ForegroundColor Green

  # 下载 Node.js 便携版
  Write-Host "⬇️  下载 Node.js..." -ForegroundColor Yellow
  Invoke-WebRequest "https://nodejs.org/dist/v22.14.0/win-x64/node.exe" -OutFile "$dest\\node.exe"
  Write-Host "✅ node.exe 已就绪" -ForegroundColor Green

  # 安装依赖
  Set-Location "$dest\\bridge"
  Write-Host "📦 安装依赖..." -ForegroundColor Yellow
  & "$dest\\node.exe" npm-cli.js install --production
  Write-Host "✅ 依赖已安装" -ForegroundColor Green

  # 启动
  $env:PATH = "$dest;$env:PATH"
  Start-Process -FilePath "$dest\\node.exe" -ArgumentList "$dest\\bridge\\src\\main.js --save-config" -WindowStyle Hidden
  Write-Host "✅ Bridge 已启动" -ForegroundColor Green
  Write-Host "   HTTP: http://localhost:3000"
}
catch {
  Write-Host "❌ 安装失败: $_" -ForegroundColor Red
  Read-Host "按 Enter 退出"
}
`;
}

// ==================== 8. 生成 deploy.sh (macOS/Linux 远程安装) ====================

function generateDeploySh() {
  return `#!/bin/bash
# OpenChat Bridge — macOS/Linux/Unix 远程部署脚本
# 使用: curl -s http://<BridgeIP>:3001/deploy/deploy.sh | bash -s -- <BridgeIP>

SERVER="\${1:-localhost:3001}"
URL="http://$SERVER/deploy"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')

case "$OS" in
  darwin)
    [ "$ARCH" = "arm64" ] && PLAT="macos-arm64" || PLAT="macos-x64"
    NODE_ARCH="darwin-\${ARCH}"
    ;;
  linux)
    PLAT="linux-\${ARCH}"
    NODE_ARCH="linux-\${ARCH}"
    ;;
  freebsd)
    PLAT="unix"
    NODE_ARCH="linux-\${ARCH}"
    ;;
  *)
    echo "❌ 未知系统: $OS"
    exit 1
    ;;
esac

INSTALL_DIR="$HOME/openchat-bridge"
mkdir -p "$INSTALL_DIR"

echo "🚀 下载 OpenChat Bridge ($PLAT)..."
curl -sL "$URL/$PLAT/bridge-deploy.tar.gz" -o /tmp/bridge.tar.gz
tar -xzf /tmp/bridge.tar.gz -C "$INSTALL_DIR"
echo "✅ 源码已就绪"

echo "⬇️  下载 Node.js..."

NODE_URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-\${NODE_ARCH}.tar.gz"
curl -sL "$NODE_URL" -o /tmp/node.tar.gz
tar -xzf /tmp/node.tar.gz -C "$INSTALL_DIR" --strip-components=1 "*/bin/node" "*/lib/node_modules/npm"
chmod +x "$INSTALL_DIR/node"
echo "✅ node 已就绪"

echo "📦 安装依赖..."
"$INSTALL_DIR/node" "$INSTALL_DIR/bridge/npm-cli.js" install --production --prefix "$INSTALL_DIR/bridge"

echo "🚀 启动..."
"$INSTALL_DIR/node" "$INSTALL_DIR/bridge/src/main.js" --save-config &
echo "✅ Bridge 已启动，PID=$!"
echo "   HTTP: http://localhost:3000"
`;
}

// ==================== 9. 生成 index.html ====================

function generateIndexHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenChat Bridge 部署</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f0f13; color: #e0e0e0; padding: 40px 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { font-size: 28px; margin-bottom: 8px; }
  .subtitle { color: #888; margin-bottom: 40px; }
  .platform { background: #1a1a24; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
  .platform header { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
  .btn { display: inline-block; background: #3b82f6; color: white; padding: 10px 20px;
         border-radius: 6px; text-decoration: none; font-weight: 500; margin: 8px 0; }
  .btn:hover { background: #2563eb; }
  code { background: #2a2a35; padding: 2px 8px; border-radius: 4px; font-size: 14px;
         color: #a78bfa; word-break: break-all; }
  .cmd-block { background: #2a2a35; padding: 16px; border-radius: 8px;
               font-family: 'Consolas', monospace; font-size: 13px;
               margin: 12px 0; overflow-x: auto; color: #a78bfa; }
  .tab-bar { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .tab { padding: 8px 20px; border-radius: 20px; cursor: pointer;
         background: #1a1a24; border: 1px solid #333; color: #aaa; }
  .tab.active { background: #3b82f6; border-color: #3b82f6; color: white; }
  .os-detect { margin-bottom: 24px; }
  .manual { margin-top: 16px; font-size: 14px; color: #888; }
  .manual code { background: #2a2a35; }
</style>
</head>
<body>
<div class="container">

<h1>🪐 OpenChat Bridge 部署</h1>
<p class="subtitle">选择你的操作系统，下载并启动 — 零依赖，即装即用</p>
<p class="subtitle" style="font-size:13px">当前服务器: <strong id="serverAddr"></strong></p>

<div class="os-detect" id="autoDetect">
  <p>🔄 检测到系统: <strong id="osName">未识别</strong></p>
</div>

<div class="tab-bar" id="tabBar">
  <div class="tab" data-os="windows-x64">🪟 Windows x64</div>
  <div class="tab" data-os="windows-arm64">🪟 Windows ARM</div>
  <div class="tab" data-os="macos-arm64">🍎 macOS (Apple Silicon)</div>
  <div class="tab" data-os="macos-x64">🍎 macOS (Intel)</div>
  <div class="tab" data-os="linux-x64">🐧 Linux x64</div>
  <div class="tab" data-os="linux-arm64">🐧 Linux ARM64</div>
  <div class="tab" data-os="linux-armv7l">🍓 Linux ARM32 (树莓派 3)</div>
  <div class="tab" data-os="linux-riscv64">🐧 Linux RISC-V</div>
  <div class="tab" data-os="unix">🔵 Unix (FreeBSD)</div>
</div>

<div id="platforms">
  <div class="platform active" id="p-windows-x64">
    <header>🪟 Windows x64</header>
    <a class="btn" href="windows-x64/bridge-deploy.zip" download>📥 下载部署包 (~500KB)</a>
    <p>解压后双击 <code>install.bat</code></p>
    <p class="manual">下载后解压，进入目录双击 <code>install.bat</code>，Bridge 即自动启动。</p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或 PowerShell 一键安装：</strong></p>
    <div class="cmd-block one-liner-ps1"></div>
  </div>

  <div class="platform" id="p-windows-arm64">
    <header>🪟 Windows ARM</header>
    <a class="btn" href="windows-arm64/bridge-deploy.zip" download>📥 下载部署包 (~500KB)</a>
    <p>解压后双击 <code>install.bat</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或 PowerShell 一键安装：</strong></p>
    <div class="cmd-block one-liner-ps1"></div>
  </div>

  <div class="platform" id="p-macos-arm64">
    <header>🍎 macOS (Apple Silicon)</header>
    <a class="btn" href="macos-arm64/bridge/" download>📥 下载 bridge/ 目录</a>
    <p>解压后双击 <code>install.command</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-macos-x64">
    <header>🍎 macOS (Intel)</header>
    <a class="btn" href="macos-x64/bridge/" download>📥 下载 bridge/ 目录</a>
    <p>解压后双击 <code>install.command</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-linux-x64">
    <header>🐧 Linux x64</header>
    <a class="btn" href="linux-x64/bridge/" download>📥 下载 bridge/ 目录</a>
    <p>解压后终端执行 <code>bash install.sh</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-linux-arm64">
    <header>🐧 Linux ARM64 (树莓派 4/5)</header>
    <a class="btn" href="linux-arm64/bridge-deploy.tar.gz" download>📥 下载部署包</a>
    <p>解压后终端执行 <code>bash install.sh</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-linux-armv7l">
    <header>🍓 Linux ARM32 (树莓派 2/3)</header>
    <a class="btn" href="linux-armv7l/bridge-deploy.tar.gz" download>📥 下载部署包</a>
    <p>解压后终端执行 <code>bash install.sh</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-linux-riscv64">
    <header>🐧 Linux RISC-V</header>
    <a class="btn" href="linux-riscv64/bridge-deploy.tar.gz" download>📥 下载部署包</a>
    <p>解压后终端执行 <code>bash install.sh</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div class="platform" id="p-unix">
    <header>🔵 Unix (FreeBSD)</header>
    <a class="btn" href="unix/bridge/" download>📥 下载 bridge/ 目录</a>
    <p>解压后终端执行 <code>bash install.sh</code></p>
    <hr style="border-color:#333;margin:16px 0">
    <p><strong>或终端一键安装：</strong></p>
    <div class="cmd-block one-liner-sh"></div>
  </div>

  <div style="margin-top:40px;padding:20px;background:#1a1a24;border-radius:12px;">
    <h2>🔄 后续升级</h2>
    <p>首次部署后升级走 P2P 通道，母桥代码变更自动推送到所有子桥。</p>
    <p>不需要重新下载部署包。</p>
  </div>
</div>

<script>
(function() {
  // 获取服务器地址
  const host = location.host;

  // 显示服务器地址
  document.getElementById('serverAddr').textContent = host;

  // 生成正确的 PowerShell 一行命令
  document.querySelectorAll('.one-liner-ps1').forEach(el => {
    el.textContent = 'iex "& { $(iwr http://' + host + '/deploy/deploy.ps1).Content } ' + host + '"';
  });

  // 生成正确的 Shell 一行命令
  document.querySelectorAll('.one-liner-sh').forEach(el => {
    el.textContent = 'curl -s http://' + host + '/deploy/deploy.sh | bash -s -- ' + host;
  });

  // 检测系统
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  let os = 'windows-x64';
  if (/Mac/.test(platform)) {
    os = ua.includes('ARM') ? 'macos-arm64' : 'macos-x64';
  } else if (/Linux/.test(platform)) {
    os = 'linux-x64';
    if (ua.includes('aarch64') || ua.includes('arm64')) os = 'linux-arm64';
    if (ua.includes('armv7')) os = 'linux-armv7l';
    if (ua.includes('riscv64') || ua.includes('riscv')) os = 'linux-riscv64';
  } else if (/Win/.test(platform)) {
    os = ua.includes('ARM') || ua.includes('arm64') ? 'windows-arm64' : 'windows-x64';
  }

  // 显示检测结果
  const tabLabel = document.querySelector('.tab[data-os="'+os+'"]');
  document.getElementById('osName').textContent = tabLabel ? tabLabel.textContent : 'Windows';

  // 默认显示所有平台
  document.querySelectorAll('.platform').forEach(el => el.style.display = 'block');

  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // 所有平台可见，高亮对应 tab
    });
  });

  // 默认选中 OS
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tabLabel?.classList.add('active');
})();
</script>

</div>
</body>
</html>
`;
}

// ==================== 10. 生成 config.json ====================

function generateConfigs() {
  console.log('\n⚙️  生成 config.json...');
  for (const p of PLATFORMS) {
    const hostId = randomUUID();
    const config = {
      providers: {},
      current: { provider: null, model: null },
      bridge: {
        hostId,
        name: `${BRIDGE_NAME}-${p.dir}`,
        mode: 'headless',
        host: '0.0.0.0',
        port: 3000,
        region: 'cn-east',
        dhtPort: 0,
        localBootstrap: [],
        directListen: 0,
        directConnect: [{ host: MOTHER_IP, port: parseInt(MOTHER_PORT) }],
        wsSignaling: '',
        advertiseHost: '',
        qiniuEnabled: false,
        cores: [],
        llmProxyEnabled: false,
        llmMode: LLM_MODE,
      },
    };
    writeFile(
      path.join(DEPLOY, p.dir, 'bridge', 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }
  console.log(`   ✅ ${PLATFORMS.length} 个配置文件已生成`);
}

// ==================== 11. 打包 ====================

async function createArchives() {
  console.log('\n🗜️  创建压缩包...');
  const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe';

  for (const p of PLATFORMS) {
    const platDir = path.join(DEPLOY, p.dir);
    if (!fs.existsSync(platDir)) continue;

    if (p.dir.startsWith('windows')) {
      // Windows → ZIP
      const zipPath = path.join(platDir, 'bridge-deploy.zip');
      try {
        if (fs.existsSync(sevenZip)) {
          execSync(`"${sevenZip}" a -tzip "${zipPath}" "${platDir}\\bridge\\"`, { stdio: 'pipe' });
        } else {
          execSync(`powershell -Command "Compress-Archive -Path '${platDir}\\bridge' -DestinationPath '${zipPath}' -Force"`, { stdio: 'pipe' });
        }
        console.log(`   ✅ ${p.dir}/bridge-deploy.zip: ${sizeStr(fs.statSync(zipPath).size)}`);
      } catch (e) {
        console.log(`   ⚠️  ${p.dir} ZIP 打包失败: ${e.message}`);
      }
    } else {
      // 非 Windows → tar.gz
      const tarPath = path.join(platDir, 'bridge-deploy.tar.gz');
      try {
        execSync(`tar -czf "${tarPath}" -C "${platDir}" bridge`, { stdio: 'pipe', timeout: 30000 });
        console.log(`   ✅ ${p.dir}/bridge-deploy.tar.gz: ${sizeStr(fs.statSync(tarPath).size)}`);
      } catch (e) {
        console.log(`   ⚠️  ${p.dir} tar.gz 打包失败: ${e.message}`);
      }
    }
  }
}

// ==================== 12. 输出检查 ====================

function auditOutput() {
  console.log('\n📋 构建输出检查:');

  const allFiles = [];

  // 各平台核心文件
  for (const p of PLATFORMS) {
    const base = path.join(DEPLOY, p.dir);
    const items = [
      { path: path.join(base, 'bridge', 'src', 'main.js'), label: `${p.dir}/bridge/src/main.js` },
      { path: path.join(base, 'bridge', 'package.json'), label: `${p.dir}/bridge/package.json` },
      { path: path.join(base, 'bridge', p.script), label: `${p.dir}/bridge/${p.script}` },
      { path: path.join(base, 'bridge', 'config.json'), label: `${p.dir}/bridge/config.json` },
      { path: path.join(base, `bridge-deploy.zip`), label: `${p.dir}/bridge-deploy.zip`, optional: true },
      { path: path.join(base, `bridge-deploy.tar.gz`), label: `${p.dir}/bridge-deploy.tar.gz`, optional: true },
    ];
    allFiles.push(...items);
  }

  // 顶层文件
  const topItems = [
    { path: path.join(DEPLOY, 'index.html'), label: 'index.html' },
    { path: path.join(DEPLOY, 'deploy.ps1'), label: 'deploy.ps1' },
    { path: path.join(DEPLOY, 'deploy.sh'), label: 'deploy.sh' },
  ];
  allFiles.push(...topItems);

  let missing = 0;
  let found = 0;
  for (const item of allFiles) {
    if (fs.existsSync(item.path)) {
      const size = fs.statSync(item.path).size;
      console.log(`   ✅ ${item.label}  (${sizeStr(size)})`);
      found++;
    } else if (item.optional) {
      console.log(`   🔴 ${item.label}  — 缺失（可选）`);
      missing++;
    } else {
      console.log(`   🔴 ${item.label}  — 缺失`);
      missing++;
    }
  }

  console.log(`\n   总计: ${found} 个文件就绪`, missing > 0 ? `，${missing} 个缺失` : '');
  return { found, missing };
}

// ==================== 主流程 ====================

async function main() {
  console.log('═══════════════════════════════════');
  console.log('  OpenChat deploy/ 构建脚本');
  console.log('═══════════════════════════════════\n');

  // 交互式配置
  await promptConfig();

  console.log('\n🔨 构建 deploy/ ...\n');

  const start = Date.now();

  createDirs();
  copySource();

  console.log('\n📝 生成安装脚本...');
  for (const p of PLATFORMS) {
    writeFile(
      path.join(DEPLOY, p.dir, 'bridge', p.script),
      p.dir === 'windows' ? generateInstallBat(p) :
      p.dir.startsWith('macos') ? generateInstallCommand(p) :
      generateInstallSh(p)
    );
  }
  console.log('   ✅ 安装脚本已生成');

  // 生成远程部署脚本
  writeFile(path.join(DEPLOY, 'deploy.ps1'), generateDeployPs1());
  writeFile(path.join(DEPLOY, 'deploy.sh'), generateDeploySh());

  // 生成 index.html
  writeFile(path.join(DEPLOY, 'index.html'), generateIndexHtml());

  // 生成 config.json
  generateConfigs();

  // 打包
  await createArchives();

  // 输出检查
  const { found, missing } = auditOutput();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════');
  console.log(`  ✅ 构建完成 (${elapsed}s)`);
  if (missing > 0) console.log(`  ⚠️  ${found} 个就绪，${missing} 个缺失`);
  console.log(`  输出: ${DEPLOY}`);
  console.log(`  访问: http://localhost:3001/deploy/`);
  console.log('═══════════════════════════════════\n');

  // 删除残留的 serve-deploy.js 引用
  const serveDeployPath = path.join(ROOT, 'scripts', 'serve-deploy.js');
  if (fs.existsSync(serveDeployPath)) {
    // 不再需要独立的启动脚本，deploy 站点内嵌在 Bridge 的 API 服务器里
  }
}

main().catch(e => {
  console.error('❌ 构建失败:', e.message);
  process.exit(1);
});
