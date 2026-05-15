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

export class FairyGuardian {
  constructor(myPort) {
    this.myPort = myPort;
    this._heartbeats = new Map();    // port → lastBeat time
    this._reviveCount = new Map();    // port → revive count
    this._lastRestarts = new Map();   // port → last restart time
    this._bootstrapped = false;       // 是否已自举初始仙女
  }

  /** 心跳接收（主 Bridge 用） */
  receiveHeartbeat(port) {
    this._heartbeats.set(port, Date.now());
  }

  /** 检查所有 Fairy 存活状态（主 Bridge 用） */
  async checkAll() {
    const now = Date.now();

    if (!this._bootstrapped) {
      this._bootstrapped = true;
      await this._bootstrap();
    }

    for (const [port, lastBeat] of this._heartbeats) {
      if (port === this.myPort) continue;
      const alive = (now - lastBeat < 30000);
      if (!alive) {
        const status = await this._checkStatus(port);
        if (status === 'dead') await this._revive(port);
      }
    }
  }

  /** 首次启动时自动创建 6 个姐妹仙女（端口 = 主端口 + 10 * n） */
  async _bootstrap() {
    const { join } = await import('path');
    const script = join(process.cwd(), 'src', 'main.js');
    const names = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥'];

    // 快速检查任意一个目标端口是否已存活 → 集群已存在
    for (let i = 0; i < names.length; i++) {
      const checkPort = this.myPort + (i + 1) * 10;
      if (await this._httpPing(checkPort).catch(() => false)) {
        console.log('[守护] 已有仙女集群存活(' + names[i] + ' :'+checkPort+')，跳过自举');
        return;
      }
    }

    for (let i = 0; i < names.length; i++) {
      const port = this.myPort + (i + 1) * 10;
      console.log(`[守护] 自举初始仙女: ${names[i]} :${port}`);
      spawn(process.execPath, [script, `--port=${port}`, '--fairy', `--mainPort=${this.myPort}`], {
        cwd: process.cwd(), detached: true, stdio: 'ignore'
      }).unref();
      await new Promise(r => setTimeout(r, 2000));
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
    console.log(`[守护] 复活 Fairy :${port} (第${c+1}次)`);
    const { join } = await import('path');
    const script = join(process.cwd(), 'src', 'main.js');
    spawn(process.execPath, [script, `--port=${port}`, '--fairy', `--mainPort=${this.myPort}`], {
      cwd: process.cwd(), detached: true, stdio: 'ignore'
    }).unref();
    this._lastRestarts.set(port, Date.now());
    this._reviveCount.set(port, c + 1);
  }

  async _httpPing(port) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 3000);
      const r = await fetch(`http://localhost:${port}/health`, { signal: c.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  _portListening(port) {
    return new Promise(r => {
      const s = spawn('netstat', ['-ano']);
      let o = '';
      s.stdout.on('data', d => o += d);
      s.on('close', () => r(o.includes(`:${port}`) && o.includes('LISTENING')));
    });
  }
}
