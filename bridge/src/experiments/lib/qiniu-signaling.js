/**
 * 七牛云信令交换模块
 *
 * 用途：手机 App 与内网 Bridge 通过七牛云存储交换 P2P 连接信息
 *
 * 流程：
 * 1. 房间分配：手机请求 → 分配空闲 room
 * 2. Offer：手机放 SDP offer → 电脑读取
 * 3. Answer：电脑放 SDP answer → 手机读取
 * 4. ICE Candidates：交换候选地址
 * 5. 连接建立：P2P 直连 → 释放房间
 */

import qiniu from 'qiniu';
import { createHmac, createHash } from 'crypto';

// 七牛云配置（优先 .env，没有则用默认演示账号）
const _ak = process.env.QINIU_ACCESS_KEY || 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const _sk = process.env.QINIU_SECRET_KEY || 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const config = {
  accessKey: _ak,
  secretKey: _sk,
  bucket: process.env.QINIU_BUCKET || 'dapin-xp',
  region: process.env.QINIU_REGION || 'cn-east-1',
  domain: process.env.QINIU_DOMAIN || 'dapin-xp.s3.cn-east-1.qiniucs.com',
  bucketPrefix: process.env.QINIU_BUCKET_PREFIX || 'openchat',
};

const credentials = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
const configQiniu = new qiniu.conf.Config();
configQiniu.zone = qiniu.zone.Zone_z0;
configQiniu.useCdnDomain = false;

const SIGNALS_DIR = 'signaling';
const COORDINATOR_DIR = `${SIGNALS_DIR}/coordinator`;
const MAX_ROOMS = 100;

// 多区域桶支持（导出给 bucket-relay 用）
const TARGET_REGIONS = [
  { name: 'cn-east-1', zone: qiniu.zone.Zone_z0 },
  { name: 'as1',       zone: qiniu.zone.Zone_as0 },
  { name: 'us-west-1', zone: qiniu.zone.Zone_na0 },
];
export { TARGET_REGIONS };  // 最大房间数

class QiniuSignaling {
  constructor() {
    this.peerId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.currentRoom = null;
    this.bucketManager = new qiniu.rs.BucketManager(credentials, configQiniu);
    this.formUploader = new qiniu.form_up.FormUploader(configQiniu);
    this.putExtra = new qiniu.form_up.PutExtra();
    console.debug(`[QiniuSignaling] Bridge peerId: ${this.peerId}`);
  }

  /**
   * 初始化：创建目录结构
   */
  async initialize() {
    // 确保目录存在
    await this._ensureDir(COORDINATOR_DIR);
    console.debug('[QiniuSignaling] Initialized');
  }

