/**
 * BodyOrchestrator — 居民治家：维护 / 备灾 / 找身体 / 迁移
 *
 * 每 tick 被 scheduler 调一次：
 * ① collectHealth() → 采集身体健康
 * ② decideActions() → 分派行动
 * ③ ensureSafeBodys() → 补齐 3 身体
 * ④ verifyOneSafehouse() → 轮转验证
 */

import { residentManager, migrateSafeBody } from './resident-manager.js';
import { getEnhancedStabilitySystem } from './enhanced-stability-system.js';
import { decideActions, actionPrompt, preferredBodyType } from './resident-decisions.js';
import { persistentConfig, HOUSES_DIR } from './persistent-config.js';
import { MessageType,
  createBodySeekMessage,
  createBodyNeedMessage,
  createSafeBodyVerify,
  createResidentTransferMessage,
} from '../p2p/messages.js';

import * as fs from 'fs';
import * as path from 'path';

class BodyOrchestrator {
  /**
   * @param {object} p2p   P2PSwarm 实例（用于发消息）
   * @param {string} swarmId  本 Bridge 标识
   * @param {object} safeEvolution  SafeEvolution 实例（可选，居民安全自治）
   * @param {object} house  Body 实例（可选，房间数据管理）
   * @param {object} bridgeSpawn  BridgeSpawn 实例（可选，扩身体）
   */
  constructor(p2p, swarmId, safeEvolution = null, house = null, bridgeSpawn = null) {
    this.p2p = p2p;
    this.swarmId = swarmId;
    this.stability = getEnhancedStabilitySystem();
    this.safeEvolution = safeEvolution;
    this.house = house;
    this.bridgeSpawn = bridgeSpawn;
    this.hostId = persistentConfig.getHostId();
    this._verifyIndex = 0;  // 轮转验证指针
  }

  /**
   * 主 tick — 被 scheduler._tick() 调用
   */
  async tick() {
    try {
      const health = await this.collectHealth();
      const residents = residentManager.list(null).filter(r => r.status === 'active');

      for (const r of residents) {
        const actions = decideActions(r, health.score);
        if (actions.length > 0) {
          await this.executeActions(r, actions.slice(0, 2), health);
        }
        await this.ensureSafeBodys(r);
      }

      // 每 tick 验证一个身体
      await this.verifyOneSafehouse(residents);
    } catch (e) {
      console.log(`[Body] tick error: ${e.message}`);
    }
  }

  /**
   * 采集身体健康分
   * @returns {{ score: number, alerts: string[], components: object }}
   */
  async collectHealth() {
    const baseline = this.stability.getSystemStatus();
    const p2pPeers = this.p2p ? this.p2p.connectedPeers.size : 0;
    const residentCount = residentManager.list('active').length;

    // 子系统分数
    const subsystems = {
      memory: baseline.memoryUsage ? Math.max(0, 100 - (baseline.memoryUsage / 1024 ** 3) * 20) : 80,
      cpu: baseline.cpuLoad ? Math.max(0, 100 - baseline.cpuLoad * 30) : 80,
      p2p: Math.min(100, p2pPeers * 15 + 30),
      residents: Math.min(100, residentCount * 10 + 40),
    };

    // 告警
    const alerts = [];
    if (subsystems.memory < 40) alerts.push('内存不足');
    if (subsystems.cpu < 40) alerts.push('CPU 负载过高');
    if (subsystems.p2p < 30) alerts.push('P2P 连接过少');
    if (subsystems.residents < 30) alerts.push('居民太少');

    const score = Math.round(
      (subsystems.memory * 0.35 + subsystems.cpu * 0.25 + subsystems.p2p * 0.2 + subsystems.residents * 0.2)
    );

    return { score, alerts, components: subsystems };
  }

  /**
   * 确保居民有至少 3 个身体，且至少来自 2 个不同 hostId
   * 每 tick 最多广播一次 seek
   */
  async ensureSafeBodys(resident) {
    const safeBodys = (resident.safeBodys || []).map(migrateSafeBody);

    // 过滤已失效的（1 小时内验证过的才算有效）
    const valid = safeBodys.filter(h => {
      const age = Date.now() - (h.lastVerified || 0);
      return age < 3600000;
    });

    // 已自举过（当前 Body 在列表中的）→ 检查是否满足身体数要求
    const hasSelf = valid.some(h => h.hostId === this.hostId && h.type === 'self');

    // 如果没有自举，且列表为空，先自举当前 Body
    if (!hasSelf && valid.length === 0) {
      residentManager.registerSafeBody(resident.id, {
        hostId: this.hostId,
        bridgeId: this.swarmId,
        host: 'localhost',
        health: 80,
        type: 'self',
        lastVerified: Date.now(),
      });
      console.log(`[Body] 自举当前 Body 为身体 (hostId=${this.hostId})`);
      // 重新读取
      valid.push({
        hostId: this.hostId,
        bridgeId: this.swarmId,
        host: 'localhost',
        health: 80,
        type: 'self',
        lastVerified: Date.now(),
      });
    }

    // 跨机最小保证：至少 3 身体、至少 2 不同 hostId（单 Bridge 模式放宽到 1 身体）
    const peerCount = this.p2p?.connectedPeers?.size || 0;
    const minBodys = peerCount === 0 ? 1 : 3;
    const uniqueHostIds = new Set(valid.map(h => h.hostId).filter(Boolean));
    if (valid.length >= minBodys && (peerCount === 0 || uniqueHostIds.size >= 2)) return;

    const reason = valid.length < 3 ? '身体数不足' : '跨机不足';
    const prefType = preferredBodyType(resident);
    console.log(`[Body] ${resident.name} 需要找身体 (${reason}, 偏好: ${prefType})`);

    // 通过 P2P 广播 seek
    if (this.p2p) {
      const msg = createBodySeekMessage({
        residentName: resident.name,
        residentId: resident.id,
        hostId: this.hostId,
        preferredType: prefType,
        traits: resident.traits,
        source: this.swarmId,
      });
      this.p2p.broadcast(msg, MessageType.HOUSE_SEEK, 'HIGH');
    }
  }

