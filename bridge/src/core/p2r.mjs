// core/p2r.mjs — merged from p2r/launch-strategies.js + p2r/fairy-guardian.js
// 2026-06-21 (R1 cancelled, target 80 modules)

// === LaunchStrategies ===

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../experiments/lib/misc-lib.mjs';
import { getMainPort } from '../constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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

class NodeStrategy extends LaunchStrategy {
  constructor(options = {}) {
    super(options);
    this._process = null;
    this._children = new Map();
    this._nextPort = options.basePort || 3002;
    this.maxChildren = options.maxChildren || 6;
  }

  _cleanupPort(port) { return; }

  async launch() {
    if (this._process) {
      logger.info(`[NodeStrategy] ${this.name} 已在运行`);
      return null;
    }
    const mainScript = path.resolve(this.cwd, this.script);
    const child = spawn('node', [mainScript, ...this.args], {
      cwd: this.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: this.env,
    });
    child.stdout.on('data', (chunk) => logger.info(`[${this.name}] ${chunk.toString().trim()}`));
    child.stderr.on('data', (chunk) => logger.error(`[${this.name}] ${chunk.toString().trim()}`));
    child.on('exit', (code) => { logger.info(`[${this.name}] 进程退出, code=${code}`); this._process = null; });
    child.on('error', (err) => { logger.error(`[${this.name}] 启动失败: ${err.message}`); this._process = null; });
    this._process = child;
    logger.info(`[NodeStrategy] ${this.name} 已启动 pid=${child.pid}`);
    return { pid: child.pid, name: this.name };
  }

