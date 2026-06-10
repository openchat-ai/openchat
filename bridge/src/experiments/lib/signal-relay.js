/// Qiniu relay + UDP hole punch for P2P voice
///
/// Qiniu: stores peer endpoint info (IP:port), one single bucket
/// UDP hole punch: both sides exchange addresses via Qiniu, then connect direct
///
/// If UDP punch succeeds → RF ID frames over UDP (~30ms latency)
/// If UDP punch fails → audio falls back to single Qiniu relay (~200ms polling)

import { qiniuSignaling } from './qiniu-signaling.js';

class SignalRelay {
  constructor(qs, peerId) {
    this.qs = qs;
    this.peerId = peerId;
    this.bucket = null;
  }

  async init() {
    const ak = process.env.QINIU_ACCESS_KEY || '';
    const sk = process.env.QINIU_SECRET_KEY || '';
    if (ak && sk) {
      // Use single existing bucket
      this.bucket = {
        name: process.env.QINIU_BUCKET || 'dapin-xp',
        region: process.env.QINIU_REGION || 'cn-east-1',
        domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
      };
    }
  }

  /// Write data to Qiniu
  async write(key, data) {
    if (!this.bucket) return;
    return await this.qs.writeTo(this.bucket, key, data);
  }

  /// Read data from Qiniu
  async read(key) {
    if (!this.bucket) return null;
    try {
      return await this.qs.readFrom(this.bucket, key);
    } catch {
      return null;
    }
  }
}

export { SignalRelay };
