/**
 * LaunchStrategies — 启动策略模式
 *
 * 统一 House（Bridge 实例）的启动/停止/管理接口：
 *   - NodeStrategy:   直接 child_process.spawn
 *   - PM2Strategy:    通过 PM2 守护进程
 *   - DockerStrategy:  Docker 容器（预留桩）
 *   - SystemdStrategy: systemd 服务（预留桩）
 *
 * 使用方式：
 *   const strategy = createLaunchStrategy('pm2', { name: 'house-1', script: 'src/main.js' });
 *   await strategy.launch();
 */

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ================== 基类 ==================

class LaunchStrategy {
  constructor(options = {}) {
    this.name = options.name || 'openchat-house';
    this.script = options.script || 'src/main.js';
    this.args = options.args || [];
    this.env = { ...process.env, ...(options.env || {}) };
    this.cwd = options.cwd || PROJECT_ROOT;
  }

  async launch() { throw new Error('Not implemented'); }
  async stop()   { throw new Error('Not implemented'); }
  list()         { throw new Error('Not implemented'); }
  async shutdown() { throw new Error('Not implemented'); }
}

// ================== Node 直启策略 ==================

class NodeStrategy extends LaunchStrategy {
  constructor(options = {}) {
    super(options);
    this._process = null;
    this._children = new Map();
    this._nextPort = options.basePort || 3002;
    this.maxChildren = options.maxChildren || 6;
  }

  /**
   * 清理占用指定端口的旧进程
   * 注意：仅在主 Bridge 启动时调用，Fairy 启动时不调用
   */
  _cleanupPort(port) {
    // 临时禁用，避免误杀 Fairy
    // 如果需要清理旧进程，应该在主 Bridge 启动时而非 spawn 时调用
    return;
  }

  /**
   * 启动主 Bridge 进程
   */
  async launch() {
    if (this._process) {
      logger.info(`[NodeStrategy] ${this.name} 已在运行`);
      return null;
    }

    const mainScript = path.resolve(this.cwd, this.script);
    const child = spawn('node', [mainScript, ...this.args], {
      cwd: this.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.env,
    });

    child.stdout.on('data', (chunk) => {
      logger.info(`[${this.name}] ${chunk.toString().trim()}`);
    });
    child.stderr.on('data', (chunk) => {
      logger.error(`[${this.name}] ${chunk.toString().trim()}`);
    });
    child.on('exit', (code) => {
      logger.info(`[${this.name}] 进程退出, code=${code}`);
      this._process = null;
    });
    child.on('error', (err) => {
      logger.error(`[${this.name}] 启动失败: ${err.message}`);
      this._process = null;
    });

    this._process = child;
    logger.info(`[NodeStrategy] ${this.name} 已启动 pid=${child.pid}`);
    return { pid: child.pid, name: this.name };
  }

