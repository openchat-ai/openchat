import { EventEmitter } from 'events';
import { MessageType, createMessage, vectorMemory } from '../experiments/lib/storage-lib.mjs';
import qiniu from 'qiniu';
import { createHmac, createHash } from 'crypto';

const config = {
  accessKey: 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG',
  secretKey: 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq',
  bucket: 'dapin-xp',
  domain: 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
  region: 'cn-east-1'
};

const PEERS_KEY = 'peers/online.json';
const FRESH_TTL = 15 * 60 * 1000;
const STALE_TTL = 60 * 60 * 1000;

class QiniuBackend {
  constructor() {
    const credentials = new qiniu.Credentials(config.accessKey, config.secretKey);
    const qiniuCfg = new qiniu.conf.Config();
    qiniuCfg.zone = qiniu.zone.Zone_z0;
    this.bucketManager = new qiniu.rs.BucketManager(credentials, qiniuCfg);
    this.formUploader = new qiniu.form_up.FormUploader(qiniuCfg);
    this.putExtra = new qiniu.form_up.PutExtra();
    this.credentials = credentials;
  }

  async discover() {
    const raw = await this._read().catch(() => ({}));
    const now = Date.now();
    const fresh = [];
    const stale = [];
    for (const [id, p] of Object.entries(raw)) {
      const age = now - (p.lastSeen || 0);
      if (age < FRESH_TTL) fresh.push({ peerId: id, ...p });
      else if (age < STALE_TTL) stale.push({ peerId: id, ...p, stale: true });
    }
    return fresh.length > 0 ? fresh : stale;
  }

  async publish(peerId, info) {
    const all = await this._read().catch(() => ({}));
    const now = Date.now();
    all[peerId] = { ...info, lastSeen: now };
    for (const [id, p] of Object.entries(all))
      if (now - (p.lastSeen || 0) > STALE_TTL) delete all[id];
    await this._write(all);
  }

  async unpublish(peerId) {
    const all = await this._read().catch(() => ({}));
    delete all[peerId];
    await this._write(all);
  }

  async _read() {
    const url = this._getSignedUrl(PEERS_KEY, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`QiniuBackend HTTP ${resp.status}`);
    return await resp.json();
  }

  async _write(data) {
    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, 'utf8');
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${PEERS_KEY}` }).uploadToken(this.credentials);
    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, PEERS_KEY, buffer, this.putExtra, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  _getSignedUrl(key, expires = 300) {
    const host = 'dapin-xp.s3.cn-east-1.qiniucs.com';
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
    const params = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': credential, 'X-Amz-Date': amzDate, 'X-Amz-Expires': expires.toString(), 'X-Amz-SignedHeaders': 'host' };
    const sortedKeys = Object.keys(params).sort();
    const canonicalQueryString = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = ['GET', '/' + key, canonicalQueryString, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedRequest].join('\n');
    const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return `${config.domain}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }
}

export { QiniuBackend };

class HttpBackend {
  constructor(urls) { this.urls = urls; }

  async discover() {
    for (const url of this.urls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const body = await resp.json();
          const list = Array.isArray(body) ? body : (body.peers || []);
          if (list.length > 0) return list;
        }
      } catch (e) { console.warn('[p2p] http discover failed:', e.message); }
    }
    return [];
  }

  async publish(peerId, info) {}
  async unpublish(peerId) {}
}

export { HttpBackend };

class PeerRegistry {
  constructor(backends, peerId) { this.backends = backends; this.peerId = peerId; }

  async discoverPeers() {
    for (const backend of this.backends) {
      try {
        const peers = await backend.discover();
        if (Array.isArray(peers) && peers.length > 0) return peers;
      } catch (e) { console.warn('[p2p] backend discover failed:', e.message); }
    }
    return [];
  }

  async publishPeer(info) {
    const results = await Promise.allSettled(this.backends.map(b => b.publish(this.peerId, info)));
    for (const r of results)
      if (r.status === 'rejected') console.debug(`[PeerRegistry] publish failed: ${r.reason?.message || r.reason}`);
  }

  async unpublishPeer() {
    const results = await Promise.allSettled(this.backends.map(b => b.unpublish(this.peerId)));
    for (const r of results)
      if (r.status === 'rejected') console.debug(`[PeerRegistry] unpublish failed: ${r.reason?.message || r.reason}`);
  }
}

