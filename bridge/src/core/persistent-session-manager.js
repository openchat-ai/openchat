import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from './monitoring/logger.js';

/**
 * PersistentSessionManager 类：工作会话持久化管理器
 * 支持保存、加载、恢复工作会话
 *
 * 与SessionManager的区别：
 * - SessionManager: 管理AI提供者连接
 * - PersistentSessionManager: 管理工作会话（对话记录等）
 */
class PersistentSessionManager {
  constructor(storageDir = null) {
    // 默认存储位置：~/.openchat/sessions/
    this.storageDir = storageDir || path.join(os.homedir(), '.openchat', 'sessions');
    this.sessions = new Map(); // 内存中的活跃会话
    this.indexFile = path.join(this.storageDir, 'sessions-index.json');

    // 确保存储目录存在
    this.ensureStorageDir();
  }

  /**
   * 确保存储目录存在
   */
  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * 创建一个新会话
   * @param {string} id - 会话 ID（可选，自动生成）
   * @param {object} data - 会话数据
   * @returns {object} 会话对象
   */
  createSession(id = null, data = {}) {
    const sessionId = id || this.generateSessionId();
    const session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: data || {},
      metadata: {
        lastError: null,
        state: 'active',
      },
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 生成唯一的会话 ID
   * @returns {string} 会话 ID
   */
  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取会话
   * @param {string} sessionId - 会话 ID
   * @returns {object|null} 会话对象或 null
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 更新会话数据
   * @param {string} sessionId - 会话 ID
   * @param {object} data - 要更新的数据
   */
  updateSession(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.data = { ...session.data, ...data };
    session.updatedAt = new Date().toISOString();
  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话 ID
   * @returns {boolean} 是否删除成功
   */
  removeSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * 获取所有会话
   * @returns {Array} 会话数组
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 保存会话到磁盘
   * @param {string} sessionId - 会话 ID（可选，不提供则保存所有）
   * @returns {Promise<object>} 保存结果
   */
  async saveSession(sessionId = null) {
    try {
      if (sessionId) {
        // 保存单个会话
        const session = this.sessions.get(sessionId);
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }

        const sessionFile = path.join(this.storageDir, `${sessionId}.json`);
        await fs.promises.writeFile(
          sessionFile,
          JSON.stringify(session, null, 2),
          'utf-8'
        );

        return { success: true, sessionId, file: sessionFile };
      } else {
        // 保存所有会话
        const sessions = Array.from(this.sessions.values());
        const index = {
          version: '1.0',
          savedAt: new Date().toISOString(),
          count: sessions.length,
          sessions: sessions.map(s => ({ id: s.id, createdAt: s.createdAt })),
        };

        // 保存索引文件
        await fs.promises.writeFile(
          this.indexFile,
          JSON.stringify(index, null, 2),
          'utf-8'
        );

        // 保存每个会话
        for (const session of sessions) {
          const sessionFile = path.join(this.storageDir, `${session.id}.json`);
          await fs.promises.writeFile(
            sessionFile,
            JSON.stringify(session, null, 2),
            'utf-8'
          );
        }

        return {
          success: true,
          count: sessions.length,
          message: `Saved ${sessions.length} sessions`,
        };
      }
    } catch (error) {
      throw new Error(`Failed to save session: ${error.message}`);
    }
  }

  /**
   * 从磁盘加载会话
   * @param {string} sessionId - 会话 ID（可选，不提供则加载所有）
   * @returns {Promise<object|Array>} 加载的会话（或会话数组）
   */
  async loadSession(sessionId = null) {
    try {
      if (sessionId) {
        // 加载单个会话
        const sessionFile = path.join(this.storageDir, `${sessionId}.json`);
        if (!fs.existsSync(sessionFile)) {
          throw new Error(`Session file not found: ${sessionFile}`);
        }

        const content = await fs.promises.readFile(sessionFile, 'utf-8');
        const session = JSON.parse(content);
        this.sessions.set(sessionId, session);

        return session;
      } else {
        // 加载所有会话
        if (!fs.existsSync(this.indexFile)) {
          logger.info('No sessions found to load');
          return [];
        }

        const indexContent = await fs.promises.readFile(this.indexFile, 'utf-8');
        const index = JSON.parse(indexContent);

        const loadedSessions = [];
        for (const sessionRef of index.sessions) {
          try {
            const session = await this.loadSession(sessionRef.id);
            loadedSessions.push(session);
          } catch (e) {
            logger.warn(`Failed to load session ${sessionRef.id}: ${e.message}`);
          }
        }

        return loadedSessions;
      }
    } catch (error) {
      throw new Error(`Failed to load session: ${error.message}`);
    }
  }

  /**
   * 恢复工作状态（加载最后一个活跃会话）
   * @returns {Promise<object|null>} 最后一个会话或 null
   */
  async restoreLastSession() {
    try {
      const sessions = await this.loadSession();
      if (sessions.length === 0) {
        return null;
      }

      // 返回最近的会话
      return sessions.reduce((latest, current) => {
        const latestTime = new Date(latest.updatedAt).getTime();
        const currentTime = new Date(current.updatedAt).getTime();
        return currentTime > latestTime ? current : latest;
      });
    } catch (error) {
      logger.warn(`Failed to restore last session: ${error.message}`);
      return null;
    }
  }

  /**
   * 清空所有会话
   */
  clearSessions() {
    this.sessions.clear();
  }

  /**
   * 删除所有保存的会话文件
   * @returns {Promise<number>} 删除的文件数
   */
  async clearAllSessionFiles() {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      let deletedCount = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storageDir, file);
          await fs.promises.unlink(filePath);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      throw new Error(`Failed to clear session files: ${error.message}`);
    }
  }

  /**
   * 获取会话统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.metadata.state === 'active').length,
      oldestSession: sessions.length > 0 ? Math.min(...sessions.map(s => new Date(s.createdAt).getTime())) : null,
      newestSession: sessions.length > 0 ? Math.max(...sessions.map(s => new Date(s.createdAt).getTime())) : null,
    };
  }

  /**
   * 获取存储目录路径
   * @returns {string} 存储目录路径
   */
  getStorageDir() {
    return this.storageDir;
  }

  /**
   * 导出会话为 JSON 字符串
   * @param {string} sessionId - 会话 ID
   * @returns {string} JSON 字符串
   */
  exportSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return JSON.stringify(session, null, 2);
  }

  /**
   * 从 JSON 字符串导入会话
   * @param {string} jsonString - JSON 字符串
   * @returns {object} 导入的会话
   */
  importSession(jsonString) {
    try {
      const session = JSON.parse(jsonString);
      if (!session.id) {
        throw new Error('Session must have an id field');
      }
      this.sessions.set(session.id, session);
      return session;
    } catch (error) {
      throw new Error(`Failed to import session: ${error.message}`);
    }
  }
}

export default PersistentSessionManager;
