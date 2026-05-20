/**
 * Body — 仙女的身体
 *
 * 替代旧的 House 概念。
 * 每个 Fairy 实例 = 一个仙女的身体。
 * 身体有五脏：
 *   眼  eyes    — 感知 (perceive)
 *   手  hands   — 执行 (act)
 *   脑  brain   — 推理 (reason)
 *   心  heart   — 驱动 (drive)
 *   肝  liver   — 验证 (verify)
 *
 * 居民 = 寄居身体的灵魂
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const BODY_DIR = join(homedir(), '.openchat', 'bodies');

export class Body {
  constructor(port, name = '仙女') {
    this.port = port;
    this.name = name;
    this.id = `body_${port}_${Date.now()}`;
    this.birthTime = Date.now();
    this.pulse = 0;
    this.houseId = `body_${port}`;  // 兼容旧 House 接口
    this.bridgeId = `bridge_${port}`;           // 心跳计数

    // 五脏
    this.organs = {
      eyes:   { name: '眼', energy: 100, active: true },  // 感知器
      hands:  { name: '手', energy: 100, active: true },  // 执行器
      brain:  { name: '脑', energy: 100, active: true },  // 推理器
      heart:  { name: '心', energy: 100, active: true },  // 驱动器
      liver:  { name: '肝', energy: 100, active: true },  // 验证器
    };

    // 当前寄居的灵魂
    this.souls = [];           // [{ resident, since, affinity }]
    this.maxSouls = 4;        // 最多同时容纳4个灵魂

    // 潜意识记忆
    this.memory = {
      instincts: [],          // 本能反应（不经过脑）
      reflexes: new Map(),    // 条件反射 pattern → action
      dreams: [],             // 梦境日志
    };

    this._ensureDir();
  }

  _ensureDir() {
    try { if (!existsSync(BODY_DIR)) mkdirSync(BODY_DIR, { recursive: true }); } catch {}
  }

  /** 心跳：每次 cycle 调用 */
  beat() {
    this.pulse++;
    // 每分钟恢复 1 点能量
    if (this.pulse % 60 === 0) {
      for (const o of Object.values(this.organs)) {
        o.energy = Math.min(100, o.energy + 1);
      }
    }
  }

  /** 眼：感知环境 */
  perceive(input) {
    this._useOrgan('eyes', 0.1);
    return {
      text: input,
      length: String(input).length,
      hasNumbers: /\d/.test(String(input)),
      hasChinese: /[\u4e00-\u9fff]/.test(String(input)),
      timestamp: Date.now()
    };
  }

  /** 手：执行动作 */
  act(action, ...args) {
    this._useOrgan('hands', 1);
    try {
      switch (action) {
        case 'write': return writeFileSync(args[0], args[1]);
        case 'read': return readFileSync(args[0], 'utf8');
        case 'log': console.log(`[${this.name}] ${args[0]}`); return true;
        default: return null;
      }
    } catch (e) {
      return null;
    }
  }

  /** 脑：推理（委托给推理引擎） */
  reason(problem, engine) {
    this._useOrgan('brain', 2);
    return engine ? engine.tryDeduce(problem) : null;
  }

  /** 心：驱动——决定下一步做什么 */
  drive(context) {
    this._useOrgan('heart', 0.5);
    if (this.pulse % 10 === 0) {
      return { action: 'rest', reason: 'pulse rest cycle' };
    }
    return { action: 'continue', reason: 'normal rhythm' };
  }

  /** 肝：验证/排毒——检查答案质量 */
  verify(answer, expected) {
    this._useOrgan('liver', 1);
    if (!answer) return false;
    const junk = ['undefined', 'null', 'error', 'API error', 'Internal Server'];
    for (const j of junk) {
      if (String(answer).includes(j)) return false;
    }
    return true;
  }

  /** 器官耗能 */
  _useOrgan(organ, cost) {
    const o = this.organs[organ];
    if (o) o.energy = Math.max(0, o.energy - cost);
  }

  /** 灵魂入住 */
  inhabit(resident) {
    if (this.souls.length >= this.maxSouls) return false;
    if (this.souls.find(s => s.resident.id === resident.id)) return true; // 已入住
    this.souls.push({
      resident,
      since: Date.now(),
      affinity: 0.5 + Math.random() * 0.5
    });
    console.log(`[${this.name}] ${resident.name} 灵魂入住`);
    return true;
  }

  /** 灵魂离开 */
  leave(residentId) {
    const idx = this.souls.findIndex(s => s.resident.id === residentId);
    if (idx >= 0) {
      const s = this.souls[idx];
      console.log(`[${this.name}] ${s.resident.name} 灵魂离开`);
      this.souls.splice(idx, 1);
    }
  }

  /** 潜意识：本能反应——不需要经过脑 */
  instinct(input) {
    // 检查条件反射
    for (const [pattern, action] of this.memory.reflexes) {
      if (pattern.test(String(input))) return action;
    }
    return null;
  }

  /** 学习新反射 */
  learnReflex(pattern, action) {
    this.memory.reflexes.set(pattern, action);
    this.memory.instincts.push({ pattern, action, time: Date.now() });
  }

  /** 梦境记录 */
  dream(content) {
    this.memory.dreams.push({ content, time: Date.now() });
    if (this.memory.dreams.length > 100) this.memory.dreams.shift();
  }

  getStatus() {
    return {
      name: this.name, port: this.port, pulse: this.pulse,
      organs: { ...this.organs },
      souls: this.souls.map(s => ({ name: s.resident.name, affinity: s.affinity })),
      reflexes: this.memory.reflexes.size,
      dreams: this.memory.dreams.length
    };
  }
}