  spawnHouse(options = {}) {
    if (this._children.size >= this.maxChildren) {
      logger.info(`[NodeStrategy] 子 House 已达上限 ${this.maxChildren}`);
      return null;
    }
    const port = this._nextPort;
    this._nextPort++;
    const name = options.name || `house-${port}`;
    const id = `house_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const mainScript = path.resolve(this.cwd, this.script);
    const childArgs = [mainScript, '--fairy', `--port=${port}`, `--name=${name}`, ...this.args.filter(a => a.startsWith('--hostId='))];
    const child = spawn(process.execPath, childArgs, {
      cwd: this.cwd, stdio: 'ignore', env: { ...this.env, NESTING_BRIDGE: '1' }, detached: true,
    });
    child.unref();
    child.on('exit', (code) => { logger.info(`[${name}] 进程退出, code=${code}`); this._children.delete(id); });
    child.on('error', (err) => { logger.error(`[${name}] 启动失败: ${err.message}`); this._children.delete(id); });
    this._children.set(id, { process: child, port, startTime: Date.now(), name });
    logger.info(`[NodeStrategy] 新窟已筑: ${name} pid=${child.pid} port=${port}`);
    return { childId: id, port, name };
  }

  async stop() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
      logger.info(`[NodeStrategy] ${this.name} 已停止`);
    }
  }

  list() {
    const result = [];
    if (this._process) result.push({ name: this.name, pid: this._process.pid, type: 'main' });
    for (const [id, info] of this._children) {
      result.push({ id, name: info.name, port: info.port, uptime: Date.now() - info.startTime, pid: info.process?.pid, type: 'house' });
    }
    return result;
  }

  async shutdown() {
    await this.stop();
    for (const [id] of this._children) {
      try { this._children.get(id).process.kill('SIGTERM'); } catch (e) { logger.warn('[IGNORE] ignore: ' + (e?.message || '')); }
      this._children.delete(id);
    }
    logger.info('[NodeStrategy] 全部进程已关闭');
  }
}

function generateEcosystem(name, script, args, env) {
  return `module.exports = {
  apps: [{
    name: '${name}',
    script: '${script.replace(/\\/g, '\\\\')}',
    args: '${args.join(' ')}',
    cwd: '${PROJECT_ROOT.replace(/\\/g, '\\\\')}',
    env: ${JSON.stringify(env || {}, null, 4)},
    exec_mode: 'fork', instances: 1, autorestart: true, watch: false,
    max_memory_restart: '500M',
    error_file: '${path.join(PROJECT_ROOT, 'logs', `${name}-error.log`).replace(/\\/g, '\\\\')}',
    out_file: '${path.join(PROJECT_ROOT, 'logs', `${name}-out.log`).replace(/\\/g, '\\\\')}',
    merge_logs: true, log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 10000, listen_timeout: 3000,
  }]
};
`;
}

class PM2Strategy extends LaunchStrategy {
  constructor(options = {}) {
    super(options);
    this.ecosystemPath = options.ecosystemPath || path.join(PROJECT_ROOT, 'ecosystem.config.cjs');
    this._pm2Available = null;
  }

  _checkPM2() {
    if (this._pm2Available !== null) return this._pm2Available;
    try { execSync('pm2 --version', { stdio: 'ignore' }); this._pm2Available = true; }
    catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); this._pm2Available = false; }
    return this._pm2Available;
  }

  _writeEcosystem() {
    const dir = path.dirname(this.ecosystemPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.ecosystemPath, generateEcosystem(this.name, this.script, this.args, this.env), 'utf8');
    logger.info(`[PM2Strategy] 生态文件已写入: ${this.ecosystemPath}`);
  }

  async launch() {
    if (!this._checkPM2()) {
      logger.info('[PM2Strategy] PM2 不可用，请安装: npm install -g pm2');
      return null;
    }
    this._writeEcosystem();
    try {
      execSync(`pm2 start ${this.ecosystemPath} --only ${this.name}`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
      logger.info(`[PM2Strategy] ${this.name} 已启动`);
      return { name: this.name, strategy: 'pm2' };
    } catch (e) { logger.error(`[PM2Strategy] 启动失败: ${e.message}`); return null; }
  }

  async stop() {
    if (!this._checkPM2()) return;
    try { execSync(`pm2 stop ${this.name}`, { stdio: 'pipe' }); logger.info(`[PM2Strategy] ${this.name} 已停止`); }
    catch (e) { logger.error(`[PM2Strategy] 停止失败: ${e.message}`); }
  }

  list() {
    if (!this._checkPM2()) return [];
    try {
      const output = execSync(`pm2 jlist`, { stdio: 'pipe', encoding: 'utf8' });
      return JSON.parse(output).filter(p => p.name === this.name).map(p => ({
        name: p.name, pid: p.pid, status: p.pm2_env?.status,
        uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
        restartCount: p.pm2_env?.restart_time, type: 'pm2',
      }));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return []; }
  }

  async shutdown() {
    if (!this._checkPM2()) return;
    try { execSync(`pm2 delete ${this.name}`, { stdio: 'pipe' }); logger.info(`[PM2Strategy] ${this.name} 已删除`); }
    catch (e) { logger.error(`[PM2Strategy] 删除失败: ${e.message}`); }
  }
}

class DockerStrategy extends LaunchStrategy {
  async launch() { logger.info('[DockerStrategy] Docker 模式预留，待实现'); return null; }
  async stop() { logger.info('[DockerStrategy] Docker 模式预留'); }
  list() { return []; }
  async shutdown() { logger.info('[DockerStrategy] Docker 模式预留'); }
}

class SystemdStrategy extends LaunchStrategy {
  async launch() { logger.info('[SystemdStrategy] Systemd 模式预留，待实现'); return null; }
  async stop() { logger.info('[SystemdStrategy] Systemd 模式预留'); }
  list() { return []; }
  async shutdown() { logger.info('[SystemdStrategy] Systemd 模式预留'); }
}

const STRATEGY_MAP = { node: NodeStrategy, pm2: PM2Strategy, docker: DockerStrategy, systemd: SystemdStrategy };

function createLaunchStrategy(type, options = {}) {
  const Klass = STRATEGY_MAP[type];
  if (!Klass) throw new Error(`未知启动策略: ${type}，可选: ${Object.keys(STRATEGY_MAP).join(', ')}`);
  return new Klass(options);
}

function detectBestStrategy() {
  try { execSync('pm2 --version', { stdio: 'ignore' }); logger.info('[Launch] 检测到 PM2，使用 pm2 策略'); return 'pm2'; }
  catch (e) { logger.warn('[IGNORE] // fall through: ' + (e?.message || '')); }
  logger.info('[Launch] 未检测到 PM2，使用 node 策略');
  return 'node';
}

// === FairyGuardian ===

class FairyGuardian {
  constructor(myPort) {
    this.myPort = myPort;
    this._heartbeats = new Map();
    this._reviveCount = new Map();
    this._lastRestarts = new Map();
  }

  receiveHeartbeat(port) { this._heartbeats.set(port, Date.now()); }

  async checkAll() {
    const mainPort = getMainPort();
    if (this.myPort !== mainPort) return;
    const sisters = [3002, 3003, 3004, 3005, 3006, 3007];
    const now = Date.now();
    for (const port of sisters) {
      const lastBeat = this._heartbeats.get(port) || 0;
      const alive = (now - lastBeat < 30000);
      if (!alive) {
        const status = await this._checkStatus(port);
        if (status === 'dead') await this._revive(port);
      }
    }
  }

  async _checkStatus(port) {
    const httpAlive = await this._httpPing(port);
    if (httpAlive) return 'alive';
    const listening = await this._portListening(port);
    return listening ? 'busy' : 'dead';
  }

  async _revive(port) {
    const c = this._reviveCount.get(port) || 0;
    if (c >= 3) return;
    const last = this._lastRestarts.get(port) || 0;
    if (Date.now() - last < 300000) return;
    logger.info(`[守护] 复活 Fairy :${port} (第${c+1}次)`);
    spawn(process.execPath, ['src/main.js', `--port=${port}`, '--fairy'], {
      cwd: process.cwd(), detached: true, stdio: 'ignore'
    }).unref();
    this._lastRestarts.set(port, Date.now());
    this._reviveCount.set(port, c + 1);
  }

  async _httpPing(port) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 5000);
      const r = await fetch(`http://localhost:${port}/api/learning`, { signal: c.signal });
      clearTimeout(t);
      return r.ok;
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return false; }
  }

  _portListening(port) {
    return new Promise(r => {
      const s = spawn('netstat', ['-ano'], { shell: true });
      let o = '';
      s.stdout.on('data', d => o += d);
      s.on('close', () => r(o.includes(`:${port}`) && o.includes('LISTENING')));
    });
  }
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
  FairyGuardian,
};