export { PeerRegistry };

const GOSSIP_INTERVAL_MS = 60_000;
const SYNC_BATCH_SIZE = 10;

class GossipManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this._p2p = null;
    this._peerClock = new Map();
    this._localClock = Date.now();
    this._timer = null;
    this._vectorMemory = options.vectorMemory || vectorMemory;
  }

  start(p2p) {
    const prevP2p = this._p2p;
    if (prevP2p && prevP2p !== p2p && this._handler)
      prevP2p.removeListener('message', this._handler);
    this._p2p = p2p;
    if (this._timer) return;
    this._handler = ({ from, payload }) => {
      if (payload?.type === MessageType.KNOWLEDGE_SYNC)
        this._handleSyncMessage(from, payload.data);
    };
    p2p.on('message', this._handler);
    this._timer = setInterval(() => this._gossip(), GOSSIP_INTERVAL_MS);
    this._timer.unref();
    setTimeout(() => this._gossip(), 5_000);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._p2p && this._handler) { this._p2p.removeListener('message', this._handler); this._handler = null; }
    this._p2p = null;
    this._peerClock.clear();
  }

  markChanged() { this._localClock = Date.now(); }

  _gossip() {
    if (!this._p2p) return;
    const peers = this._p2p.getConnectedPeers?.() || [];
    if (peers.length === 0) return;
    const allEntries = this._vectorMemory._entries || [];
    const summary = allEntries.slice(-50).map(e => ({ id: e.id, residentId: e.residentId, text: e.text.substring(0, 100), timestamp: e.timestamp }));
    for (const peerId of peers) {
      const lastSync = this._peerClock.get(peerId) || 0;
      const newEntries = summary.filter(e => e.timestamp > lastSync);
      if (newEntries.length === 0) continue;
      this._p2p.sendTo(peerId, createMessage(MessageType.KNOWLEDGE_SYNC, {
        action: 'summary', localClock: this._localClock,
        entries: newEntries.map(e => ({ id: e.id, timestamp: e.timestamp })),
      }));
    }
  }

  _handleSyncMessage(fromPeer, data) {
    if (!data) return;
    if (data.action === 'summary') {
      const missing = [];
      for (const entry of (data.entries || []))
        if (!this._vectorMemory._entries.find(e => e.id === entry.id) && entry.id) missing.push(entry.id);
      if (missing.length > 0 && this._p2p)
        this._p2p.sendTo(fromPeer, createMessage(MessageType.KNOWLEDGE_SYNC, { action: 'request', ids: missing.slice(0, SYNC_BATCH_SIZE) }));
      this._peerClock.set(fromPeer, data.localClock || Date.now());
    } else if (data.action === 'request') {
      const requested = [];
      for (const id of (data.ids || [])) {
        const entry = this._vectorMemory._entries.find(e => e.id === id);
        if (entry) requested.push(entry);
      }
      if (requested.length > 0 && this._p2p)
        this._p2p.sendTo(fromPeer, createMessage(MessageType.KNOWLEDGE_SYNC, { action: 'entries', entries: requested.map(e => ({ id: e.id, residentId: e.residentId, text: e.text, metadata: e.metadata, source: e.source, timestamp: e.timestamp })) }));
    } else if (data.action === 'entries') {
      let count = 0;
      for (const e of (data.entries || [])) {
        if (this._vectorMemory._entries.find(l => l.id === e.id)) continue;
        const byFingerprint = e.metadata?.fp ? this._vectorMemory._entries.find(l => l.metadata?.fp === e.metadata.fp) : null;
        if (byFingerprint) {
          if ((e.timestamp || 0) > (byFingerprint.timestamp || 0))
            Object.assign(byFingerprint, { text: e.text, timestamp: e.timestamp, metadata: e.metadata, source: 'gossip-resolved' });
            count++;
        } else if (e.text) {
          this._vectorMemory.store({ residentId: e.residentId || 'remote', text: e.text, metadata: e.metadata || {}, source: e.source || 'gossip' });
          count++;
        }
      }
      if (count > 0) { this._vectorMemory.save(); console.debug(`[Gossip] synced ${count} entries from ${fromPeer.slice(0, 8)}...`); }
    }
  }
}

export { GossipManager };
