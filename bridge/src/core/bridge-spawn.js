/**
 * BridgeSpawn — 居民扩窟引擎
 *
 * 三种扩窟方式：
 *  1. 同机子进程 — child_process.spawn('node', ['src/main.js', '--nesting'])
 *  2. 跨机 npm   — 生成 npm install 命令给主人执行
 *  3. 占位协议   — 邻居通过 P2P 请求 spawn
 *
 * 约束：
 *  - 同一台机器最多 3 个子 Bridge（MAX_CHILDREN）
 *  - 子 Bridge 不带 REST API（--nesting 模式），仅 P2P + 调度
 *  - 子端口自动分配 3002, 3003, 3004
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_CHILDREN = 3;
const BASE_PORT = 3002;

class BridgeSpawn {
  constructor(bridgeId = 'bridge-1', hostId = null, house = null) {
    this.bridgeId = bridgeId;
    this.hostId = hostId;
    this.house = house;
    this.children = new Map();   // childId → { process, port, startTime, name }
    this._nextPort = BASE_PORT;
  }

  /**
   * 同机扩窟：spawn 子 Bridge 进程
   * @returns { childId, port, name }
   */
  spawnNesting(options = {}) {
    if (this.children.size >= MAX_CHILDREN) {
      console.log(`[Spawn] 同机子 Bridge 已达上限 ${MAX_CHILDREN}，不再扩窟`);
      return null;
    }

    const port = this._nextPort++;
    const name = options.name || `nest-${this.bridgeId}-${port}`;
    const id = `child_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const mainScript = path.join(__dirname, '..', 'main.js');
    const childHouseId = this.hostId ? `house_${this.hostId.slice(0, 8)}_${port}` : `house_child_${port}`;
    const args = [
      mainScript,
      '--nesting',
      `--port=${port}`,
      `--name=${name}`,
      `--parent=${this.bridgeId}`,
      `--houseId=${childHouseId}`,
    ];
    if (this.hostId) args.push(`--hostId=${this.hostId}`);
    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NESTING_BRIDGE: '1' }
    });

    child.stdout.on('data', (chunk) => {
      console.log(`[Spawn/${name}] ${chunk.toString().trim()}`);
    });
    child.stderr.on('data', (chunk) => {
      console.error(`[Spawn/${name}] ${chunk.toString().trim()}`);
    });
    child.on('exit', (code) => {
      console.log(`[Spawn/${name}] 进程退出, code=${code}`);
      this.children.delete(id);
    });
    child.on('error', (err) => {
      console.error(`[Spawn/${name}] 启动失败: ${err.message}`);
      this.children.delete(id);
    });

    const childInfo = { process: child, port, startTime: Date.now(), name, id };
    this.children.set(id, childInfo);
    console.log(`[Spawn] 新窟已筑: ${name} pid=${child.pid} port=${port}`);
    return { childId: id, port, name };
  }

  /**
   * 跨机部署：生成安装脚本
   * @returns { script: string }  — 单行 curl 命令
   */
  getInstallCommand(targetHost = 'localhost:3000') {
    const script = [
      '#!/bin/bash',
      '# OpenChat 子 Bridge 自动部署脚本',
      '# 由居民生成 — 用后即焚',
      '',
      'set -e',
      '',
      'echo "OpenChat 子 Bridge 部署中..."',
      '',
      '# 检查 Node.js',
      'if ! command -v node &> /dev/null; then',
      '  echo "需要 Node.js 18+，请先安装: https://nodejs.org"',
      '  exit 1',
      'fi',
      '',
      '# 检查 git',
      'if ! command -v git &> /dev/null; then',
      '  echo "需要 git"',
      '  exit 1',
      'fi',
      '',
      `echo "从 ${targetHost} 获取配置..."`,
      `curl -s http://${targetHost}/install.sh?type=raw | bash`,
    ].join('\n');

    return { script, targetHost };
  }

  /**
   * 响应 P2P spawn 请求
   */
  handleSpawnRequest(data) {
    const p = data.payload || {};
    const name = p.name || `spawned-${data.from?.slice(0, 8)}`;
    const result = this.spawnNesting({ name });
    return result;
  }

  /** 列出所有子 Bridge */
  listChildren() {
    const result = [];
    for (const [id, info] of this.children) {
      result.push({
        id,
        name: info.name,
        port: info.port,
        uptime: Date.now() - info.startTime,
        pid: info.process?.pid
      });
    }
    return result;
  }

  /** 终止子 Bridge */
  killChild(childId) {
    const child = this.children.get(childId);
    if (!child) return false;
    try {
      child.process.kill('SIGTERM');
    } catch (e) {
      console.log(`[Spawn] 终止失败: ${e.message}`);
    }
    this.children.delete(childId);
    return true;
  }

  /** 终止所有子 Bridge */
  async shutdown() {
    for (const [id, child] of this.children) {
      this.killChild(id);
    }
  }
}

export { BridgeSpawn, MAX_CHILDREN, BASE_PORT };
export { BridgeSpawn as HouseSpawn };
export default BridgeSpawn;
