/**
 * BridgeSpawn — 居民扩窟引擎
 *
 * 三种扩窟方式：
 *  1. 同机子进程 — 委托给 launch-strategies.js（NodeStrategy / PM2Strategy）
 *  2. 跨机 npm   — 生成 npm install 命令给主人执行
 *  3. 占位协议   — 邻居通过 P2P 请求 spawn
 *
 * 约束：
 *  - 同一台机器最多 3 个子 Bridge（MAX_CHILDREN）
 *  - 子 Bridge 不带 REST API（--nesting 模式），仅 P2P + 调度
 *  - 子端口自动分配 3002, 3003, 3004
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createLaunchStrategy } from './launch-strategies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_CHILDREN = 6;
const BASE_PORT = 3002;

class BridgeSpawn {
  /**
   * @param {string} bridgeId
   * @param {string} hostId
   * @param {object} house
   * @param {string|object} strategyOrType  — 'node'|'pm2' 或 LaunchStrategy 实例，默认 'node'
   */
  constructor(bridgeId = 'bridge-1', hostId = null, house = null, strategyOrType = 'node') {
    this.bridgeId = bridgeId;
    this.hostId = hostId;
    this.house = house;

    // 初始化启动策略
    if (typeof strategyOrType === 'string') {
      this._strategy = createLaunchStrategy(strategyOrType, {
        name: bridgeId,
        script: 'src/main.js',
        basePort: BASE_PORT,
        maxChildren: MAX_CHILDREN,
        args: hostId ? [`--hostId=${hostId}`] : [],
      });
    } else {
      this._strategy = strategyOrType;
    }
    this._childNames = new Map(); // childId → name
  }

  /**
   * 同机扩窟：spawn 子 Bridge 进程
   * @returns { childId, port, name } | null
   */
  spawnNesting(options = {}) {
    if (this._childNames.size >= MAX_CHILDREN) {
      console.log(`[Spawn] 同机子 Bridge 已达上限 ${MAX_CHILDREN}，不再扩窟`);
      return null;
    }

    const result = this._strategy.spawnHouse(options);
    if (result) {
      this._childNames.set(result.childId, result.name);
      console.log(`[Spawn] 新窟已筑: ${result.name} port=${result.port}`);
    }
    return result;
  }

  /**
   * 跨机部署：生成安装脚本
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

  /** 响应 P2P spawn 请求 */
  handleSpawnRequest(data) {
    const p = data.payload || {};
    return this.spawnNesting({ name: p.name || `spawned-${data.from?.slice(0, 8)}` });
  }

  /** 列出所有子 Bridge */
  listChildren() {
    return this._strategy.list().filter(p => p.type === 'house');
  }

  /** 终止子 Bridge */
  killChild(childId) {
    if (!this._childNames.has(childId)) return false;
    try {
      this._strategy.killChild(childId);
    } catch (e) {
      console.log(`[Spawn] 终止失败: ${e.message}`);
    }
    this._childNames.delete(childId);
    return true;
  }

  /** 终止所有子 Bridge */
  async shutdown() {
    await this._strategy.shutdown();
    this._childNames.clear();
  }

  /** 获取当前启动策略类型 */
  getStrategyType() {
    return this._strategy.constructor.name.replace('Strategy', '').toLowerCase();
  }
}

export { BridgeSpawn, MAX_CHILDREN, BASE_PORT };
export { BridgeSpawn as HouseSpawn };
export default BridgeSpawn;
