/**
 * Session 事件总线：pub/sub
 * 任何 agent 流程都通过 publish() 发送事件
 * 多个 dev 页面可以 subscribe() 同一个 session
 */
class SessionEvents {
  constructor() {
    this.subscribers = new Map();   // sessionId -> Set<callback>
    this.history = new Map();       // sessionId -> 最近 200 条事件（用于回放）
    this.activeTasks = new Map();   // sessionId -> { lastEventAt, status }
  }

  /** 发布事件到总线 + 缓存历史 */
  publish(sessionId, event) {
    if (!sessionId) return;
    const enriched = { ...event, sessionId, ts: Date.now() };

    if (!this.history.has(sessionId)) this.history.set(sessionId, []);
    const hist = this.history.get(sessionId);
    hist.push(enriched);
    if (hist.length > 200) hist.shift();

    if (!this.activeTasks.has(sessionId)) this.activeTasks.set(sessionId, {});
    this.activeTasks.get(sessionId).lastEventAt = Date.now();

    const subs = this.subscribers.get(sessionId);
    if (subs) for (const cb of subs) {
      try { cb(enriched); } catch {}
    }
  }

  /** 订阅 session 事件；返回取消订阅函数 */
  subscribe(sessionId, callback) {
    if (!this.subscribers.has(sessionId)) this.subscribers.set(sessionId, new Set());
    this.subscribers.get(sessionId).add(callback);

    // 立刻回放历史
    const hist = this.history.get(sessionId) || [];
    for (const ev of hist) {
      try { callback(ev); } catch {}
    }
    return () => this.unsubscribe(sessionId, callback);
  }

  unsubscribe(sessionId, callback) {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) this.subscribers.delete(sessionId);
    }
  }

  /** 列所有 session（按最后活跃时间倒序） */
  list() {
    const all = new Set([
      ...this.subscribers.keys(),
      ...this.history.keys(),
      ...this.activeTasks.keys()
    ]);
    return [...all].map(sid => {
      const meta = this.activeTasks.get(sid) || {};
      const eventCount = (this.history.get(sid) || []).length;
      const subscriberCount = (this.subscribers.get(sid) || new Set()).size;
      return { sessionId: sid, lastEventAt: meta.lastEventAt || 0, eventCount, subscriberCount };
    }).sort((a, b) => b.lastEventAt - a.lastEventAt);
  }

  /** 取 session 历史 */
  getHistory(sessionId) {
    return this.history.get(sessionId) || [];
  }
}

export const sessionEvents = new SessionEvents();
