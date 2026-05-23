/// Qiniu cross-region synced bucket relay
///
/// Qiniu Kodo supports automatic cross-region synchronization between buckets.
/// We create buckets in {prefix}-{region} in all supported zones, enable
/// cross-region sync rules, then each peer reads/writes their nearest bucket.
///
/// Phone writes to bucket with lowest WRITE latency.
/// Qiniu internally syncs the data to all other regions.
/// Phone reads from bucket with lowest READ latency.
///
/// No Bridge-side copying needed — Qiniu handles distribution.

import { qiniuSignaling, TARGET_REGIONS } from './qiniu-signaling.js';
import logger from './monitoring/logger.js';

class BucketRelay {
  constructor(qs, peerId) {
    this.qs = qs;
    this.peerId = peerId;
    this._buckets = [];
    this._writeLatency = new Map(); // bucket → avg write ms
    this._readLatency = new Map();  // bucket → avg read ms
  }

  async init() {
    const ak = process.env.QINIU_ACCESS_KEY || '';
    const sk = process.env.QINIU_SECRET_KEY || '';
    const prefix = process.env.QINIU_BUCKET_PREFIX || 'openchat';

    if (ak && sk) {
      // Auto-create buckets and enable cross-region sync
      this._buckets = await qiniuSignaling.constructor.ensureBuckets(ak, sk, prefix);
      await this._enableCrossRegionSync(ak, sk, prefix);
    } else {
      // Demo: single hardcoded bucket
      this._buckets = [{ name: 'dapin-xp', region: 'cn-east-1', domain: 'https://dapin-xp.s3.cn-east-1.qiniucs.com' }];
    }

    // Initial latency probe
    await this.probeAll();
  }

  /// Set up cross-region sync rules so writing to any bucket = all buckets get it
  async _enableCrossRegionSync(ak, sk, prefix) {
    // Qiniu cross-region sync is configured via the Kodo console or API.
    // This is a one-time setup: create sync rules from each bucket to all others.
    // For now, we rely on the user enabling this in the Qiniu console:
    //   Bucket → Data Processing → Cross-Region Sync → Add Rule
    //   Source: openchat-cn-east-1 → Target: openchat-as1, openchat-us-west-1
    //   Source: openchat-as1 → Target: all others
    //   Source: openchat-us-west-1 → Target: all others
  }

  /// Measure latency to all buckets, update best-write/read estimates
  async probeAll() {
    for (const b of this._buckets) {
      try {
        const key = `probe-${this.peerId}-${Date.now()}`;
        const wStart = Date.now();
        await this.qs.writeTo(b, key, Buffer.from([0x00]));
        const wLat = Date.now() - wStart;
        this._writeLatency.set(b.name, wLat);

        const rStart = Date.now();
        await this.qs.readFrom(b, key);
        const rLat = Date.now() - rStart;
        this._readLatency.set(b.name, rLat);
      } catch { logger.warn('[BucketRelay] latency probe failed'); }
    }
  }

  /// Get best bucket for WRITING (phone sending audio)
  getBestWriteBucket() {
    let best = this._buckets[0];
    let bestLat = 9999;
    for (const b of this._buckets) {
      const lat = this._writeLatency.get(b.name) ?? 9999;
      if (lat < bestLat) { best = b; bestLat = lat; }
    }
    return best;
  }

  /// Get best bucket for READING (phone playing audio)
  getBestReadBucket() {
    let best = this._buckets[0];
    let bestLat = 9999;
    for (const b of this._buckets) {
      const lat = this._readLatency.get(b.name) ?? 9999;
      if (lat < bestLat) { best = b; bestLat = lat; }
    }
    return best;
  }

  /// Write audio to the nearest bucket for the writer
  async writeAudio(roomId, seq, data) {
    const b = this.getBestWriteBucket();
    const key = `audio-${roomId}-${seq}`;
    await this.qs.writeTo(b, key, data);
    return { bucket: b.name, key };
  }

  /// Read audio from the nearest bucket for the reader
  async readAudio(key) {
    const b = this.getBestReadBucket();
    try {
      return await this.qs.readFrom(b, key);
    } catch {
      // Fallback: try all buckets
      for (const fb of this._buckets) {
        try { return await this.qs.readFrom(fb, key); } catch { logger.warn('[BucketRelay] fallback read failed for bucket'); }
      }
      throw new Error('audio not found in any bucket');
    }
  }
}

export { BucketRelay };
