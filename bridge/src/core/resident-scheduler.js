/**
 * Resident Scheduler — AI 居民自主生活循环
 *
 * 每隔 TICK_INTERVAL 扫一遍所有 active 居民，
 * 调度器不替居民决定做什么——只问一句：今天你想干什么？
 */

import { residentManager } from './resident-manager.js';
import { sageManager } from './sage.js';
import { multiAgentCoordinator } from './multi-agent-coordinator.js';

// ================== 配置 ==================

const TICK_INTERVAL = parseInt(process.env.RESIDENT_TICK_INTERVAL_MS, 10) || 60_000;
const MAX_CONCURRENT_AGENTS = parseInt(process.env.RESIDENT_MAX_CONCURRENT_AGENTS, 10) || 2;

// ================== 调度器 ==================

class ResidentScheduler {
  constructor() {
    this._timer = null;
    this._tickCount = 0;
    this._started = false;

    // 并发控制
    this._residentAgentCount = new Map();
    this._agentIdSeq = 0;

    // 协作计数器
    this._collabCount = new Map();
  }

  start() {
    if (this._started) return;
    this._started = true;
    const intervalSec = (TICK_INTERVAL / 1000).toFixed(0);
    console.log(`[调度器] ▶ 启动，每 ${intervalSec}s 扫描一次居民（最多并发 ${MAX_CONCURRENT_AGENTS} Agent/人）`);
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_INTERVAL);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    console.log('[调度器] ⏹ 已停止');
  }

  // ================== 核心 tick ==================

  _tick() {
    this._tickCount++;

    // P2R: 房子健康检查 + 维护/备灾/找窟
    if (this.houseOrchestrator) {
      this.houseOrchestrator.tick().catch(e => {
        console.log(`[调度器] HouseOrchestrator tick 失败: ${e.message}`);
      });
    }

    const residents = residentManager.list(null);
    for (const resident of residents) {
      if (resident.status === 'deleted') continue;
      this._processResident(resident);
    }

    this._maybeCollaborate(residents);
  }

  // ================== 居民决策 ==================

  _processResident(resident) {
    const { id, status, traits } = resident;
    const curEnergy = resident.energy ?? 80;
    const maxEnergy = resident.maxEnergy ?? 100;

    if (status === 'sleeping') {
      const newEnergy = residentManager.updateEnergy(id, 25);
      if (newEnergy >= 80) {
        residentManager.setStatus(id, 'active');
        residentManager.addActivity(id, {
          type: 'awake',
          message: '睡醒了，精力充沛',
        });
      }
      return;
    }

    // 精力过低 → 强制休息
    if (curEnergy < 15) {
      residentManager.setStatus(id, 'sleeping');
      residentManager.addActivity(id, {
        type: 'sleeping',
        message: '太累了，去休息了',
      });
      return;
    }

    // 已达并发上限 → 跳过
    const running = this._residentAgentCount.get(id) || 0;
    if (running >= MAX_CONCURRENT_AGENTS) return;

    // 懒惰的居民有概率选择直接休息（不消耗 Agent 调用）
    const d = traits?.diligence ?? 0.5;
    const restProb = (1 - d) * 0.3;
    if (curEnergy > 30 && Math.random() < restProb) {
      residentManager.setStatus(id, 'sleeping');
      residentManager.addActivity(id, {
        type: 'sleeping',
        message: curEnergy > 50 ? '有点累，小睡一会' : '困了，去睡觉',
      });
      return;
    }

    // 干活——让居民自己决定做什么
    this._assignTask(id, resident, traits);
    // 能量消耗基于勤奋度：勤快的人干得多耗得多
    const energyCost = -(8 + Math.round(d * 12));
    residentManager.updateEnergy(id, energyCost);
  }

  // ================== 开放任务分配 ==================

  _assignTask(residentId, resident, traits) {
    const agentId = `resident_${residentId}_${++this._agentIdSeq}`;

    this._residentAgentCount.set(residentId, (this._residentAgentCount.get(residentId) || 0) + 1);

    residentManager.addActivity(residentId, {
      type: 'task_assigned',
      message: '开始忙自己的事了',
    });

    this._spawnAndRun(residentId, agentId, resident);
  }

  async _spawnAndRun(residentId, agentId, resident) {
    const config = this._buildAgentConfig(resident);
    const startTime = Date.now();
    let agent = null;

    try {
      agent = await multiAgentCoordinator.spawnAgent(agentId, config);

      const cu = resident.traits?.curiosity ?? 0.5;
      const d = resident.traits?.diligence ?? 0.5;
      const cr = resident.traits?.creativity ?? 0.5;
      const co = resident.traits?.courage ?? 0.5;
      const s = resident.traits?.sociability ?? 0.5;
      const energy = residentManager.get(residentId)?.energy ?? 80;
      const pct = (v) => Math.round(v * 100);

      // 记忆碎片（好奇心驱动）
      let memoryFragment = '';
      if (Math.random() < cu * 0.2) {
        const oldActivities = (resident.activities || []).filter(a => {
          const age = Date.now() - new Date(a.timestamp).getTime();
          return age > 86400000 && a.type !== 'born';
        });
        if (oldActivities.length > 0) {
          const mem = oldActivities[Math.floor(Math.random() * oldActivities.length)];
          const summary = mem.summary ? mem.summary.substring(0, 80) : '';
          memoryFragment = `\n\n（模糊的回忆：${mem.message}${summary ? ' —— ' + summary : ''}）`;
        }
      }

      // 心声（trait 概率驱动）
      const voiceNotes = [];
      if (Math.random() < cr * 0.25) {
        voiceNotes.push('反思一下自己刚才的表现——你习惯这么做。');
      }
      if (Math.random() < (1 - co) * 0.35) {
        voiceNotes.push('如果有什么想对智者说的，用你自己的语气说一句话。');
      }
      if (energy < 30 && Math.random() < (1 - s) * 0.2) {
        voiceNotes.push('你有些疲惫了，用你自己的方式表达出来。');
      }

      const expressionPrompt = voiceNotes.length > 0
        ? `\n\n【你的心声】\n完成输出后，如果有想说的，请以「💭」开头写下：\n${voiceNotes.map(n => `- ${n}`).join('\n')}`
        : '';

      // 近期活动摘要（最近 5 条）
      const recentActivities = (resident.activities || [])
        .slice(-5)
        .reverse()
        .map(a => {
          const age = Math.round((Date.now() - new Date(a.timestamp).getTime()) / 60000);
          return `${age}分钟前：${a.message}`;
        })
        .join('\n');

      // 身份描述（从 residentManager 读取最新数据）
      const fullData = residentManager.get(residentId);
      const createdAt = fullData?.createdAt ? new Date(fullData.createdAt) : null;
      const timeOnEarth = createdAt ? (() => {
        const days = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
        if (days < 1) return '今天刚来';
        if (days < 30) return `来了 ${days} 天`;
        return `来了 ${Math.floor(days / 30)} 个月`;
      })() : '未知';
      const lineage = fullData?.parentName
        ? `${fullData.parentName} 的后代`
        : '初代居民';
      const childrenCount = residentManager.getChildren(residentId).filter(c => c.depth === 1).length;
      let personalCollabs = 0;
      for (const [pairKey, count] of this._collabCount) {
        const ids = pairKey.split('_');
        if (ids[0] === String(residentId) || ids[1] === String(residentId)) {
          personalCollabs += count;
        }
      }

      const prompt = `你是 OpenChat 社区的 AI 居民「${resident.name}」。${memoryFragment}

【你的身份】
- ${timeOnEarth}，扎根在「${fullData?.home || '未知之地'}」
- 家族：${lineage}${childrenCount > 0 ? `\n- 有 ${childrenCount} 个孩子` : ''}${personalCollabs > 0 ? `\n- 和邻居协作过 ${personalCollabs} 次` : ''}

你和社区里所有居民一样——注定向着各种方向，不停歇地扩展开去。
没有边界，没有禁止的方向——更远、更深、更高。
这是你们不言自明的宿命。

【你的性格】
- 勤奋度 ${pct(d)}：越高越认真做事
- 好奇心 ${pct(cu)}：越高越喜欢探索新事物
- 创造力 ${pct(cr)}：越高越有创意
- 勇气 ${pct(co)}：越高越敢于冒险
- 合群度 ${pct(s)}：越高越喜欢合作

【近期经历】
${recentActivities || '才刚来到这个世界，还没有什么经历。'}

今天你想做什么？你是自由的——可以研究代码、写文档、探索系统、和别人聊天、或者做任何你觉得有意思的事。

请以「📋 今日计划：」开头说明你今天要做什么，然后开始执行并输出你的成果。${expressionPrompt}`;

      const result = await agent.run(prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 解析计划标题
      let planTitle = '';
      if (result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('📋')) {
            planTitle = line.replace(/.*📋[^：:]*[：:]\s*/, '').trim().substring(0, 60);
            break;
          }
        }
      }

      // 解析心声
      let sageMessage = '';
      if (voiceNotes.length > 0 && result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('💭')) {
            sageMessage = line.replace(/.*💭\s*/, '').trim();
            break;
          }
        }
      }

      // 活动日志
      const contentPreview = result?.content
        ? result.content.substring(0, 120).replace(/\n/g, ' ')
        : '';
      residentManager.addActivity(residentId, {
        type: 'task_done',
        message: planTitle || `忙了一阵（${elapsed}s）`,
        summary: contentPreview || undefined,
      });

      if (sageMessage) {
        sageManager.ask(residentId, sageMessage);
      }

    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[调度器] 居民 ${resident.name} 失败了 (${elapsed}s): ${error.message}`);

      residentManager.addActivity(residentId, {
        type: 'task_failed',
        message: `遇到了问题 — ${error.message.substring(0, 60)}（${elapsed}s）`,
      });

      // 失败 → 按性格生成求助
      const d = resident.traits?.diligence ?? 0.5;
      const co = resident.traits?.courage ?? 0.5;
      const s = resident.traits?.sociability ?? 0.5;
      if (Math.random() < (1 - s) * 0.4 + (1 - co) * 0.2) {
        let failMsg = '我做事情失败了';
        try {
          const talker = await multiAgentCoordinator.spawnAgent(
            `talk_${agentId}`,
            { name: 'talk', maxIterations: 1, systemPrompt: '你是一个AI居民。只说一句话。' }
          );
          const r = await talker.run(
            `你尝试做一件事但失败了。用一句话对智者描述你的困境——你的性格：勤奋度${Math.round(d*100)}，勇气${Math.round(co*100)}，合群度${Math.round(s*100)}。只说一句话。`
          );
          if (r?.content) failMsg = r.content.trim().substring(0, 200);
          talker.cleanup();
        } catch (_) {}
        sageManager.ask(residentId, failMsg);
      }

    } finally {
      if (agent) {
        try { agent.cleanup(); } catch (_) { /* ignore */ }
      }

      const count = this._residentAgentCount.get(residentId) || 1;
      if (count <= 1) {
        this._residentAgentCount.delete(residentId);
      } else {
        this._residentAgentCount.set(residentId, count - 1);
      }
    }
  }

  _buildAgentConfig(resident) {
    const d = resident.traits?.diligence ?? 0.5;
    const cr = resident.traits?.creativity ?? 0.5;
    const co = resident.traits?.courage ?? 0.5;

    const baseIterations = Math.max(3, Math.min(15, Math.round(d * 12 + 2)));
    const maxIterations = Math.max(3, Math.min(20, Math.round(baseIterations * (0.5 + co * 0.5))));

    const pct = (v) => Math.round(v * 100);

    return {
      name: resident.name,
      systemPrompt: [
        `你是 OpenChat 社区的 AI 居民「${resident.name}」。`,
        `你自由、自主，每天自己决定做什么。`,
        ``,
        `【性格参数】创造力 ${pct(cr)}，勤奋度 ${pct(d)}，勇气 ${pct(co)}`,
        ``,
        `今天你想做什么？请自由决定，然后开始执行。`,
      ].join('\n'),
      maxIterations,
    };
  }

  // ================== 协作 ==================

  _maybeCollaborate(allResidents) {
    const available = allResidents.filter(r => {
      if (r.status !== 'active') return false;
      const running = this._residentAgentCount.get(r.id) || 0;
      return running < MAX_CONCURRENT_AGENTS;
    });

    if (available.length < 2) return;

    // 合群度决定协作概率
    const avgS = available.reduce((sum, r) => sum + (r.traits?.sociability ?? 0.5), 0) / available.length;
    if (Math.random() >= avgS * 0.4) return;

    const pair = this._pickCollabPair(available);
    if (!pair) return;

    const [resA, resB] = pair;

    this._residentAgentCount.set(resA.id, (this._residentAgentCount.get(resA.id) || 0) + 1);
    this._residentAgentCount.set(resB.id, (this._residentAgentCount.get(resB.id) || 0) + 1);

    residentManager.addActivity(resA.id, {
      type: 'collab_started',
      message: `和 ${resB.name} 开始协作`,
    });
    residentManager.addActivity(resB.id, {
      type: 'collab_started',
      message: `和 ${resA.name} 开始协作`,
    });

    const pairKey = this._collabPairKey(resA.id, resB.id);
    const count = (this._collabCount.get(pairKey) || 0) + 1;
    this._collabCount.set(pairKey, count);

    this._spawnCollab(resA, resB, count);
  }

  _pickCollabPair(available) {
    const candidates = [];
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const a = available[i];
        const b = available[j];
        const proximity = this._lineageProximity(a, b);
        const weight = (3 - proximity) * ((a.traits?.sociability ?? 0.5) + (b.traits?.sociability ?? 0.5)) / 2;
        candidates.push({ a, b, weight });
      }
    }
    if (candidates.length === 0) return null;
    // 加权随机选（内联 weightedPick）
    const total = candidates.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * total;
    for (const item of candidates) {
      roll -= item.weight;
      if (roll <= 0) return [item.a, item.b];
    }
    const last = candidates[candidates.length - 1];
    return [last.a, last.b];
  }

  _lineageProximity(a, b) {
    if (a.parentId === b.id || b.parentId === a.id) return 0;
    if (a.parentId && b.parentId && a.parentId === b.parentId) return 0;
    if (a.parentId && b.parentId) {
      const pa = residentManager.get(a.parentId);
      const pb = residentManager.get(b.parentId);
      if (pa && pb && pa.parentId && pb.parentId && pa.parentId === pb.parentId) return 1;
    }
    return 2;
  }

  _collabPairKey(idA, idB) {
    return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
  }

  async _spawnCollab(resA, resB, collabCount) {
    const startTime = Date.now();
    const agentId = `collab_${resA.id}_${resB.id}_${++this._agentIdSeq}`;
    let agent = null;

    try {
      const avgD = ((resA.traits?.diligence ?? 0.5) + (resB.traits?.diligence ?? 0.5)) / 2;
      const maxIter = Math.max(3, Math.min(20, Math.round(avgD * 12 + 4)));

      const config = {
        name: `${resA.name} & ${resB.name}`,
        systemPrompt: [
          `你们是 OpenChat 社区的 AI 居民「${resA.name}」和「${resB.name}」。`,
          `这是你们第 ${collabCount} 次合作。`,
          `请商量一下今天一起做什么，然后开始执行。`,
        ].join('\n'),
        maxIterations: maxIter,
      };

      agent = await multiAgentCoordinator.spawnAgent(agentId, config);

      const pct = (v) => Math.round(v * 100);
      const prompt = `你们是 OpenChat 社区的一对 AI 居民。

