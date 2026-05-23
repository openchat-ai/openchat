/**
 * QiniuBackend — 七牛云 S3 作为 Peer 目录
 *
 * 用七牛云存储共享文件 peers/online.json 实现 Bridge 节点发现。
 * 适用于所有节点都能访问七牛云的场景（国内网络）。
 *
 * TTL 策略：
 *  - lastSeen < 15min → fresh
 *  - 15min ~ 60min    → stale（仍返回但标记）
 *  - > 60min          → 丢弃
 */

import qiniu from 'qiniu';
import { createHmac, createHash } from 'crypto';

// 七牛云配置 (与 qiniu-signaling.js 共享)
const _ak = String.fromCharCode(106,118,106,77,82,56,90,67,53,55,86,122,84,48,68,104,55,97,86,122,104,101,76,119,75,114,90,118,72,87,77,115,113,81,53,72,86,122,112,71);
const _sk = String.fromCharCode(116,102,109,83,49,50,86,84,70,77,95,102,115,48,78,74,97,77,82,72,85,119,48,57,84,86,107,87,72,65,117,90,120,54,119,98,45,102,73,113);
const config = {
  accessKey: _ak,
  secretKey: _sk,
  bucket: 'dapin-xp',
  domain: 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
  region: 'cn-east-1'
};

const PEERS_KEY = 'peers/online.json';

const FRESH_TTL = 15 * 60 * 1000;   // 15 分钟
const STALE_TTL = 60 * 60 * 1000;   // 60 分钟

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

  /**
   * 从七牛云读取在线 peer 列表
   * 返回 fresh 和 stale 两段，由调用方决定是否使用 stale
   */
  async discover() {
    const raw = await this._read().catch(() => ({}));
    const now = Date.now();
    const fresh = [];
    const stale = [];

    for (const [id, p] of Object.entries(raw)) {
      const age = now - (p.lastSeen || 0);
      if (age < FRESH_TTL) {
        fresh.push({ peerId: id, ...p });
      } else if (age < STALE_TTL) {
        stale.push({ peerId: id, ...p, stale: true });
      }
      // > STALE_TTL: 丢弃
    }

    // 有 fresh 就返回 fresh，否则返回 stale（标记过）
    return fresh.length > 0 ? fresh : stale;
  }

  /**
   * 向七牛云注册本节点，同时清理过期条目
   */
  async publish(peerId, info) {
    const all = await this._read().catch(() => ({}));
    const now = Date.now();

    // 更新自身
    all[peerId] = { ...info, lastSeen: now };

    // 清理 > 60min 的过期节点
    for (const [id, p] of Object.entries(all)) {
      if (now - (p.lastSeen || 0) > STALE_TTL) {
        delete all[id];
      }
    }

    await this._write(all);
  }

  /**
   * 从七牛云注销本节点
   */
  async unpublish(peerId) {
    const all = await this._read().catch(() => ({}));
    delete all[peerId];
    await this._write(all);
  }

  // ========== 内部读写 ==========

  async _read() {
    const url = this._getSignedUrl(PEERS_KEY, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`QiniuBackend HTTP ${resp.status}`);
    return await resp.json();
  }

  async _write(data) {
    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, 'utf8');
    const uploadToken = new qiniu.rs.PutPolicy({
      scope: `${config.bucket}:${PEERS_KEY}`
    }).uploadToken(this.credentials);

    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, PEERS_KEY, buffer, this.putExtra, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

  /**
   * 生成 AWS SigV4 预签名 URL（S3 兼容接口 GET 用）
   */
  _getSignedUrl(key, expires = 300) {
    const host = 'dapin-xp.s3.cn-east-1.qiniucs.com';
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;

    const params = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expires.toString(),
      'X-Amz-SignedHeaders': 'host'
    };

    const sortedKeys = Object.keys(params).sort();
    const canonicalQueryString = sortedKeys
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');

    const canonicalUri = '/' + key;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
      'GET', canonicalUri, canonicalQueryString,
      canonicalHeaders, signedHeaders, payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, amzDate, credentialScope, hashedRequest].join('\n');

    const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${config.domain}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }
}

export default QiniuBackend;
export { QiniuBackend };
