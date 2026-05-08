/**
 * FairyGossip — Fairy 分布式大脑
 *
 * 不再只是 HTTP 转发工，而是互相 share 经验、投票共识、共建知识
 *
 * 协议：
 * 1. FAIRY_GOSSIP    — 每解一题，广播策略+答案+耗时给所有 Fairy
 * 2. FAIRY_CONSENSUS — 同一问题多者求解后，投票选最优答案
 * 3. 每个 Fairy 维护自己的 KB，通过 P2P 互通有无
 */

export class FairyGossip {
  constructor(p2p, kb, myPort) {
    this.p2p = p2p;
    this.kb = kb;
    this.myPort = myPort;
    this._peerExperiences = new Map();    // peerId → [{problem, answer, strategy, time}]
    this._pendingConsensus = new Map();   // problemId → [{answer, peerId, weight}]
    this._lastBroadcast = {};
    this._gossipCount = 0;
    this._consensusCount = 0;
  }

  /**
   * 广播解题经验给所有 Fairy
   */
  broadcastExperience(problem, answer, strategyName, solveTimeMs, isCorrect) {
    const key = problem.id;
    if (this._lastBroadcast[key] && Date.now() - this._lastBroadcast[key] < 3000) return;
    this._lastBroadcast[key] = Date.now();

    const gossip = {
      type: 'fairy_gossip',
      problemId: problem.id,
      question: problem.question?.substring(0, 100),
      domain: problem.domain,
      difficulty: problem.difficulty,
      answer: String(answer).substring(0, 200),
      strategy: strategyName,
      solveTimeMs,
      isCorrect,
      port: this.myPort,
      timestamp: Date.now()
    };

    try {
      this.p2p.broadcast('fairy_gossip', gossip);
      this._gossipCount++;
      console.log(`[FairyGossip] 广播经验: ${problem.id} (${strategyName}, ${solveTimeMs}ms)`);
    } catch (e) {
      console.log(`[FairyGossip] 广播失败: ${e.message}`);
    }
  }

  /**
   * 接收其他 Fairy 的解题经验
   */
  receiveExperience(data) {
    if (!data || !data.problemId) return;

    const peer = data.port || 'unknown';
    if (!this._peerExperiences.has(peer)) {
      this._peerExperiences.set(peer, []);
    }
    this._peerExperiences.get(peer).push(data);
    if (this._peerExperiences.get(peer).length > 100) {
      this._peerExperiences.get(peer).shift();
    }

    // 吸收到本地 KB
    if (this.kb && data.isCorrect && data.answer) {
      try {
        this.kb.add(data.domain, data.question || data.problemId, data.answer, {
          verified: data.isCorrect,
          author: `fairy-${peer}`,
          houseId: String(peer)
        });
        console.log(`[FairyGossip] 吸收 ${peer} 的经验: ${data.problemId}`);
      } catch {}
    }
  }

  /**
   * 收集多个 Fairy 对同一问题的答案，投票共识
   */
  collectConsensus(problemId, answer, peerId) {
    if (!this._pendingConsensus.has(problemId)) {
      this._pendingConsensus.set(problemId, []);
    }
    this._pendingConsensus.get(problemId).push({
      answer: String(answer),
      peerId,
      weight: 1,
      time: Date.now()
    });
  }

  /**
   * 尝试对问题达成共识
   * @returns {{ consensus: boolean, answer: string, votes: number, total: number }} | null
   */
  reachConsensus(problemId) {
    const entries = this._pendingConsensus.get(problemId);
    if (!entries || entries.length < 2) return null;

    // 清理 30 秒以上的旧投票
    const now = Date.now();
    const valid = entries.filter(e => now - e.time < 30000);
    this._pendingConsensus.set(problemId, valid);

    if (valid.length < 2) return null;

    // 统计投票
    const votes = {};
    for (const e of valid) {
      const norm = this._normalizeAnswer(e.answer);
      if (!votes[norm]) votes[norm] = { answer: e.answer, votes: 0, peers: [] };
      votes[norm].votes += e.weight;
      votes[norm].peers.push(e.peerId);
    }

    const sorted = Object.values(votes).sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    const total = valid.length;

    if (winner.votes >= 2) {
      this._consensusCount++;
      console.log(`[FairyGossip] 共识达成: ${problemId} → "${winner.answer.substring(0, 30)}" (${winner.votes}/${total} votes)`);
      return { consensus: true, answer: winner.answer, votes: winner.votes, total };
    }

    return null;
  }

  _normalizeAnswer(answer) {
    return String(answer).replace(/\s+/g, '').toLowerCase().trim();
  }

  /**
   * 获取网络中的智能水平
   */
  getNetworkStats() {
    return {
      gossipCount: this._gossipCount,
      consensusCount: this._consensusCount,
      peerCount: this._peerExperiences.size,
      topPeers: Array.from(this._peerExperiences.entries())
        .map(([port, exps]) => ({ port, experienceCount: exps.length }))
        .sort((a, b) => b.experienceCount - a.experienceCount)
        .slice(0, 5)
    };
  }
}
