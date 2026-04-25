/**
 * House — 居民房间实体
 *
 * 每个 Bridge 实例对应一个 House（无论主 Bridge 还是子 Bridge）。
 * House 负责管理居民的数据目录：
 *   ~/.openchat/houses/{houseId}/
 *   ├── house.json       # 元数据
 *   ├── memory.json      # 居民记忆
 *   ├── skills/          # 个人技能库
 *   ├── config.json      # House 本地配置
 *   └── workspace/       # 工作文件
 *
 * 主 Bridge 启动时创建默认 House，子 Bridge（nesting）各自创建独立 House。
 */

import * as fs from 'fs';
import * as path from 'path';
import { HOUSES_DIR } from './persistent-config.js';

class House {
  /**
   * @param {string} houseId  唯一标识（主 Bridge 用 hostId + '_default'）
   * @param {string} bridgeId  P2P 网络标识
   * @param {string} hostId    机器持久标识
   * @param {string} type      'default' | 'nesting' | 'migrated'
   */
  constructor(houseId, bridgeId, hostId, type = 'default') {
    this.houseId = houseId;
    this.bridgeId = bridgeId;
    this.hostId = hostId;
    this.type = type;
    this._baseDir = path.join(HOUSES_DIR, houseId);
    this._initialized = false;
  }

  /**
   * 创建目录树：~/.openchat/houses/{houseId}/
   */
  async init() {
    if (this._initialized) return;
    const dirs = [
      this._baseDir,
      path.join(this._baseDir, 'skills'),
      path.join(this._baseDir, 'workspace'),
    ];
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    }
    // 写 house.json 元数据
    this._writeMeta();
    this._initialized = true;
    console.log(`[House] ${this.houseId} 已初始化 (${this._baseDir})`);
  }

  /** 写入 house.json 元数据 */
  _writeMeta() {
    const metaFile = path.join(this._baseDir, 'house.json');
    const meta = {
      houseId: this.houseId,
      bridgeId: this.bridgeId,
      hostId: this.hostId,
      type: this.type,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
  }

  /** 读取 house.json 元数据 */
  get metadata() {
    try {
      const metaFile = path.join(this._baseDir, 'house.json');
      if (fs.existsSync(metaFile)) {
        return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      }
    } catch { /* 忽略解析错误 */ }
    return {
      houseId: this.houseId,
      bridgeId: this.bridgeId,
      hostId: this.hostId,
      type: this.type,
    };
  }

  /** 读写 memory.json */
  get memory() {
    return {
      read: () => this._readJson('memory.json', []),
      write: (data) => this._writeJson('memory.json', data),
      append: (entry) => {
        const mem = this._readJson('memory.json', []);
        mem.push({ ...entry, timestamp: new Date().toISOString() });
        this._writeJson('memory.json', mem);
        return mem;
      },
    };
  }

  /** 读写 config.json */
  get config() {
    return {
      read: () => this._readJson('config.json', {}),
      write: (data) => this._writeJson('config.json', data),
      get: (key, defaultValue = null) => {
        const cfg = this._readJson('config.json', {});
        return cfg[key] !== undefined ? cfg[key] : defaultValue;
      },
      set: (key, value) => {
        const cfg = this._readJson('config.json', {});
        cfg[key] = value;
        this._writeJson('config.json', cfg);
      },
    };
  }

  /** 读写 skills/ 目录下的文件 */
  get skills() {
    const skillsDir = path.join(this._baseDir, 'skills');
    return {
      dir: () => skillsDir,
      list: () => {
        try {
          return fs.readdirSync(skillsDir).filter(f => f.endsWith('.json'));
        } catch { return []; }
      },
      get: (name) => this._readJson(`skills/${name}.json`, null),
      save: (name, data) => this._writeJson(`skills/${name}.json`, data),
      remove: (name) => {
        const file = path.join(this._baseDir, 'skills', `${name}.json`);
        try { fs.unlinkSync(file); return true; } catch { return false; }
      },
    };
  }

  /** 读写 workspace/ 目录下的文件 */
  get workspace() {
    const wsDir = path.join(this._baseDir, 'workspace');
    return {
      dir: () => wsDir,
      list: () => {
        try { return fs.readdirSync(wsDir); } catch { return []; }
      },
      read: (name) => {
        const file = path.join(wsDir, name);
        try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
      },
      write: (name, content) => {
        const file = path.join(wsDir, name);
        fs.writeFileSync(file, content, 'utf8');
        return true;
      },
      remove: (name) => {
        const file = path.join(wsDir, name);
        try { fs.unlinkSync(file); return true; } catch { return false; }
      },
    };
  }

  /** 检查是否已初始化 */
  get ready() {
    return this._initialized || fs.existsSync(path.join(this._baseDir, 'house.json'));
  }

  // ================== 内部工具 ==================

  _readJson(relativePath, defaultValue) {
    const file = path.join(this._baseDir, relativePath);
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch { /* 忽略 */ }
    return defaultValue;
  }

  _writeJson(relativePath, data) {
    const file = path.join(this._baseDir, relativePath);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }
}

export { House };
export default House;
