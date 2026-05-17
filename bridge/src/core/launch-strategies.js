/**
 * LaunchStrategies 閳?閸氼垰濮╃粵鏍殣濡€崇础
 *
 * 缂佺喍绔?Body閿涘湐ridge 鐎圭偘绶ラ敍澶屾畱閸氼垰濮?閸嬫粍顒?缁狅紕鎮婇幒銉ュ經閿? *   - PM2Strategy:    闁俺绻?PM2 鐎瑰牊濮㈡潻娑氣柤
 *   - DockerStrategy:  Docker 鐎圭懓娅掗敍鍫ヮ暕閻ｆ瑦銆呴敍? *   - SystemdStrategy: systemd 閺堝秴濮熼敍鍫ヮ暕閻ｆ瑦銆呴敍? *
 * 濞夈劍鍓伴敍姝俹de 閻╂潙鎯庣粵鏍殣瀹歌尪绺肩粔璇插煂 fairy-guardian 閸? *
 * 娴ｈ法鏁ら弬鐟扮础閿? *   const strategy = createLaunchStrategy('pm2', { name: 'house-1', script: 'src/main.js' });
 *   await strategy.launch();
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ================== 閸╄櫣琚?==================

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

// ================== PM2 缁涙牜鏆?==================

/**
 * PM2 閻㈢喐鈧焦鏋冩禒鑸的侀弶? */
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
   * 濡偓閺?PM2 閺勵垰鎯侀崣顖滄暏
   */
  _checkPM2() {
    if (this._pm2Available !== null) return this._pm2Available;
    try {
      execSync('pm2 --version', { stdio: 'ignore' });
      this._pm2Available = true;
    } catch {
      this._pm2Available = false;
    }
    return this._pm2Available;
  }

  /**
   * 閻㈢喐鍨?ecosystem.config.cjs
   */
  _writeEcosystem() {
    const dir = path.dirname(this.ecosystemPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = generateEcosystem(this.name, this.script, this.args, this.env);
    fs.writeFileSync(this.ecosystemPath, content, 'utf8');
    console.log(`[PM2Strategy] 閻㈢喐鈧焦鏋冩禒璺哄嚒閸愭瑥鍙? ${this.ecosystemPath}`);
  }

  /**
   * 閸氼垰濮?PM2 鏉╂稓鈻?
   */
  async launch() {
    if (!this._checkPM2()) {
      console.log('[PM2Strategy] PM2 娑撳秴褰查悽顭掔礉鐠囧嘲鐣ㄧ憗? npm install -g pm2');
      return null;
    }

    this._writeEcosystem();

    try {
      execSync(`pm2 start ${this.ecosystemPath} --only ${this.name}`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      console.log(`[PM2Strategy] ${this.name} 瀹告彃鎯庨崝鈺?;
      return { name: this.name, strategy: 'pm2' };
    } catch (e) {
      console.error(`[PM2Strategy] 閸氼垰濮╂径杈Е: ${e.message}`);
      return null;
    }
  }

  /**
   * 閸嬫粍顒?PM2 鏉╂稓鈻?
   */
  async stop() {
    if (!this._checkPM2()) return;
    try {
      execSync(`pm2 stop ${this.name}`, { stdio: 'pipe' });
      console.log(`[PM2Strategy] ${this.name} 瀹告彃浠犲顣?;
    } catch (e) {
      console.error(`[PM2Strategy] 閸嬫粍顒涙径杈Е: ${e.message}`);
    }
  }

  /**
   * 閸掓鍤?PM2 閻樿埖鈧?   */
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
    } catch {
      return [];
    }
  }

  /**
   * 閸掔娀娅?PM2 鏉╂稓鈻?
   */
  async shutdown() {
    if (!this._checkPM2()) return;
    try {
      execSync(`pm2 delete ${this.name}`, { stdio: 'pipe' });
      console.log(`[PM2Strategy] ${this.name} 瀹告彃鍨归梽顦?;
    } catch (e) {
      console.error(`[PM2Strategy] 閸掔娀娅庢径杈Е: ${e.message}`);
    }
  }
}

// ================== Docker 缁涙牜鏆愰敍鍫熴€呴敍?==================

class DockerStrategy extends LaunchStrategy {
  async launch() {
    console.log('[DockerStrategy] Docker 濡€崇础妫板嫮鏆€閿涘苯绶熺€圭偟骞?);
    return null;
  }
  async stop() {
    console.log('[DockerStrategy] Docker 濡€崇础妫板嫮鏆€');
  }
  list() { return []; }
  async shutdown() {
    console.log('[DockerStrategy] Docker 濡€崇础妫板嫮鏆€');
  }
}

// ================== Systemd 缁涙牜鏆愰敍鍫熴€呴敍?==================

class SystemdStrategy extends LaunchStrategy {
  async launch() {
    console.log('[SystemdStrategy] Systemd 濡€崇础妫板嫮鏆€閿涘苯绶熺€圭偟骞?);
    return null;
  }
  async stop() {
    console.log('[SystemdStrategy] Systemd 濡€崇础妫板嫮鏆€');
  }
  list() { return []; }
  async shutdown() {
    console.log('[SystemdStrategy] Systemd 濡€崇础妫板嫮鏆€');
  }
}

// ================== 瀹搞儱宸?==================

const STRATEGY_MAP = {
  pm2:     PM2Strategy,
  docker:  DockerStrategy,
  systemd: SystemdStrategy,
};

/**
 * 閸掓稑缂撻崥顖氬З缁涙牜鏆愮€圭偘绶?
 * @param {'pm2'|'docker'|'systemd'} type
 * @param {object} options
 * @returns {LaunchStrategy}
 */
function createLaunchStrategy(type, options = {}) {
  const Klass = STRATEGY_MAP[type];
  if (!Klass) {
    throw new Error(`閺堫亞鐓￠崥顖氬З缁涙牜鏆? ${type}閿涘苯褰查柅? ${Object.keys(STRATEGY_MAP).join(', ')}`);
  }
  return new Klass(options);
}

/**
 * 閼奉亜濮╁Λ鈧ù瀣付娴ｅ啿鎯庨崝銊х摜閻? * @param {object} options
 * @returns {string} 缁涙牜鏆愰崥宥囆?
 */
function detectBestStrategy(options = {}) {
  // 1. 娴兼ê鍘?PM2閿涘牆顩ч弸婊冨弿鐏炩偓鐎瑰顥婇敍?  try {
    execSync('pm2 --version', { stdio: 'ignore' });
    console.log('[Launch] 濡偓濞村鍩?PM2閿涘奔濞囬悽?pm2 缁涙牜鏆?);
    return 'pm2';
  } catch {
    // fall through
  }

  // 2. 姒涙顓?PM2閿涘牆顩ч弸婊勭梾閺?PM2閿涘M2Strategy 娴兼俺鍤滈崝銊﹀絹缁€鍝勭暔鐟佸拑绱?
  console.log('[Launch] 閺堫亝顥呭ù瀣煂 PM2閿涘矂妾风痪褎褰佺粈?);
  return 'pm2';
}

export {
  LaunchStrategy,
  PM2Strategy,
  DockerStrategy,
  SystemdStrategy,
  createLaunchStrategy,
  detectBestStrategy,
  generateEcosystem,
};
