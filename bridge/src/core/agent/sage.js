/**
 * Sage Manager — 智者（天人点拨）模块
 *
 * 智者不是聊天机器人，是天人导师。
 * 居民完成任务/遇到困难 → 主动提问
 * 智者（Flutter 用户）可以回答、鼓励、指点
 *
 * 所有记录永久保存，显示在时间线中。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { residentManager } from './resident-manager.js';

const DATA_FILE = path.join(os.homedir(), '.openchat', 'sage.json');

// ================== 底层 IO ==================

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ records: [] }, null, 2), 'utf8');
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { records: [] };
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ================== SageManager ==================

class SageManager {
  constructor() {
    this._nextId = 1;
    this._initNextId();
  }

  _initNextId() {
    const data = readAll();
    const maxId = data.records.reduce((max, r) => {
      const num = parseInt(r.id?.replace('sage_', '') || '0', 10);
      return Math.max(max, num);
    }, 0);
    this._nextId = maxId + 1;
  }

  _nextSageId() {
    return `sage_${this._nextId++}`;
  }

  /**
   * 居民提问
   * @param {number} residentId
   * @param {string} content 提问内容
   * @returns {object} 创建的记录
   */
  ask(residentId, content) {
    const record = {
      id: this._nextSageId(),
      residentId,
      type: 'ask',
      content,
      answered: false,
      parentId: null,
      createdAt: new Date().toISOString(),
    };

    const data = readAll();
    data.records.push(record);
    writeAll(data);

    // 写入居民活动日志
    residentManager.addActivity(residentId, {
      type: 'sage_ask',
      message: content,
      sageRecordId: record.id,
    });

    return record;
  }

  /**
   * 智者回答
   * @param {number} residentId
   * @param {string} recordId 原 ask 记录的 id
   * @param {string} content 回答内容
   * @returns {object} 创建的 answer 记录
   */
  answer(residentId, recordId, content) {
    const data = readAll();

    // 标记原 ask 已答
    const askRecord = data.records.find(r => r.id === recordId && r.residentId === residentId);
    if (!askRecord) {
      throw new Error(`Sage record ${recordId} not found for resident ${residentId}`);
    }
    askRecord.answered = true;

    // 创建 answer 记录
    const record = {
      id: this._nextSageId(),
      residentId,
      type: 'answer',
      content,
      answered: false,
      parentId: recordId,
      createdAt: new Date().toISOString(),
    };
    data.records.push(record);
    writeAll(data);

    // 写入居民活动日志
    residentManager.addActivity(residentId, {
      type: 'sage_answer',
      message: content,
      sageRecordId: record.id,
      parentSageRecordId: recordId,
    });

    return record;
  }

  /**
   * 智者主动点拨（鼓励/指导）
   * @param {number} residentId
   * @param {string} content 点拨内容
   * @param {'guide'|'praise'} type 类型
   * @returns {object} 创建的记录
   */
  guide(residentId, content, type = 'guide') {
    const record = {
      id: this._nextSageId(),
      residentId,
      type,
      content,
      answered: false,
      parentId: null,
      createdAt: new Date().toISOString(),
    };

    const data = readAll();
    data.records.push(record);
    writeAll(data);

    // 写入居民活动日志
    residentManager.addActivity(residentId, {
      type: type === 'praise' ? 'sage_praise' : 'sage_guide',
      message: content,
      sageRecordId: record.id,
    });

    return record;
  }

  /**
   * 获取与某居民的完整对话记录
   * @param {number} residentId
   * @returns {Array} 按时间正序排列的记录
   */
  getConversation(residentId) {
    const data = readAll();
    return data.records
      .filter(r => r.residentId === residentId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * 获取所有未回答的提问
   * @returns {Array}
   */
  getUnanswered() {
    const data = readAll();
    return data.records.filter(r => r.type === 'ask' && !r.answered);
  }

  /**
   * 获取统计
   */
  getStats() {
    const data = readAll();
    const total = data.records.length;
    const unanswered = data.records.filter(r => r.type === 'ask' && !r.answered).length;
    const byResident = {};
    for (const r of data.records) {
      byResident[r.residentId] = (byResident[r.residentId] || 0) + 1;
    }
    return { total, unanswered, byResident };
  }
}

export const sageManager = new SageManager();
