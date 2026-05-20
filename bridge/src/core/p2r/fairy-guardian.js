/**
 * FairyGuardian — 仙女守护者
 *
 * 运维功能，与学习逻辑无关：
 *   - 心跳接收（Fairy → 主 Bridge）
 *   - 姐妹存活检测
 *   - 宕机自动复活
 *   - Fairy 竞争主模式
 */

import { spawn } from 'child_process';
import { getMainPort } from '../../constants.js';
import logger from '../logger.js';

export class FairyGuardian {
  constructor(myPort) {
    this.myPort = myPort;
    this._heartbeats = new Map();    // port → lastBeat time
    this._reviveCount = new Map();    // port → revive count
    this._lastRestarts = new Map();   // port → last restart time
  }

  /** 心跳接收（主 Bridge 用） */
  receiveHeartbeat(port) {
    this._heartbeats.set(port, Date.now());
  }

  /** 检查所有 Fairy 存活状态（主 Bridge 用） */
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
