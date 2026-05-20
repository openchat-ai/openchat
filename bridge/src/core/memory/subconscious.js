/**
 * Subconscious — 潜意识系统
 *
 * 不需要思考的自动行为：
 *   心跳 — 定时触发 cycle
 *   呼吸 — 数据进出
 *   反射 — 已知模式的即时响应
 *   梦境 — 闲时整理经验
 *   消化 — 处理已解问题的经验吸收
 */
export class Subconscious {
  constructor(body, learningCore) {
    this.body = body;
    this.lc = learningCore;
    this.idleCycles = 0;
  }

  /** 心跳：定时 pulse */
  heartbeat() {
    if (!this._heartTimer) {
      this._heartTimer = setInterval(() => {
        this.body.beat();
        if (this.body.pulse % 10 === 0) {
          this._breathe();
        }
      }, 3000);
    }
  }

  /** 呼吸：数据进出 */
  _breathe() {
    // 吸入：检查是否有新数据
    const pending = this.lc?.problemPool?.filter(p => !p.solved)?.length || 0;
    // 呼出：输出状态
    if (pending > 0 && this.lc) {
      this.lc._offlineBulkSolve?.();
    }
  }

  /** 反射：已知模式的即时响应（不经过脑） */
  reflex(input) {
    const action = this.body.instinct(String(input));
    return action;
  }

  /** 梦境：闲时处理 */
  async dream() {
    this.idleCycles++;
    if (this.idleCycles % 5 === 0 && this.lc?.semanticNN) {
      // 背景训练 SemanticNN
      const solved = this.lc.problemPool?.filter(p => p.solved && p.question) || [];
      if (solved.length > 0) {
        const p = solved[Math.floor(Math.random() * solved.length)];
        const pairs = this.lc.semanticNN.constructor.generateData?.(p.question);
        if (pairs?.length > 0) {
          this.lc.semanticNN.trainBatch(pairs);
          this.body.dream(`背景训练 ${pairs.length} 对, 总计 ${this.lc.semanticNN.getStats().samples} 样本`);
        }
      }
    }
  }

  /** 消化：吸收经验 */
  digest(solvedProblem) {
    if (!solvedProblem) return;
    // 学习新反射
    const pattern = new RegExp(solvedProblem.question.replace(/\d+/g, '\\d+'));
    this.body.learnReflex(pattern, solvedProblem.answer);
  }

  stop() {
    if (this._heartTimer) clearInterval(this._heartTimer);
  }
}