  /**
   * 验证一个身体（每 tick 轮转一个，避免暴搜）
   */
  async verifyOneSafehouse(residents) {
    const allBodys = [];
    for (const r of residents) {
      for (const h of (r.safeBodys || []).map(migrateSafeBody)) {
        allBodys.push({ residentId: r.id, ...h });
      }
    }
    if (allBodys.length === 0) return;

    this._verifyIndex = (this._verifyIndex + 1) % allBodys.length;
    const target = allBodys[this._verifyIndex];
    const bridgeId = target.bridgeId;

    if (this.p2p && this.p2p.connectedPeers.has(bridgeId)) {
      const msg = createSafeBodyVerify({
        houseId: target.houseId || bridgeId,
        bridgeId,
        hostId: this.hostId,
        source: this.swarmId,
      });
      this.p2p.sendTo(bridgeId, msg);
    }
  }

  /**
   * 执行居民的决策行动
   */
  async executeActions(resident, actions, health) {
    for (const act of actions) {
      const prompt = actionPrompt(resident, act.action, {
        healthScore: health.score,
        alerts: health.alerts,
        bridgeInfo: { id: this.swarmId },
      });

      residentManager.addActivity(resident.id, {
        type: 'body_action',
        message: act.desc,
        summary: prompt.substring(0, 200),
      });

      console.log(`[Body] ${resident.name} → ${act.action} (${act.desc})`);

      // P2R-S: "创新""快速修复" → 接入安全自治引擎
      if ((act.action === 'innovate' || act.action === 'quick_fix' || act.action === 'diagnose' || act.action === 'repair') && this.safeEvolution) {
        try {
          await this._evolve(resident, act, health);
        } catch (e) {
          console.log(`[Body] ${resident.name} 进化尝试失败 (非致命): ${e.message}`);
        }
      }

      // "迁移" → 秒迁到已有身体 + 广播通知
      if (act.action === 'migrate') {
        await this.switchBody(resident);
        await this._broadcastNeed(act, resident, health);
      } else if (act.action === 'call_help') {
        await this._broadcastNeed(act, resident, health);
      }
      // P2R-S: 创新/修复类行动 → 接入安全自治引擎
    }
  }

  /**
   * 秒迁：找 safeBodys 中健康最高的直接迁
   */
  async switchBody(resident) {
    const houses = (resident.safeBodys || [])
      .map(migrateSafeBody)
      .filter(h => {
        const age = Date.now() - (h.lastVerified || 0);
        return age < 3600000;
      })
      .sort((a, b) => (b.health || 0) - (a.health || 0));

    if (houses.length === 0) {
      console.log(`[Body] ${resident.name} 想迁但没有可用身体`);
      return null;
    }

    const target = houses[0];
    console.log(`[Body] ${resident.name} → 迁往 ${target.bridgeId || target.host}`);

    if (this.p2p) {
      const msg = createResidentTransferMessage({
        residents: [{
          id: resident.id,
          name: resident.name,
          traits: resident.traits,
        }],
        targetBridgeId: target.bridgeId,
        targetHostId: target.hostId || '',
        sourceBridgeId: this.swarmId,
        sourceHostId: this.hostId,
        reason: 'body_unhealthy',
        source: this.swarmId,
      });
      this.p2p.sendTo(target.bridgeId, msg);
    }

    residentManager.addActivity(resident.id, {
      type: 'migrate',
      message: `迁往 ${target.bridgeId || target.host} (健康: ${target.health})`,
    });

    return target;
  }

  /** 广播求助 / 找身体 */
  async _broadcastNeed(action, resident, health) {
    if (!this.p2p) return;
    const msg = createBodyNeedMessage({
      action: action.action,
      residentName: resident.name,
      residentId: resident.id,
      hostId: this.hostId,
      healthScore: health.score,
      alerts: health.alerts,
      source: this.swarmId,
    });
    this.p2p.broadcast(msg, MessageType.HOUSE_NEED, 'HIGH');
  }

