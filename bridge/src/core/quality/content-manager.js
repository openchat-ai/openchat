/**
 * 统一内容管理器
 *
 * 管理所有类型的内容：
 * - 代码 (code)
 * - 文件 (file)
 * - 图片 (image)
 * - 语音 (audio)
 * - 视频 (video)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ContentManager {
  constructor(options = {}) {
    this.baseDir = options.baseDir || './data/contents';
    this.maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100MB
    this.allowedTypes = ['code', 'file', 'image', 'audio', 'video', 'text', 'json'];

    // 内容存储
    this.contentIndex = new Map();

    // 初始化目录
    this.initDirectories();
  }

  initDirectories() {
    const types = ['code', 'file', 'image', 'audio', 'video', 'text', 'json'];
    for (const type of types) {
      const dir = path.join(this.baseDir, type);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 存储内容
   */
  async storeContent(content, options = {}) {
    const { type = 'file', metadata = {}, userId = 'system' } = options;

    if (!this.allowedTypes.includes(type)) {
      throw new Error(`Invalid content type: ${type}`);
    }

    const contentId = crypto.randomUUID();
    const timestamp = Date.now();

    const contentRecord = {
      id: contentId,
      type,
      metadata,
      userId,
      timestamp,
      size: 0,
      checksum: null,
      storagePath: null
    };

    // 根据类型处理
    switch (type) {
      case 'code':
      case 'text':
      case 'json':
        contentRecord.storagePath = await this.storeText(content, type, contentId);
        break;

      case 'image':
      case 'audio':
      case 'video':
      case 'file':
        contentRecord.storagePath = await this.storeFile(content, type, contentId);
        break;

      default:
        throw new Error(`Unsupported type: ${type}`);
    }

    // 计算校验和
    if (contentRecord.storagePath) {
      contentRecord.checksum = this.calculateChecksum(contentRecord.storagePath);
      contentRecord.size = fs.statSync(contentRecord.storagePath).size;
    }

    // 索引
    this.contentIndex.set(contentId, contentRecord);

    return contentRecord;
  }

  /**
   * 存储文本内容
   */
  async storeText(content, type, id) {
    const filePath = path.join(this.baseDir, type, `${id}.txt`);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * 存储文件内容
   */
  async storeFile(content, type, id) {
    const ext = this.getExtension(type);
    const filePath = path.join(this.baseDir, type, `${id}.${ext}`);

    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(filePath, content);
    } else if (typeof content === 'string') {
      // 可能是 base64
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);
    }

    return filePath;
  }

  /**
   * 获取内容
   */
  async getContent(contentId) {
    const record = this.contentIndex.get(contentId);
    if (!record) return null;

    if (!record.storagePath || !fs.existsSync(record.storagePath)) {
      return null;
    }

    const data = fs.readFileSync(record.storagePath);

    return {
      ...record,
      data: data.toString('base64'),
      dataType: this.getDataType(record.type)
    };
  }

  /**
   * 获取内容元数据（不加载数据）
   */
  getContentMeta(contentId) {
    return this.contentIndex.get(contentId);
  }

  /**
   * 删除内容
   */
  async deleteContent(contentId) {
    const record = this.contentIndex.get(contentId);
    if (!record) return false;

    if (record.storagePath && fs.existsSync(record.storagePath)) {
      fs.unlinkSync(record.storagePath);
    }

    this.contentIndex.delete(contentId);
    return true;
  }

  /**
   * 搜索内容
   */
  searchContent(query, options = {}) {
    const { type, limit = 20, offset = 0 } = options;

    let results = Array.from(this.contentIndex.values());

    if (type) {
      results = results.filter(c => c.type === type);
    }

    // 按时间排序
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results.slice(offset, offset + limit);
  }

  /**
   * 获取扩展名
   */
  getExtension(type) {
    const extensions = {
      code: 'txt',
      file: 'bin',
      image: 'png',
      audio: 'webm',
      video: 'mp4',
      text: 'txt',
      json: 'json'
    };
    return extensions[type] || 'bin';
  }

  /**
   * 获取数据类型
   */
  getDataType(type) {
    const dataTypes = {
      code: 'text/plain',
      file: 'application/octet-stream',
      image: 'image/png',
      audio: 'audio/webm',
      video: 'video/mp4',
      text: 'text/plain',
      json: 'application/json'
    };
    return dataTypes[type] || 'application/octet-stream';
  }

  /**
   * 计算校验和
   */
  calculateChecksum(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 验证内容完整性
   */
  verifyContent(contentId) {
    const record = this.contentIndex.get(contentId);
    if (!record || !record.storagePath) return false;

    const currentChecksum = this.calculateChecksum(record.storagePath);
    return currentChecksum === record.checksum;
  }
}

module.exports = { ContentManager };