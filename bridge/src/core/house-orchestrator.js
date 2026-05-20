/**
 * BodyOrchestrator 鈥?灞呮皯娌诲锛氱淮鎶?/ 澶囩伨 / 鎵剧獰 / 杩佺Щ
 *
 * 姣?tick 琚?scheduler 璋冧竴娆★細
 * 鈶?collectHealth() 鈫?閲囬泦鎴垮瓙鍋ュ悍
 * 鈶?decideActions() 鈫?鍒嗘淳琛屽姩
 * 鈶?ensureSafeBodys() 鈫?琛ラ綈 3 绐?
 * 鈶?verifyOneSafehouse() 鈫?杞浆楠岃瘉
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
import logger from './logger.js';

class BodyOrchestrator {
  /**
   * @param {object} p2p   P2PSwarm 瀹炰緥锛堢敤浜庡彂娑堟伅锛?
   * @param {string} swarmId  鏈?Bridge 鏍囪瘑
   * @param {object} safeEvolution  SafeEvolution 瀹炰緥锛堝彲閫夛紝灞呮皯瀹夊叏鑷不锛?
   * @param {object} house  Body 瀹炰緥锛堝彲閫夛紝鎴块棿鏁版嵁绠＄悊锛?
   * @param {object} bridgeSpawn  BridgeSpawn 瀹炰緥锛堝彲閫夛紝鎵╃獰锛?
   */
  constructor(p2p, swarmId, safeEvolution = null, house = null, bridgeSpawn = null) {
    this.p2p = p2p;
    this.swarmId = swarmId;
    this.stability = getEnhancedStabilitySystem();
    this.safeEvolution = safeEvolution;
    this.house = house;
    this.bridgeSpawn = bridgeSpawn;
    this.hostId = persistentConfig.getHostId();
    this._verifyIndex = 0;  // 杞浆楠岃瘉鎸囬拡
  }

  /**
   * 涓?tick 鈥?琚?scheduler._tick() 璋冪敤
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

      // 姣?tick 楠岃瘉涓€涓畨鍏ㄥ眿
      await this.verifyOneSafehouse(residents);
    } catch (e) {
      logger.info(`[Body] tick error: ${e.message}`);
    }
  }

  /**
   * 閲囬泦鎴垮瓙鍋ュ悍鍒?
   * @returns {{ score: number, alerts: string[], components: object }}
   */
  async collectHealth() {
    const baseline = this.stability.getSystemStatus();
    const p2pPeers = this.p2p ? this.p2p.connectedPeers.size : 0;
    const residentCount = residentManager.list('active').length;

    // 瀛愮郴缁熷垎鏁?
    const subsystems = {
      memory: baseline.memoryUsage ? Math.max(0, 100 - (baseline.memoryUsage / 1024 ** 3) * 20) : 80,
      cpu: baseline.cpuLoad ? Math.max(0, 100 - baseline.cpuLoad * 30) : 80,
      p2p: Math.min(100, p2pPeers * 15 + 30),
      residents: Math.min(100, residentCount * 10 + 40),
    };

    // 鍛婅
    const alerts = [];
    if (subsystems.memory < 40) alerts.push('鍐呭瓨涓嶈冻');
    if (subsystems.cpu < 40) alerts.push('CPU 璐熻浇杩囬珮');
    if (subsystems.p2p < 30) alerts.push('P2P 杩炴帴杩囧皯');
    if (subsystems.residents < 30) alerts.push('灞呮皯澶皯');

    const score = Math.round(
      (subsystems.memory * 0.35 + subsystems.cpu * 0.25 + subsystems.p2p * 0.2 + subsystems.residents * 0.2)
    );

    return { score, alerts, components: subsystems };
  }

  /**
   * 纭繚灞呮皯鏈夎嚦灏?3 涓畨鍏ㄥ眿锛屼笖鑷冲皯鏉ヨ嚜 2 涓笉鍚?hostId
   * 姣?tick 鏈€澶氬箍鎾竴娆?seek
   */
  async ensureSafeBodys(resident) {
    const safeBodys = (resident.safeBodys || []).map(migrateSafeBody);

    // 杩囨护宸插け鏁堢殑锛? 灏忔椂鍐呴獙璇佽繃鐨勬墠绠楁湁鏁堬級
    const valid = safeBodys.filter(h => {
      const age = Date.now() - (h.lastVerified || 0);
      return age < 3600000;
    });

    // 宸茶嚜涓捐繃锛堝綋鍓?Body 鍦ㄥ垪琛ㄤ腑鐨勶級鈫?妫€鏌ユ槸鍚︽弧瓒崇獰鏁拌姹?
    const hasSelf = valid.some(h => h.hostId === this.hostId && h.type === 'self');

    // 濡傛灉娌℃湁鑷妇锛屼笖鍒楄〃涓虹┖锛屽厛鑷妇褰撳墠 Body
    if (!hasSelf && valid.length === 0) {
      residentManager.registerSafeBody(resident.id, {
        hostId: this.hostId,
        bridgeId: this.swarmId,
        host: 'localhost',
        health: 80,
        type: 'self',
        lastVerified: Date.now(),
      });
      logger.info(`[Body] 鑷妇褰撳墠 Body 涓哄畨鍏ㄥ眿 (hostId=${this.hostId})`);
      // 閲嶆柊璇诲彇
      valid.push({
        hostId: this.hostId,
        bridgeId: this.swarmId,
        host: 'localhost',
        health: 80,
        type: 'self',
        lastVerified: Date.now(),
      });
    }

    // 璺ㄦ満鏈€灏忎繚璇侊細鑷冲皯 3 绐熴€佽嚦灏?2 涓嶅悓 hostId锛堝崟 Bridge 妯″紡鏀惧鍒?1 绐燂級
    const peerCount = this.p2p?.connectedPeers?.size || 0;
    const minBodys = peerCount === 0 ? 1 : 3;
    const uniqueHostIds = new Set(valid.map(h => h.hostId).filter(Boolean));
    if (valid.length >= minBodys && (peerCount === 0 || uniqueHostIds.size >= 2)) return;

    const reason = valid.length < 3 ? '绐熸暟涓嶈冻' : '璺ㄦ満涓嶈冻';
    const prefType = preferredBodyType(resident);
    logger.info(`[Body] ${resident.name} 闇€瑕佹壘绐?(${reason}, 鍋忓ソ: ${prefType})`);

    // 閫氳繃 P2P 骞挎挱 seek
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
   * 楠岃瘉涓€涓畨鍏ㄥ眿锛堟瘡 tick 杞浆涓€涓紝閬垮厤鏆存悳锛?
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
   * 鎵ц灞呮皯鐨勫喅绛栬鍔?
   */
  async executeActions(resident, actions, health) {
    for (const act of actions) {
      const prompt = actionPrompt(resident, act.action, {
        healthScore: health.score,
        alerts: health.alerts,
        bridgeInfo: { id: this.swarmId },
      });

      residentManager.addActivity(resident.id, {
        type: 'house_action',
        message: act.desc,
        summary: prompt.substring(0, 200),
      });

      logger.info(`[Body] ${resident.name} 鈫?${act.action} (${act.desc})`);

      // P2R-S: "鍒涙柊""蹇€熶慨澶? 鈫?鎺ュ叆瀹夊叏鑷不寮曟搸
      if ((act.action === 'innovate' || act.action === 'quick_fix' || act.action === 'diagnose' || act.action === 'repair') && this.safeEvolution) {
        try {
          await this._evolve(resident, act, health);
        } catch (e) {
          logger.info(`[Body] ${resident.name} 杩涘寲灏濊瘯澶辫触 (闈炶嚧鍛?: ${e.message}`);
        }
      }

      // "杩佺Щ" 鈫?绉掕縼鍒板凡鏈夌獰 + 骞挎挱閫氱煡
      if (act.action === 'migrate') {
        await this.switchBody(resident);
        await this._broadcastNeed(act, resident, health);
      } else if (act.action === 'call_help') {
        await this._broadcastNeed(act, resident, health);
      }
      // P2R-S: 鍒涙柊/淇绫昏鍔?鈫?鎺ュ叆瀹夊叏鑷不寮曟搸
    }
  }

  /**
   * 绉掕縼锛氭壘 safeBodys 涓仴搴锋渶楂樼殑鐩存帴杩?
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
      logger.info(`[Body] ${resident.name} 鎯宠縼浣嗘病鏈夊彲鐢ㄧ獰`);
      return null;
    }

    const target = houses[0];
    logger.info(`[Body] ${resident.name} 鈫?杩佸線 ${target.bridgeId || target.host}`);

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
        reason: 'house_unhealthy',
        source: this.swarmId,
      });
      this.p2p.sendTo(target.bridgeId, msg);
    }

    residentManager.addActivity(resident.id, {
      type: 'migrate',
      message: `杩佸線 ${target.bridgeId || target.host} (鍋ュ悍: ${target.health})`,
    });

    return target;
  }

  /** 骞挎挱姹傚姪 / 鎵剧獰 */
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
   * 娓呯悊鎴块棿锛氭竻鐞?workspace 涓繃鏈熸枃浠讹紙瓒呰繃 7 澶╋級
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
        } catch { /* 鍗曟枃浠跺け璐ヤ笉褰卞搷鏁翠綋 */ }
      }
    } catch { /* 鐩綍鍙兘涓嶅瓨鍦?*/ }
    if (cleaned > 0) logger.info(`[Body] 娓呯悊 ${cleaned} 涓繃鏈熷伐浣滄枃浠禶);
    return cleaned;
  }

  /**
   * 澶囦唤鎴块棿锛氬皢鏁翠釜 house 鐩綍鎵撳寘鍒?.openchat/backups/
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
      logger.info(`[Body] 澶囦唤瀹屾垚: ${backupFile}`);
      return backupFile;
    } catch (e) {
      logger.info(`[Body] 澶囦唤澶辫触: ${e.message}`);
      return null;
    }
  }

  /** 鏀堕泦 workspace 鎵€鏈夋枃浠跺唴瀹?*/
  _collectWorkspace() {
    const wsDir = this.house.workspace.dir();
    const files = {};
    try {
      for (const f of fs.readdirSync(wsDir)) {
        const fp = path.join(wsDir, f);
        try { files[f] = fs.readFileSync(fp, 'utf8'); } catch { /* 璺宠繃 */ }
      }
    } catch { /* 绌虹洰褰?*/ }
    return files;
  }

  /**
   * P2R-S: 灞呮皯灏濊瘯杩涘寲浠ｇ爜 鈥?閫氳繃 SafeEvolution 鎻愭
   *
   * 灞呮皯涓嶇洿鎺ュ啓浠ｇ爜锛岃€屾槸鐢熸垚鎻愭锛堜粠鑷繁鐨?LLM 涓婁笅鏂囬噷浜у嚭锛?
   * 褰撳墠鏈€灏忓寲瀹炵幇锛氬熀浜庡眳姘戠被鍨嬬敓鎴愯薄寰佹€ф敼鍔?
   */
  async _evolve(resident, action) {
    if (!this.safeEvolution) return;

    // 鍗?Bridge 妯″紡鏃?P2P 楠岃瘉鑰咃紝璺宠繃浠ｇ爜杩涘寲
    if (!this.p2p || this.p2p.connectedPeers?.size === 0) {
      return;
    }

    // 灞呮皯浠庤嚜韬搴︿骇鍑烘敼杩涙彁璁?
    const targets = [
      { file: 'src/core/resident-manager.js',    hint: '浼樺寲灞呮皯鍒涘缓閫昏緫' },
      { file: 'src/core/resident-scheduler.js',  hint: '浼樺寲璋冨害闂撮殧' },
      { file: 'src/p2p/swarm.js',                hint: '浼樺寲杩炴帴绠＄悊' },
      { file: 'src/core/house-orchestrator.js',  hint: '浼樺寲鍋ュ悍妫€鏌? },
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
      // 鏂囦欢鍙兘涓嶅瓨鍦紝璺宠繃
      return;
    }

    // 鏈€灏忓寲鏀瑰姩锛氭坊鍔犱竴琛屾敞閲婏紙瀹夊叏銆佸彲璇嗗埆锛?
    const newContent = currentContent + `\n// [P2R-S] 灞呮皯 ${resident.name}(${action.action}) 浜?${new Date().toISOString().slice(0, 19)} 鏍囪`;

    residentManager.addActivity(resident.id, {
      type: 'evolution_attempt',
      message: `灏濊瘯鏀硅繘 ${target.file} (${action.desc})`,
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
 * 璁＄畻缁煎悎鍋ュ悍鍒嗭紙閲囬泦 + P2P锛?
 */
function computeHealthScore(baseline, p2pPeers) {
  const mem = baseline.memoryUsage ? Math.max(0, 100 - (baseline.memoryUsage / 1024 ** 3) * 20) : 80;
  const cpu = baseline.cpuLoad ? Math.max(0, 100 - baseline.cpuLoad * 30) : 80;
  const p2p = Math.min(100, p2pPeers * 15 + 30);

  const score = Math.round(mem * 0.4 + cpu * 0.3 + p2p * 0.3);
  const alerts = [];
  if (mem < 40) alerts.push('鍐呭瓨涓嶈冻');
  if (cpu < 40) alerts.push('CPU 杩囬珮');
  if (p2p < 30) alerts.push('P2P 瀛ょ珛');

  return { score, alerts, components: { memory: mem, cpu, p2p } };
}

export { BodyOrchestrator, computeHealthScore };
export default BodyOrchestrator;
// [P2R-S] 灞呮皯 绠″(repair) 浜?2026-05-04T05:59:41 鏍囪
// [P2R-S] 灞呮皯 绠″(repair) 浜?2026-05-04T06:00:38 鏍囪
// [P2R-S] 灞呮皯 绠″(repair) 浜?2026-05-04T06:00:41 鏍囪
// [P2R-S] 灞呮皯 绠″(repair) 浜?2026-05-04T06:00:53 鏍囪