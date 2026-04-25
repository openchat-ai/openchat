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
import { residentManager } from './resident-manager.js';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

const MIN_APPROVALS = 2;          // 至少需要 2 个不同 Bridge 同意
const PROPOSAL_TIMEOUT = 30000;   // 30s 内收不到足够验证回复则作废
const MAX_RISK_SCORE = 30;        // 风险分 ≥30 直接拒绝

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
  }

  /**
   * 居民发起代码变更提案
   * @param {object} proposal  — { file, oldHash, newContent, reason, proposedBy, residentName }
   */
  async propose(proposal) {
    const filePath = path.resolve(proposal.file);
    let oldContent = '';
    let oldHash = '';
    try {
      oldContent = fs.readFileSync(filePath, 'utf8');
      oldHash = createHash('sha256').update(oldContent).digest('hex');
    } catch (e) {
      console.log(`[SafeEvo] 无法读取文件 ${proposal.file}, 将被视为新建`);
    }

    const newHash = createHash('sha256').update(proposal.newContent).digest('hex');

    // 本地安全校验
    const syntaxOk = this._syntaxCheck(proposal.file, proposal.newContent);
    if (!syntaxOk) {
      console.log(`[SafeEvo] 语法校验失败，提案作废`);
      return { approved: false, reason: 'syntax_check_failed' };
    }

    const proposalId = require('crypto').randomUUID();
    const msg = this.p2p.broadcast({
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

    console.log(`[SafeEvo] 提案 ${proposalId.slice(0, 8)}: ${proposal.file} ← ${proposal.residentName}`);

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
        console.log(`[SafeEvo] 提案 ${proposalId.slice(0, 8)} 被拒: ${warnings.join(', ')}`);
      }
    }

    console.log(`[SafeEvo] 提案 ${proposalId.slice(0, 8)}: ${entry.approvals.size} 同意 / ${entry.rejections.size} 拒绝`);

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
    const dangerPatterns = [
      { pattern: /fs\.rmSync\(.+recursive:\s*true/, msg: '递归删除文件' },
      { pattern: /child_process\.exec\(/, msg: '执行外部命令' },
      { pattern: /process\.exit\(/, msg: '调用 process.exit()' },
      { pattern: /require\('net'\).*connect/, msg: '创建网络连接' },
    ];
    for (const dp of dangerPatterns) {
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
      console.log(`[SafeEvo] 提案 ${proposalId.slice(0, 8)} 共识不足，作废`);
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

      // ④ 5s 快检
      await new Promise((resolve) => {
        setTimeout(() => {
          const ok = this._quickHealthCheck();
          if (!ok) {
            console.log(`[SafeEvo] 快检失败，回滚 ${proposal.file}`);
            if (originalContent !== null) fs.writeFileSync(filePath, originalContent);
            else fs.unlinkSync(filePath);
          }
          resolve(ok);
        }, 5000);
      });

      // ⑤ 30s 深检
      await new Promise((resolve) => {
        setTimeout(() => {
          const ok = this._deepHealthCheck();
          if (!ok) {
            console.log(`[SafeEvo] 深检失败，回滚 ${proposal.file}`);
            if (originalContent !== null) fs.writeFileSync(filePath, originalContent);
            else fs.unlinkSync(filePath);
          } else {
            console.log(`[SafeEvo] 变更应用成功: ${proposal.file}`);
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
      console.error(`[SafeEvo] 应用变更异常: ${e.message}，回滚`);
      try {
        if (fs.existsSync(filePath + '.orig')) {
          fs.renameSync(filePath + '.orig', filePath);
        }
      } catch (rollbackErr) {
        console.error(`[SafeEvo] 回滚失败: ${rollbackErr.message}`);
      }
      this.pendingProposals.delete(proposalId);
    }
  }

  /** 语法检查 */
  _syntaxCheck(file, content) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs') && !file.endsWith('.cjs')) {
      return true; // 非 JS 文件跳过
    }
    try {
      // 使用 require 动态加载来检测语法
      new Function(content);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 5s 快检 */
  _quickHealthCheck() {
    try {
      const used = process.memoryUsage();
      return used.heapUsed < used.heapTotal * 0.95; // 内存未超过 95%
    } catch (e) {
      return false;
    }
  }

  /** 30s 深检 */
  _deepHealthCheck() {
    try {
      const used = process.memoryUsage();
      return used.heapUsed < used.heapTotal * 0.9;
    } catch (e) {
      return false;
    }
  }
}

export { SafeEvolution, MIN_APPROVALS, PROPOSAL_TIMEOUT, MAX_RISK_SCORE };
export default SafeEvolution;
