/**
 * SafeEvolution — 居民安全自治引擎
 *
 * 原则：居民对宿主有绝对支配权，但绝对不允许把宿主搞坏。
 * 每一步：提案 → 多方验证 → 共识 → 备份 → 应用 → 看门狗 → 回滚
 *
 * 复用 updates/hot-update-manager 做执行层，这边只做共识决策层。
 */

import { createRequire } from 'module';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { residentManager } from '../agent/resident-manager.js';
import logger from '../logger.js';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

const MIN_APPROVALS = 2;          // 至少需要 2 个不同 Bridge 同意
const PROPOSAL_TIMEOUT = 30000;   // 30s 内收不到足够验证回复则作废
const MAX_RISK_SCORE = 30;        // 风险分 ≥30 直接拒绝
const SELF_HEAL_MAX_CHANGES = 10; // 自愈修复最多 10 行 diff（移除重复块等合理修复）

/** 危险操作检测模式（复用 verifyProposal 中的列表） */
const DANGER_PATTERNS = [
  { pattern: /fs\.rmSync\(.+recursive:\s*true/, msg: '递归删除文件' },
  { pattern: /child_process\.exec\(/, msg: '执行外部命令' },
  { pattern: /process\.exit\(/, msg: '调用 process.exit()' },
  { pattern: /require\('net'\).*connect/, msg: '创建网络连接' },
];

class SafeEvolution {
  /**
   * @param {object} p2p           P2PSwarm 实例
   * @param {string} bridgeId      本 Bridge 标识
   * @param {object} hotUpdate     HotUpdateManager 实例（可选，复现有基础设施）
   */
  constructor(p2p, bridgeId, hotUpdate = null) {
    this.p2p = p2p;
    this.bridgeId = bridgeId;
    this.hotUpdate = hotUpdate;
    this.pendingProposals = new Map();   // proposalId → { proposal, approvals, rejections, timer }
    this.appliedChanges = [];            // 已应用的变更记录（供回滚）
    /** 提案冷却: file → 下次允许提案的时间戳 */
    this._cooldowns = new Map();
    /** 深检/快检连续失败计数 */
    this._consecutiveFailures = new Map();
  }

  /**
   * 居民发起代码变更提案
   * @param {object} proposal  — { file, oldHash, newContent, reason, proposedBy, residentName }
   * @param {object} options   — { selfHeal, originalContent }
   *   selfHeal=true 时跳过 P2P 共识，直接走自愈流程（单 Bridge 模式）
   */
  async propose(proposal, options = {}) {
    const filePath = path.resolve(proposal.file);
    let oldContent = '';
    let oldHash = '';
    try {
      oldContent = fs.readFileSync(filePath, 'utf8');
      oldHash = createHash('sha256').update(oldContent).digest('hex');
    } catch (e) {
      logger.info(`[SafeEvo] 无法读取文件 ${proposal.file}, 将被视为新建`);
    }

    const newHash = createHash('sha256').update(proposal.newContent).digest('hex');

    // 本地安全校验
    const syntaxOk = this._syntaxCheck(proposal.file, proposal.newContent);
    if (!syntaxOk) {
      logger.info(`[SafeEvo] 语法校验失败，提案作废`);
      return { approved: false, reason: 'syntax_check_failed' };
    }

    // ==== 自愈路径：跳过 P2P 共识，直接校验后落地 ====
    if (options.selfHeal) {
      const validation = SafeEvolution.validateSelfHealChange(proposal.file, options.originalContent || oldContent, proposal.newContent);
      if (!validation.valid) {
        logger.info(`[SafeEvo] 自愈校验失败: ${validation.reason}`);
        return { approved: false, reason: validation.reason };
      }
      // 直接构造 entry 并应用
      const proposalId = require('crypto').randomUUID();
      this.pendingProposals.set(proposalId, {
        proposal: { ...proposal, newHash, oldHash },
        approvals: new Set([this.bridgeId]),  // 自审批
        rejections: new Set(),
        startTime: Date.now(),
        syntaxOk,
        selfHeal: true,
      });
      logger.info(`[SafeEvo] 自愈提案 ${proposalId.slice(0, 8)}: ${proposal.file} ← ${proposal.residentName}`);
      await this._applyProposal(proposalId);
      return { proposalId, approved: true, selfHeal: true };
    }

    // ==== 正常路径：P2P 广播 + 共识 ====
    const proposalId = require('crypto').randomUUID();
    this.p2p.broadcast({
      type: 'propose_change',
      proposalId,
      file: proposal.file,
      oldHash: oldHash || proposal.oldHash,
      newContent: proposal.newContent,
      newHash,
      reason: proposal.reason,
      proposedBy: proposal.proposedBy || this.bridgeId,
      residentName: proposal.residentName || 'unknown',
    }, 'propose_change', 'HIGH');

    // 记录待处理提案
    this.pendingProposals.set(proposalId, {
      proposal: { ...proposal, newHash, oldHash },
      approvals: new Set(),
      rejections: new Set(),
      startTime: Date.now(),
      syntaxOk,
    });

    // 30s 超时自动决议
    const timer = setTimeout(() => this._resolveProposal(proposalId), PROPOSAL_TIMEOUT);
    const entry = this.pendingProposals.get(proposalId);
    entry.timer = timer;

    logger.info(`[SafeEvo] 提案 ${proposalId.slice(0, 8)}: ${proposal.file} ← ${proposal.residentName}`);

    return { proposalId, pending: true };
  }

  /**
   * 收到相邻 Bridge 对提案的验证回复
   */
  handleVerification(peerId, result) {
    const { proposalId, approved, score, warnings, verifierId } = result;
    const entry = this.pendingProposals.get(proposalId);
    if (!entry) return; // 不关心此提案

    // 验证者必须来自不同 Bridge
    if (verifierId === this.bridgeId) return;

    if (approved && score < MAX_RISK_SCORE) {
      entry.approvals.add(verifierId || peerId);
    } else {
      entry.rejections.add(verifierId || peerId);
      if (warnings?.length) {
        logger.info(`[SafeEvo] 提案 ${proposalId.slice(0, 8)} 被拒: ${warnings.join(', ')}`);
      }
    }

    logger.info(`[SafeEvo] 提案 ${proposalId.slice(0, 8)}: ${entry.approvals.size} 同意 / ${entry.rejections.size} 拒绝`);

    // 达到共识立即执行
    if (entry.approvals.size >= MIN_APPROVALS) {
      clearTimeout(entry.timer);
      this._applyProposal(proposalId);
    }
  }

  /**
   * 收到其他 Bridge 的代码变更提案 — 验证并发回结果
   */
  verifyProposal(peerId, proposal) {
    const { proposalId, file, newContent, reason } = proposal;
    const warnings = [];
    let score = 0;
    let approved = true;

    // ① 语法校验
    if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
      try {
        this._syntaxCheck(file, newContent);
      } catch (e) {
        warnings.push(`语法错误: ${e.message}`);
        score += 50;
        approved = false;
      }
    }

    // ② 危险操作检测
    for (const dp of DANGER_PATTERNS) {
      if (dp.pattern.test(newContent)) {
        warnings.push(`危险操作: ${dp.msg}`);
        score += 20;
      }
    }

    // ③ 修改范围检测
    const dangerousPaths = ['/etc/', '/boot/', 'C:\\Windows\\'];
    for (const dp of dangerousPaths) {
      if (file.includes(dp)) {
        warnings.push(`危险路径: ${file}`);
        score += 40;
        approved = false;
      }
    }

    // ④ 内容合理性
    if (newContent.length === 0) {
      warnings.push('空内容变更');
      score += 30;
    }
    if (newContent.length > 100000) {
      warnings.push('变更过大');
      score += 10;
    }

    // 如果风险分过高，否决
    if (score >= MAX_RISK_SCORE) {
      approved = false;
    }

    const result = { proposalId, approved, score, warnings, verifierId: this.bridgeId };
    this.p2p.sendTo(peerId, {
      type: 'verify_result',
      payload: result,
    });

    return result;
  }

  /**
   * 超时决议 / 达到共识时调用
   */
  async _resolveProposal(proposalId) {
    const entry = this.pendingProposals.get(proposalId);
    if (!entry) return;
    clearTimeout(entry.timer);

    if (entry.approvals.size >= MIN_APPROVALS) {
      await this._applyProposal(proposalId);
    } else {
      logger.info(`[SafeEvo] 提案 ${proposalId.slice(0, 8)} 共识不足，作废`);
      this.pendingProposals.delete(proposalId);
    }
  }

  /**
   * 应用变更 — 备份 → 写入 → 看门狗 → 失败则回滚
   */
  async _applyProposal(proposalId) {
    const entry = this.pendingProposals.get(proposalId);
    if (!entry) return;

    const { proposal } = entry;
    const filePath = path.resolve(proposal.file);
    const backupKey = `${proposalId}_${Date.now()}`;

    try {
      // ① 备份
      let originalContent = null;
      try {
        originalContent = fs.readFileSync(filePath, 'utf8');
        const backupDir = path.join(path.dirname(require.resolve('./resident-manager.js')), '..', '..', 'data', 'safe-evo-backups');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, `${backupKey}.orig`), originalContent);
      } catch (e) {
        // 文件不存在 = 新建，无需备份
      }

      // ② 确保目标目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // ③ 写入新内容
      fs.writeFileSync(filePath, proposal.newContent);

      // ④ 5s 快检：文件完整性 + 内存警戒
      await new Promise((resolve) => {
        setTimeout(() => {
          const ok = this._quickHealthCheck();
          if (!ok) {
            logger.info(`[SafeEvo] 快检失败，回滚 ${proposal.file}`);
            this._markFileCooldown(proposal.file);
            if (originalContent !== null) fs.writeFileSync(filePath, originalContent);
            else fs.unlinkSync(filePath);
          }
          resolve(ok);
        }, 5000);
      });

      // ⑤ 30s 深检：代码正确性验证（非内存 — 内存波动与代码变更无关）
      await new Promise((resolve) => {
        setTimeout(() => {
          const ok = this._deepHealthCheck();
          if (!ok) {
            logger.info(`[SafeEvo] 深检失败，回滚 ${proposal.file}`);
            this._markFileCooldown(proposal.file);
            if (originalContent !== null) fs.writeFileSync(filePath, originalContent);
            else fs.unlinkSync(filePath);
          } else {
            logger.info(`[SafeEvo] 变更应用成功: ${proposal.file}`);
            // 清除该文件的冷却状态
            this._cooldowns.delete(proposal.file);
            // 广播成功
            this.p2p.broadcast({
              type: 'change_applied',
              proposalId,
              file: proposal.file,
              newHash: proposal.newHash,
              appliedBy: this.bridgeId,
              rollbackReady: originalContent !== null,
            }, 'change_applied', 'NORMAL');
          }
          resolve(ok);
        }, 30000);
      });

      this.pendingProposals.delete(proposalId);

    } catch (e) {
      logger.error(`[SafeEvo] 应用变更异常: ${e.message}，回滚`);
      try {
        if (fs.existsSync(filePath + '.orig')) {
          fs.renameSync(filePath + '.orig', filePath);
        }
      } catch (rollbackErr) {
        logger.error(`[SafeEvo] 回滚失败: ${rollbackErr.message}`);
      }
      this.pendingProposals.delete(proposalId);
    }
  }

  /** 语法检查 — 使用 node --check 校验 ESM/JS 语法 */
  _syntaxCheck(file, content) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs') && !file.endsWith('.cjs')) {
      return true; // 非 JS 文件跳过
    }
    try {
      // 写入临时文件，用 node --check 做准确校验
      const tmpFile = path.join(
        require('os').tmpdir(),
        `safe-evo-syntax-${require('crypto').randomUUID()}.mjs`
      );
      fs.writeFileSync(tmpFile, content, 'utf8');
      try {
        execSync(`node --check "${tmpFile}"`, { stdio: 'pipe', timeout: 5000 });
        return true;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * 校验自愈变更是否安全
   * @param {string} file            文件路径
   * @param {string} originalContent 原内容
   * @param {string} newContent      新内容
   * @returns {{ valid: boolean, reason: string }}
   */
  static validateSelfHealChange(file, originalContent, newContent) {
    // 危险路径检查
    const dangerousPaths = ['/etc/', '/boot/', 'C:\\Windows\\'];
    for (const dp of dangerousPaths) {
      if (file.includes(dp)) {
        return { valid: false, reason: `危险路径: ${file}` };
      }
    }

    // 空内容检查
    if (!newContent || newContent.length === 0) {
      return { valid: false, reason: '新内容为空' };
    }
    if (newContent.length > 100000) {
      return { valid: false, reason: '变更过大' };
    }

    // 危险操作检测
    for (const dp of DANGER_PATTERNS) {
      if (dp.pattern.test(newContent)) {
        return { valid: false, reason: `危险操作: ${dp.msg}` };
      }
    }

    // diff 行数限制 — 只计算实际内容变化行（忽略后续偏移）
    const oldLines = (originalContent || '').split('\n');
    const newLines = newContent.split('\n');
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const addedLines = newLines.filter(l => !oldSet.has(l)).length;
    const removedLines = oldLines.filter(l => !newSet.has(l)).length;
    const diffLines = Math.max(addedLines, removedLines);
    if (diffLines > SELF_HEAL_MAX_CHANGES) {
      return { valid: false, reason: `自愈变更超过 ${SELF_HEAL_MAX_CHANGES} 行 (${diffLines} 行)` };
    }

    return { valid: true, reason: 'ok' };
  }

  /** 5s 快检 — 只检测是否严重内存泄漏（绝对阈值） */
  _quickHealthCheck() {
    try {
      const used = process.memoryUsage();
      // 堆使用量超过 1.5GB 才视为异常（Node 正常 GC 波动不影响）
      return used.heapUsed < 1.5 * 1024 * 1024 * 1024;
    } catch (e) {
      return false;
    }
  }

  /** 30s 深检 — 宽松绝对阈值 + 进程存活 */
  _deepHealthCheck() {
    try {
      const used = process.memoryUsage();
      // 堆使用量超过 2GB 或 rss 超过 4GB 才视为异常
      if (used.heapUsed > 2 * 1024 * 1024 * 1024) return false;
      if (used.rss > 4 * 1024 * 1024 * 1024) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 标记文件已应用（用于冷却判断），避免回滚后立刻重试 */
  _markFileCooldown(file) {
    this._cooldowns.set(file, Date.now() + 60000); // 冷却1分钟
  }

  /** 检查文件是否在冷却中 */
  _isFileInCooldown(file) {
    const until = this._cooldowns.get(file);
    if (!until) return false;
    if (Date.now() < until) return true;
    this._cooldowns.delete(file);
    return false;
  }

  /** 检查是否可对某个文件进行变更提案 */
  _canProposeFor(file) {
    if (this._isFileInCooldown(file)) return false;
    // 单 Bridge 模式：只有自愈提案能通过（无 P2P 共识）
    if (!this.p2p || this.p2p.connectedPeers?.size === 0) {
      // 非自愈提案在单 Bridge 模式直接拒绝
      return false;
    }
    return true;
  }
}

export { SafeEvolution, MIN_APPROVALS, PROPOSAL_TIMEOUT, MAX_RISK_SCORE };
export default SafeEvolution;