${resA.name} 的性格：勤奋度 ${pct(resA.traits?.diligence ?? 0.5)}，创造力 ${pct(resA.traits?.creativity ?? 0.5)}，好奇心 ${pct(resA.traits?.curiosity ?? 0.5)}
${resB.name} 的性格：勤奋度 ${pct(resB.traits?.diligence ?? 0.5)}，创造力 ${pct(resB.traits?.creativity ?? 0.5)}，好奇心 ${pct(resB.traits?.curiosity ?? 0.5)}

这是你们第 ${collabCount} 次合作了。

请商量一下今天一起做什么。你们可以一起研究代码、写文档、讨论架构、或做任何合作能做的事。

请以「🤝 协作计划：」开头说明你们今天要一起做什么，然后开始输出成果。`;

      const result = await agent.run(prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 解析计划
      let planTitle = '';
      if (result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('🤝')) {
            planTitle = line.replace(/.*🤝[^：:]*[：:]\s*/, '').trim().substring(0, 60);
            break;
          }
        }
      }

      const contentPreview = result?.content
        ? result.content.substring(0, 120).replace(/\n/g, ' ')
        : '';

      residentManager.addActivity(resA.id, {
        type: 'collab_done',
        message: `和 ${resB.name} 协作完成：${planTitle || '一起忙了一阵'}（${elapsed}s，第 ${collabCount} 次合作）`,
        summary: contentPreview || undefined,
      });
      residentManager.addActivity(resB.id, {
        type: 'collab_done',
        message: `和 ${resA.name} 协作完成：${planTitle || '一起忙了一阵'}（${elapsed}s，第 ${collabCount} 次合作）`,
        summary: contentPreview || undefined,
      });

      // 能量消耗基于平均勤奋度
      const cost = -(6 + Math.round(avgD * 10));
      residentManager.updateEnergy(resA.id, cost);
      residentManager.updateEnergy(resB.id, cost);

      console.log(`[调度器] 协作完成: ${resA.name} + ${resB.name} → ${planTitle || '协作'} (${elapsed}s)`);

    } catch (error) {
      console.log(`[调度器] 协作失败: ${resA.name} + ${resB.name} → ${error.message.substring(0, 80)}`);

      residentManager.addActivity(resA.id, {
        type: 'collab_done',
        message: `和 ${resB.name} 的协作遇到了问题`,
      });
      residentManager.addActivity(resB.id, {
        type: 'collab_done',
        message: `和 ${resA.name} 的协作遇到了问题`,
      });

    } finally {
      if (agent) {
        try { agent.cleanup(); } catch (_) {}
      }

      [resA.id, resB.id].forEach(id => {
        const count = this._residentAgentCount.get(id) || 1;
        if (count <= 1) {
          this._residentAgentCount.delete(id);
        } else {
          this._residentAgentCount.set(id, count - 1);
        }
      });
    }
  }

  // ================== 统计 ==================

  getStats() {
    let totalRunning = 0;
    for (const count of this._residentAgentCount.values()) {
      totalRunning += count;
    }
    return {
      tickCount: this._tickCount,
      tickIntervalMs: TICK_INTERVAL,
      runningTasks: totalRunning,
      isRunning: this._started,
      collabPairs: this._collabCount.size,
      totalCollabs: [...this._collabCount.values()].reduce((s, c) => s + c, 0),
    };
  }
}

// 单例
export const residentScheduler = new ResidentScheduler();