  /**
   * 扩窟：启动子 House 进程（nesting 模式）
   */
  spawnHouse(options = {}) {
    if (this._children.size >= this.maxChildren) {
      logger.info(`[NodeStrategy] 子 House 已达上限 ${this.maxChildren}`);
      return null;
    }

    const port = this._nextPort;
    // 临时禁用清理，避免误杀 Fairy
    // this._cleanupPort(port);
    this._nextPort++;
    const name = options.name || `house-${port}`;
    const id = `house_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const mainScript = path.resolve(this.cwd, this.script);
    const childArgs = [
      mainScript,
      '--fairy',
      `--port=${port}`,
      `--name=${name}`,
      ...this.args.filter(a => a.startsWith('--hostId=')),
    ];

    const child = spawn(process.execPath, childArgs, {
      cwd: this.cwd,
      stdio: 'ignore',
      env: { ...this.env, NESTING_BRIDGE: '1' },
      detached: true
    });
    child.unref();

    child.on('exit', (code) => {
      logger.info(`[${name}] 进程退出, code=${code}`);
      this._children.delete(id);
    });
    child.on('error', (err) => {
      logger.error(`[${name}] 启动失败: ${err.message}`);
      this._children.delete(id);
    });

    this._children.set(id, { process: child, port, startTime: Date.now(), name });
    logger.info(`[NodeStrategy] 新窟已筑: ${name} pid=${child.pid} port=${port}`);
    return { childId: id, port, name };
  }

  /**
   * 停止主进程
   */
  async stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      logger.info(`[NodeStrategy] ${this.name} 已停止`);
    }
  }

  /**
   * 列出所有进程
   */
  list() {
    const result = [];
    if (this._process) {
      result.push({ name: this.name, pid: this._process.pid, type: 'main' });
    }
    for (const [id, info] of this._children) {
      result.push({
        id,
        name: info.name,
        port: info.port,
        uptime: Date.now() - info.startTime,
        pid: info.process?.pid,
        type: 'house',
      });
    }
    return result;
  }

  /**
   * 全量关闭
   */
  async shutdown() {
    await this.stop();
    for (const [id] of this._children) {
      try {
        this._children.get(id).process.kill('SIGTERM');
      } catch (e) { logger.warn('[IGNORE] ignore: ' + (e?.message || '')); }
      this._children.delete(id);
    }
    logger.info('[NodeStrategy] 全部进程已关闭');
  }
}

// ================== PM2 策略 ==================

/**
 * PM2 生态文件模板
 */
function generateEcosystem(name, script, args, env) {
  return `module.exports = {
  apps: [{
    name: '${name}',
    script: '${script.replace(/\\/g, '\\\\')}',
    args: '${args.join(' ')}',
    cwd: '${PROJECT_ROOT.replace(/\\/g, '\\\\')}',
    env: ${JSON.stringify(env || {}, null, 4)},
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '${path.join(PROJECT_ROOT, 'logs', `${name}-error.log`).replace(/\\/g, '\\\\')}',
    out_file: '${path.join(PROJECT_ROOT, 'logs', `${name}-out.log`).replace(/\\/g, '\\\\')}',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 10000,
    listen_timeout: 3000,
  }]
};
`;
}

class PM2Strategy extends LaunchStrategy {
  constructor(options = {}) {
    super(options);
    this.ecosystemPath = options.ecosystemPath || path.join(PROJECT_ROOT, 'ecosystem.config.cjs');
    this._pm2Available = null; // lazy check
  }

  /**
   * 检查 PM2 是否可用
   */
  _checkPM2() {
    if (this._pm2Available !== null) return this._pm2Available;
    try {
      execSync('pm2 --version', { stdio: 'ignore' });
      this._pm2Available = true;
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); this._pm2Available = false; }
    return this._pm2Available;
  }

  /**
   * 生成 ecosystem.config.cjs
   */
  _writeEcosystem() {
    const dir = path.dirname(this.ecosystemPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = generateEcosystem(this.name, this.script, this.args, this.env);
    fs.writeFileSync(this.ecosystemPath, content, 'utf8');
    logger.info(`[PM2Strategy] 生态文件已写入: ${this.ecosystemPath}`);
  }

  /**
   * 启动 PM2 进程
   */
  async launch() {
    if (!this._checkPM2()) {
      logger.info('[PM2Strategy] PM2 不可用，请安装: npm install -g pm2');
      return null;
    }

    this._writeEcosystem();

    try {
      execSync(`pm2 start ${this.ecosystemPath} --only ${this.name}`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      logger.info(`[PM2Strategy] ${this.name} 已启动`);
      return { name: this.name, strategy: 'pm2' };
    } catch (e) {
      logger.error(`[PM2Strategy] 启动失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 停止 PM2 进程
   */
  async stop() {
    if (!this._checkPM2()) return;
    try {
      execSync(`pm2 stop ${this.name}`, { stdio: 'pipe' });
      logger.info(`[PM2Strategy] ${this.name} 已停止`);
    } catch (e) {
      logger.error(`[PM2Strategy] 停止失败: ${e.message}`);
    }
  }

  /**
   * 列出 PM2 状态
   */
  list() {
    if (!this._checkPM2()) return [];
    try {
      const output = execSync(`pm2 jlist`, { stdio: 'pipe', encoding: 'utf8' });
      const processes = JSON.parse(output);
      return processes
        .filter(p => p.name === this.name)
        .map(p => ({
          name: p.name,
          pid: p.pid,
          status: p.pm2_env?.status,
          uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
          restartCount: p.pm2_env?.restart_time,
          type: 'pm2',
        }));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return []; }
  }

  /**
   * 删除 PM2 进程
   */
  async shutdown() {
    if (!this._checkPM2()) return;
    try {
      execSync(`pm2 delete ${this.name}`, { stdio: 'pipe' });
      logger.info(`[PM2Strategy] ${this.name} 已删除`);
    } catch (e) {
      logger.error(`[PM2Strategy] 删除失败: ${e.message}`);
    }
  }
}

// ================== Docker 策略（桩） ==================

class DockerStrategy extends LaunchStrategy {
  async launch() {
    logger.info('[DockerStrategy] Docker 模式预留，待实现');
    return null;
  }
  async stop() {
    logger.info('[DockerStrategy] Docker 模式预留');
  }
  list() { return []; }
  async shutdown() {
    logger.info('[DockerStrategy] Docker 模式预留');
  }
}

// ================== Systemd 策略（桩） ==================

class SystemdStrategy extends LaunchStrategy {
  async launch() {
    logger.info('[SystemdStrategy] Systemd 模式预留，待实现');
    return null;
  }
  async stop() {
    logger.info('[SystemdStrategy] Systemd 模式预留');
  }
  list() { return []; }
  async shutdown() {
    logger.info('[SystemdStrategy] Systemd 模式预留');
  }
}

// ================== 工厂 ==================

const STRATEGY_MAP = {
  node:    NodeStrategy,
  pm2:     PM2Strategy,
  docker:  DockerStrategy,
  systemd: SystemdStrategy,
};

/**
 * 创建启动策略实例
 * @param {'node'|'pm2'|'docker'|'systemd'} type
 * @param {object} options
 * @returns {LaunchStrategy}
 */
function createLaunchStrategy(type, options = {}) {
  const Klass = STRATEGY_MAP[type];
  if (!Klass) {
    throw new Error(`未知启动策略: ${type}，可选: ${Object.keys(STRATEGY_MAP).join(', ')}`);
  }
  return new Klass(options);
}

/**
 * 自动检测最佳启动策略
 * @param {object} options
 * @returns {string} 策略名称
 */
function detectBestStrategy(options = {}) {
  // 1. 优先 PM2（如果全局安装）
  try {
    execSync('pm2 --version', { stdio: 'ignore' });
    logger.info('[Launch] 检测到 PM2，使用 pm2 策略');
    return 'pm2';
  } catch (e) { logger.warn('[IGNORE] // fall through: ' + (e?.message || '')); }

  // 2. 默认 Node 直启
  logger.info('[Launch] 未检测到 PM2，使用 node 策略');
  return 'node';
}

export {
  LaunchStrategy,
  NodeStrategy,
  PM2Strategy,
  DockerStrategy,
  SystemdStrategy,
  createLaunchStrategy,
  detectBestStrategy,
  generateEcosystem,
};
