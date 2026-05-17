import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { FairyGuardian } from 'fairy-guardian';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MAX_CHILDREN = 6;

class BridgeSpawn {
  constructor(bridgeId = 'bridge-1', hostId = null, house = null, myPort = 3000) {
    this.bridgeId = bridgeId;
    this.hostId = hostId;
    this.house = house;
    this._myPort = myPort;
    this._children = new Map();

    this._guardian = new FairyGuardian({
      myPort,
      childCount: MAX_CHILDREN,
      childNames: Array.from({ length: MAX_CHILDREN }, (_, i) => `仙女${i + 1}`),
      childPort: (i) => myPort + 2 + i,
      spawnCmd: (port) => [
        process.execPath, 'src/main.js',
        '--fairy', `--port=${port}`, `--mainPort=${myPort}`,
        ...(hostId ? [`--hostId=${hostId}`] : []),
      ],
      cwd: PROJECT_ROOT,
      healthPath: '/health',
      logPrefix: '[BridgeSpawn]',
    });
  }

  async start() {
    await this._guardian.checkAll();
    const children = [];
    for (let i = 0; i < MAX_CHILDREN; i++) {
      const port = this._myPort + 2 + i;
      const name = `仙女${i + 1}`;
      const childId = `body_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`;
      this._children.set(childId, { port, name });
      children.push({ childId, port, name });
    }
    return children;
  }

  spawnNesting(options = {}) {
    for (const [id, info] of this._children) {
      return { childId: id, ...info };
    }
    return null;
  }

  async killChild(childId) {
    if (!this._children.has(childId)) return false;
    const { port } = this._children.get(childId);
    await this._killPort(port);
    this._children.delete(childId);
    return true;
  }

  listChildren() {
    const status = this._guardian.status();
    return [...this._children.entries()].map(([id, info]) => ({
      id,
      name: info.name,
      port: info.port,
      alive: status[info.port]?.alive || false,
      reviveCount: status[info.port]?.reviveCount || 0,
    }));
  }

  async shutdown() {
    for (const [id] of this._children) {
      await this._killPort(this._children.get(id).port);
    }
    this._children.clear();
    this._guardian.destroy();
  }

  handleSpawnRequest(data) {
    const p = data.payload || {};
    return this.spawnNesting({ name: p.name || `spawned-${data.from?.slice(0, 8)}` });
  }

  _killPort(port) {
    return new Promise(r => {
      if (process.platform === 'win32') {
        const netstat = spawn('netstat', ['-ano']);
        let o = '';
        netstat.stdout.on('data', d => o += d);
        netstat.on('close', () => {
          for (const line of o.split('\n')) {
            if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (!pid) continue;
            spawn('taskkill', ['/F', '/PID', pid]).on('close', () => r());
            return;
          }
          r();
        });
        netstat.on('error', () => r());
      } else {
        spawn('fuser', ['-k', `${port}/tcp`]).on('close', () => r());
      }
    });
  }
}

export { BridgeSpawn, MAX_CHILDREN };
export { BridgeSpawn as BodySpawn };
export default BridgeSpawn;
