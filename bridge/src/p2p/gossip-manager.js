/**
 * Gossip Manager — Cross-Bridge knowledge sync via P2P
 * 八卦协议管理器：通过 P2P 网络在多个 Bridge 之间同步居民知识
 *
 * Uses timestamp-based vector clock for conflict resolution.
 * Periodically gossips knowledge summaries; peers pull missing entries.
 * 时间戳向量时钟冲突解决。定期八卦知识摘要，对端拉取缺失条目。
 */
import { EventEmitter } from 'events';
import { MessageType, createMessage } from './messages.js';
import { vectorMemory } from '../core/vector-memory.js';

const GOSSIP_INTERVAL_MS = 60_000; // 每 60 秒广播一次摘要
const SYNC_BATCH_SIZE = 10;         // 每次同步最多 10 条

class GossipManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this._p2p = null;
    this._peerClock = new Map();   // peerId → last sync timestamp
    this._localClock = Date.now(); // last local change time
    this._timer = null;
    this._vectorMemory = options.vectorMemory || vectorMemory;
  }

  /**
   * Start gossip loop — call after P2P is connected
   * 启动八卦循环：在 P2P 连接后调用（幂等，可换 p2p 实例）
   */
  start(p2p) {
    const prevP2p = this._p2p;
    if (prevP2p && prevP2p !== p2p && this._handler) {
      prevP2p.removeListener('message', this._handler);
    }

    this._p2p = p2p;
    if (this._timer) return;

    this._handler = ({ from, payload }) => {
      if (payload?.type === MessageType.KNOWLEDGE_SYNC) {
        this._handleSyncMessage(from, payload.data);
      }
    };
    p2p.on('message', this._handler);

    // Periodic gossip
    this._timer = setInterval(() => this._gossip(), GOSSIP_INTERVAL_MS);
    this._timer.unref();
    console.log('[Gossip] started, interval:', GOSSIP_INTERVAL_MS / 1000 + 's');

    // Do first gossip after a short delay
    setTimeout(() => this._gossip(), 5_000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._p2p && this._handler) {
      this._p2p.removeListener('message', this._handler);
      this._handler = null;
    }
    this._p2p = null;
    this._peerClock.clear();
  }

  /**
   * Mark local knowledge as changed — triggers next gossip cycle
   * 标记本地知识有变化，触发下轮广播
   */
  markChanged() {
    this._localClock = Date.now();
  }

  // ---- internal ----

  _gossip() {
    if (!this._p2p) return;
    const peers = this._p2p.getConnectedPeers?.() || [];
    if (peers.length === 0) return;

    // Build summary: [{ peerId: entry.residentId, text, timestamp, id }]
    const allEntries = this._vectorMemory._entries || [];
    const summary = allEntries.slice(-50).map(e => ({
      id: e.id,
      residentId: e.residentId,
      text: e.text.substring(0, 100),
      timestamp: e.timestamp,
    }));

    for (const peerId of peers) {
      const lastSync = this._peerClock.get(peerId) || 0;
      const newEntries = summary.filter(e => e.timestamp > lastSync);

      if (newEntries.length === 0) continue;

      // Send summary only (peer will request missing entries)
      this._p2p.sendTo(peerId, createMessage(MessageType.KNOWLEDGE_SYNC, {
        action: 'summary',
        localClock: this._localClock,
        entries: newEntries.map(e => ({ id: e.id, timestamp: e.timestamp })),
      }));
    }
  }

  _handleSyncMessage(fromPeer, data) {
    if (!data) return;

    if (data.action === 'summary') {
      // Remote peer has new entries — request the ones we don't have
      const missing = [];
      for (const entry of (data.entries || [])) {
        const local = this._vectorMemory._entries.find(e => e.id === entry.id);
        if (!local && entry.id) {
          missing.push(entry.id);
        }
      }
      if (missing.length > 0 && this._p2p) {
        this._p2p.sendTo(fromPeer, createMessage(MessageType.KNOWLEDGE_SYNC, {
          action: 'request',
          ids: missing.slice(0, SYNC_BATCH_SIZE),
        }));
      }
      this._peerClock.set(fromPeer, data.localClock || Date.now());
    }

    else if (data.action === 'request') {
      // Remote peer wants full entries — send them
      const requested = [];
      for (const id of (data.ids || [])) {
        const entry = this._vectorMemory._entries.find(e => e.id === id);
        if (entry) requested.push(entry);
      }
      if (requested.length > 0 && this._p2p) {
        this._p2p.sendTo(fromPeer, createMessage(MessageType.KNOWLEDGE_SYNC, {
          action: 'entries',
          entries: requested.map(e => ({
            id: e.id,
            residentId: e.residentId,
            text: e.text,
            metadata: e.metadata,
            source: e.source,
            timestamp: e.timestamp,
          })),
        }));
      }
    }

    else if (data.action === 'entries') {
      // Received full entries — store with conflict resolution
      // LWW: if same fingerprint exists, keep newer timestamp
      let count = 0;
      for (const e of (data.entries || [])) {
        const byId = this._vectorMemory._entries.find(l => l.id === e.id);
        if (byId) continue; // exact match, skip

        // Check fingerprint conflict: same problem, different answer
        const byFingerprint = e.metadata?.fp
          ? this._vectorMemory._entries.find(l => l.metadata?.fp === e.metadata.fp)
          : null;

        if (byFingerprint) {
          // Conflict detected: resolve by LWW
          if ((e.timestamp || 0) > (byFingerprint.timestamp || 0)) {
            // Remote is newer — replace local
            Object.assign(byFingerprint, {
              text: e.text,
              timestamp: e.timestamp,
              metadata: e.metadata,
              source: 'gossip-resolved',
            });
            count++;
          }
          // If local is newer, keep local (no-op)
        } else if (e.text) {
          // No conflict, new entry
          this._vectorMemory.store({
            residentId: e.residentId || 'remote',
            text: e.text,
            metadata: e.metadata || {},
            source: e.source || 'gossip',
          });
          count++;
        }
      }
      if (count > 0) {
        this._vectorMemory.save();
        console.log(`[Gossip] synced ${count} entries from ${fromPeer.slice(0, 8)}...`);
      }
    }
  }
}

export { GossipManager };