  /**
   * 生成预签名 URL (用于手机直接读取)
   */
  getSignedUrl(key, expires = 300) {
    const host = config.domain;
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

  /**
   * 获取预签名 URL (给手机用)
   */
  getReaderUrl(roomId, fileName, expires = 300) {
    return this.getSignedUrl(`${COORDINATOR_DIR}/room-${roomId}/${fileName}`, expires);
  }

  /**
   * 获取上传 URL (给手机用)
   */
  getWriterUrl(roomId, fileName, expires = 300) {
    // 上传需要用七牛 SDK，这里返回配置信息
    return {
      uploadUrl: `https://upload.qiniup.com/`,
      domain: config.domain,
      bucket: config.bucket,
      accessKey: config.accessKey,
      // 手机端需要用这个策略生成 token
      putPolicyScope: config.bucket
    };
  }

  /**
   * 生成上传 Token (供手机使用)
   */
  getUploadToken(key) {
    const putPolicy = new qiniu.rs.PutPolicy({ scope: config.bucket });
    putPolicy.fsizeMin = 1;
    putPolicy.fsizeLimit = 10 * 1024 * 1024; // 10MB
    const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
    return putPolicy.uploadToken(mac);
  }

  /**
   * 申请房间 (Bridge 被手机唤醒)
   */
  async applyForRoom(phonePeerId) {
    // 检查是否有空闲房间
    const rooms = await this._listRooms();

    // 找一个空房间
    for (let i = 1; i <= MAX_ROOMS; i++) {
      const roomId = i.toString().padStart(3, '0');
      if (!rooms.includes(roomId)) {
        // 占用这个房间
        await this._writeJson(`room-${roomId}/status`, {
          status: 'pending',
          phonePeerId,
          bridgePeerId: this.peerId,
          createdAt: new Date().toISOString()
        });

        this.currentRoom = roomId;
        console.debug(`[QiniuSignaling] Allocated room-${roomId} for ${phonePeerId}`);

        return {
          roomId,
          offerUrl: this.getReaderUrl(roomId, 'offer'),
          answerUrl: this.getWriterUrl(roomId, 'answer'),
          iceUrl: this.getReaderUrl(roomId, 'ice-candidates')
        };
      }
    }

    throw new Error('No available rooms');
  }

  /**
   * 监听新 offer (Bridge 检测手机发来的 offer)
   */
  async checkForOffer(roomId) {
    try {
      const offerData = await this._readJson(`room-${roomId}/offer`);
      return offerData;
    } catch (e) {
      return null; // 没有新 offer
    }
  }

  /**
   * 写入 answer (Bridge 回复手机)
   */
  async writeAnswer(roomId, sdp, iceCandidates = []) {
    await this._writeJson(`room-${roomId}/answer`, {
      sdp,
      iceCandidates,
      bridgePeerId: this.peerId,
      timestamp: new Date().toISOString()
    });

    // 更新状态
    await this._writeJson(`room-${roomId}/status`, {
      status: 'connected',
      connectedAt: new Date().toISOString()
    });

    console.debug(`[QiniuSignaling] Wrote answer for room-${roomId}`);
  }

  /**
   * 读取 ICE candidates (手机读取 Bridge 的候选地址)
   */
  async readIceCandidates(roomId) {
    try {
      const data = await this._readJson(`room-${roomId}/ice-candidates`);
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 写入 ICE candidates (Bridge 写自己的候选地址)
   */
  async writeIceCandidates(roomId, candidates) {
    await this._writeJson(`room-${roomId}/ice-candidates`, {
      candidates,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 释放房间
   */
  async releaseRoom(roomId) {
    try {
      await this._deleteFile(`room-${roomId}/status`);
      await this._deleteFile(`room-${roomId}/offer`);
      await this._deleteFile(`room-${roomId}/answer`);
      await this._deleteFile(`room-${roomId}/ice-candidates`);
      await this._deleteFile(`room-${roomId}/data-to-bridge`);
      await this._deleteFile(`room-${roomId}/data-to-phone`);
      console.debug(`[QiniuSignaling] Released room-${roomId}`);
    } catch (e) {
      // 忽略删除错误
    }

    if (this.currentRoom === roomId) {
      this.currentRoom = null;
    }
  }

  // ========== 多桶自动创建 ==========

  /// Auto-create buckets in all regions. Returns created/existing buckets.
  static async ensureBuckets(accessKey, secretKey, prefix) {
    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    const results = [];

    for (const region of TARGET_REGIONS) {
      const bucketName = `${prefix}-${region.name}`;
      const domain = `https://${bucketName}.${region.endpoint || (region.name + '.qiniucs.com')}`;
      const bm = new qiniu.rs.BucketManager(mac, new qiniu.conf.Config());

      try {
        // Check if exists
        await bm.stat(bucketName, 'probe');
        results.push({ name: bucketName, region: region.name, domain });
      } catch (e) {
        // Create
        try {
          await bm.createBucket(bucketName, region.zone);
          results.push({ name: bucketName, region: region.name, domain });
        } catch (createErr) {
          // Skip regions we can't create in
        }
      }
    }
    return results;
  }

  // ========== 多桶读写 ==========

  /// Write to a specific bucket
  async writeTo(bucket, key, data) {
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${bucket.name}:${key}` }).uploadToken(credentials);
    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, data, this.putExtra, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /// Read from a specific bucket
  async readFrom(bucket, key) {
    const host = bucket.domain.replace('https://', '');
    const url = this.getSignedUrl(key, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`readFrom HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  /** 现有的 _writeJson 保持不变 */

  /**
   * 手机发送数据到 Bridge (通过七牛云)
   */
  async phoneSendData(roomId, data) {
    const key = `room-${roomId}/data-to-bridge`;
    await this._writeJson(key, {
      data: data,
      peerId: this.peerId,
      timestamp: new Date().toISOString()
    });
    console.debug(`[QiniuSignaling] Phone sent data to room-${roomId}`);
  }

  /**
   * Bridge 检查手机发来的数据
   */
  async checkPhoneData(roomId, lastTimestamp) {
    try {
      const key = `room-${roomId}/data-to-bridge`;
      const data = await this._readJson(key);

      // 检查是否有新数据
      if (data && data.timestamp && data.timestamp > lastTimestamp) {
        return {
          data: data.data,
          timestamp: data.timestamp
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Bridge 发送数据到手机 (通过七牛云)
   */
  async bridgeSendData(roomId, data) {
    const key = `room-${roomId}/data-to-phone`;
    await this._writeJson(key, {
      data: data,
      peerId: this.peerId,
      timestamp: new Date().toISOString()
    });
    console.debug(`[QiniuSignaling] Bridge sent data to room-${roomId}`);
  }

  /**
   * 手机检查 Bridge 发来的数据
   */
  async checkBridgeData(roomId, lastTimestamp) {
    try {
      const key = `room-${roomId}/data-to-phone`;
      const data = await this._readJson(key);

      // 检查是否有新数据
      if (data && data.timestamp && data.timestamp > lastTimestamp) {
        return {
          data: data.data,
          timestamp: data.timestamp
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 轮询手机数据 (给 Bridge 用)
   */
  startPhoneDataPolling(roomId, callback, intervalMs = 1000) {
    let lastTimestamp = '';

    const timer = setInterval(async () => {
      try {
        const result = await this.checkPhoneData(roomId, lastTimestamp);
        if (result) {
          lastTimestamp = result.timestamp;
          callback(result.data);
        }
      } catch (e) {
        // 忽略轮询错误
      }
    }, intervalMs);

    return timer;
  }

  /**
   * 列出已占用的房间
   */
  async _listRooms() {
    const rooms = [];
    // 简化：直接尝试检查 001-100
    // 生产环境可以用七牛的 list 接口
    for (let i = 1; i <= MAX_ROOMS; i++) {
      const roomId = i.toString().padStart(3, '0');
      try {
        await this._stat(`room-${roomId}/status`);
        rooms.push(roomId);
      } catch (e) {
        // 房间不存在
      }
    }
    return rooms;
  }

  /**
   * 确保目录存在 (创建空文件标记)
   */
  async _ensureDir(key) {
    // S3 兼容接口会自动创建目录
    try {
      await this._stat(key);
    } catch (e) {
      // 目录不存在，忽略
    }
  }

  /**
   * 写 JSON 文件
   */
  async _writeJson(key, data) {
    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, 'utf8');
    // scope: 'bucket:key' 允许覆盖已有文件
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}` }).uploadToken(credentials);

    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, buffer, this.putExtra, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

  /**
   * 读 JSON 文件（通过预签名 URL + HTTP GET）
   */
  async _readJson(key) {
    const url = this.getSignedUrl(key, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`_readJson HTTP ${resp.status} for ${key}`);
    return await resp.json();
  }

  /**
   * 删除文件
   */
  async _deleteFile(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.delete(config.bucket, key, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

  /**
   * 上传/覆盖文件
   */
  async putObject(key, data) {
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}` }).uploadToken(credentials);
    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, data, this.putExtra, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /**
   * 删除文件
   */
  async deleteObject(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.delete(config.bucket, key, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /**
   * 按前缀列出文件
   */
  async listObjects(prefix) {
    if (!this.bucketManager) throw new Error('bucketManager not initialized');
    return new Promise((resolve, reject) => {
      try {
        this.bucketManager.listPrefix(config.bucket, { prefix, limit: 200 }, (err, respBody, respInfo) => {
          if (err) {
            console.debug(`[qiniu-list] err=`, err);
            reject(err);
          } else {
            const items = (respBody?.items || []).map(it => ({
              key: it.key,
              size: it.fsize || 0,
              lastModified: it.putTime ? it.putTime / 10000 : 0,
            }));
            resolve(items);
          }
        });
      } catch (e) {
        console.debug(`[qiniu-list] exception=`, e);
        reject(e);
      }
    });
  }

  /**
   * 检查文件是否存在
   */
  async _stat(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.stat(config.bucket, key, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

}

export const qiniuSignaling = new QiniuSignaling();
export default QiniuSignaling;