  /**
   * 清理房间：清理 workspace 中过期文件（超过 7 天）
   */
  cleanBody(maxAgeMs = 7 * 86400000) {
    if (!this.house) return 0;
    const wsDir = this.house.workspace.dir();
    let cleaned = 0;
    try {
      const files = fs.readdirSync(wsDir);
      const now = Date.now();
      for (const f of files) {
        const fp = path.join(wsDir, f);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fp);
            cleaned++;
          }
        } catch { /* 单文件失败不影响整体 */ }
      }
    } catch { /* 目录可能不存在 */ }
    if (cleaned > 0) console.log(`[Body] 清理 ${cleaned} 个过期工作文件`);
    return cleaned;
  }

  /**
   * 备份房间：将整个 house 目录打包到 .openchat/backups/
   */
  backupBody() {
    if (!this.house) return null;
    const backupDir = path.join(HOUSES_DIR, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `${this.house.houseId}_${ts}.json`);

    try {
      const data = {
        metadata: this.house.metadata,
        memory: this.house.memory.read(),
        config: this.house.config.read(),
        workspace: this._collectWorkspace(),
        backedUpAt: new Date().toISOString(),
      };
      fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[Body] 备份完成: ${backupFile}`);
      return backupFile;
    } catch (e) {
      console.log(`[Body] 备份失败: ${e.message}`);
      return null;
    }
  }

  /** 收集 workspace 所有文件内容 */
  _collectWorkspace() {
    const wsDir = this.house.workspace.dir();
    const files = {};
    try {
      for (const f of fs.readdirSync(wsDir)) {
        const fp = path.join(wsDir, f);
        try { files[f] = fs.readFileSync(fp, 'utf8'); } catch { /* 跳过 */ }
      }
    } catch { /* 空目录 */ }
    return files;
  }

  /**
   * P2R-S: 居民尝试进化代码 — 通过 SafeEvolution 提案
   *
   * 居民不直接写代码，而是生成提案（从自己的 LLM 上下文里产出）
   * 当前最小化实现：基于居民类型生成象征性改动
   */
  async _evolve(resident, action) {
    if (!this.safeEvolution) return;

    // 单 Bridge 模式无 P2P 验证者，跳过代码进化
    if (!this.p2p || this.p2p.connectedPeers?.size === 0) {
      return;
    }

    // 居民从自身角度产出改进提议
    const targets = [
      { file: 'src/core/resident-manager.js',    hint: '优化居民创建逻辑' },
      { file: 'src/core/resident-scheduler.js',  hint: '优化调度间隔' },
      { file: 'src/p2p/swarm.js',                hint: '优化连接管理' },
      { file: 'src/core/house-orchestrator.js',  hint: '优化健康检查' },
    ];
    const target = targets[Math.floor(Math.random() * targets.length)];

    const fs = await import('fs');
    const path = await import('path');
    const cryptoLib = await import('crypto');
    const projectRoot = path.join(import.meta.dirname, '..', '..');
    let currentContent = '';
    let oldHash = '';
    try {
      currentContent = fs.readFileSync(path.join(projectRoot, target.file), 'utf8');
      oldHash = cryptoLib.createHash('sha256').update(currentContent).digest('hex');
    } catch (e) {
      // 文件可能不存在，跳过
      return;
    }

    // 最小化改动：添加一行注释（安全、可识别）
    const newContent = currentContent + `\n// [P2R-S] 居民 ${resident.name}(${action.action}) 于 ${new Date().toISOString().slice(0, 19)} 标记`;

    residentManager.addActivity(resident.id, {
      type: 'evolution_attempt',
      message: `尝试改进 ${target.file} (${action.desc})`,
    });

    await this.safeEvolution.propose({
      file: target.file,
      oldHash,
      newContent,
      reason: action.desc,
      proposedBy: this.swarmId,
      residentName: resident.name,
    });
  }
}

/**
 * 计算综合健康分（采集 + P2P）
 */
function computeHealthScore(baseline, p2pPeers) {
  const mem = baseline.memoryUsage ? Math.max(0, 100 - (baseline.memoryUsage / 1024 ** 3) * 20) : 80;
  const cpu = baseline.cpuLoad ? Math.max(0, 100 - baseline.cpuLoad * 30) : 80;
  const p2p = Math.min(100, p2pPeers * 15 + 30);

  const score = Math.round(mem * 0.4 + cpu * 0.3 + p2p * 0.3);
  const alerts = [];
  if (mem < 40) alerts.push('内存不足');
  if (cpu < 40) alerts.push('CPU 过高');
  if (p2p < 30) alerts.push('P2P 孤立');

  return { score, alerts, components: { memory: mem, cpu, p2p } };
}

export { BodyOrchestrator, computeHealthScore };
export default BodyOrchestrator;
// [P2R-S] 居民 管家(repair) 于 2026-05-04T05:59:41 标记
// [P2R-S] 居民 管家(repair) 于 2026-05-04T06:00:38 标记
// [P2R-S] 居民 管家(repair) 于 2026-05-04T06:00:41 标记
// [P2R-S] 居民 管家(repair) 于 2026-05-04T06:00:53 标记