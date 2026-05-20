import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Logger 类：结构化日志系统，支持按日期分文件存储
 *
 * 功能：
 * - 结构化日志（JSON 格式）
 * - 日志缓冲区批量写入
 * - 按日期自动分文件
 * - 日志清理机制（保留最近 N 天）
 * - 支持多个日志级别（INFO, WARN, ERROR, DEBUG）
 */
class Logger {
  constructor(logsDir = null) {
    // 默认日志目录：~/.openchat/logs/
    this.logsDir = logsDir || path.join(os.homedir(), '.openchat', 'logs');
    this.logBuffer = []; // 日志缓冲区用于批量写入
    this.bufferSize = 10; // 缓冲区大小阈值

    // 确保日志目录存在
    this.ensureLogsDir();
  }

  /**
   * 确保日志目录存在
   */
  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * 获取今天的日志文件名
   * @returns {string} 文件名 (格式: YYYY-MM-DD.log)
   */
  getTodayLogFile() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}.log`;
  }

  /**
   * 获取完整的日志文件路径
   * @param {string} logFile - 日志文件名
   * @returns {string} 完整路径
   */
  getLogFilePath(logFile = null) {
    const fileName = logFile || this.getTodayLogFile();
    return path.join(this.logsDir, fileName);
  }

  /**
   * 格式化日志条目为结构化 JSON
   * @param {string} level - 日志级别 (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据
   * @returns {string} JSON 格式的日志条目
   */
  formatLog(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data,
    };
    return JSON.stringify(logEntry);
  }

  /**
   * 写入日志（异步）
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据
   * @returns {Promise<void>}
   */
  async log(level, message, data = {}) {
    const logEntry = this.formatLog(level, message, data);

    // 添加到缓冲区
    this.logBuffer.push(logEntry);

    // 当缓冲区达到阈值时，批量写入
    if (this.logBuffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  /**
   * 批量写入缓冲区中的日志
   * @returns {Promise<void>}
   */
  async flush() {
    if (this.logBuffer.length === 0) {
      return;
    }

    try {
      const logFile = this.getLogFilePath();
      const content = this.logBuffer.join('\n') + '\n';

      // 追加到文件
      await fs.promises.appendFile(logFile, content, 'utf-8');

      // 清空缓冲区
      this.logBuffer = [];
    } catch (error) {
      console.error(`Failed to flush logs: ${error.message}`);
    }
  }

  /**
   * INFO 级别日志
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据
   */
  async info(message, data = {}) {
    await this.log('INFO', message, data);
  }

  /**
   * WARN 级别日志
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据
   */
  async warn(message, data = {}) {
    await this.log('WARN', message, data);
  }

  /**
   * ERROR 级别日志
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据或 Error 对象
   */
  async error(message, data = {}) {
    let errorData = data;
    if (data instanceof Error) {
      errorData = {
        errorName: data.name,
        errorMessage: data.message,
        errorStack: data.stack,
      };
    }
    await this.log('ERROR', message, errorData);
  }

  /**
   * DEBUG 级别日志
   * @param {string} message - 日志消息
   * @param {object} data - 额外数据
   */
  async debug(message, data = {}) {
    await this.log('DEBUG', message, data);
  }

  /**
   * 读取今天的日志
   * @returns {Promise<string>} 日志内容
   */
  async readTodayLogs() {
    try {
      const logFile = this.getLogFilePath();
      if (!fs.existsSync(logFile)) {
        return '';
      }
      return await fs.promises.readFile(logFile, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read logs: ${error.message}`);
    }
  }

  /**
   * 读取指定日期的日志
   * @param {string} date - 日期 (格式: YYYY-MM-DD)
   * @returns {Promise<string>} 日志内容
   */
  async readLogsByDate(date) {
    try {
      const logFile = this.getLogFilePath(`${date}.log`);
      if (!fs.existsSync(logFile)) {
        return '';
      }
      return await fs.promises.readFile(logFile, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read logs: ${error.message}`);
    }
  }

  /**
   * 获取所有日志文件
   * @returns {Promise<Array>} 日志文件列表
   */
  async getAllLogFiles() {
    try {
      const files = await fs.promises.readdir(this.logsDir);
      return files
        .filter(file => file.endsWith('.log'))
        .sort()
        .reverse();
    } catch (error) {
      throw new Error(`Failed to list log files: ${error.message}`);
    }
  }

  /**
   * 删除指定日期的日志
   * @param {string} date - 日期 (格式: YYYY-MM-DD)
   * @returns {Promise<void>}
   */
  async deleteLogsByDate(date) {
    try {
      const logFile = this.getLogFilePath(`${date}.log`);
      if (fs.existsSync(logFile)) {
        await fs.promises.unlink(logFile);
      }
    } catch (error) {
      throw new Error(`Failed to delete logs: ${error.message}`);
    }
  }

  /**
   * 清理旧日志（保留最近 N 天）
   * @param {number} daysToKeep - 保留的天数
   * @returns {Promise<number>} 删除的文件数
   */
  async cleanupOldLogs(daysToKeep = 30) {
    try {
      const files = await this.getAllLogFiles();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let deletedCount = 0;

      for (const file of files) {
        // 从文件名解析日期
        const dateMatch = file.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          const fileDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (fileDate < cutoffDate) {
            await this.deleteLogsByDate(dateMatch[0]);
            deletedCount++;
          }
        }
      }

      return deletedCount;
    } catch (error) {
      throw new Error(`Failed to cleanup logs: ${error.message}`);
    }
  }

  /**
   * 获取日志目录路径
   * @returns {string} 日志目录路径
   */
  getLogsDir() {
    return this.logsDir;
  }

  /**
   * 清空缓冲区并关闭
   * @returns {Promise<void>}
   */
  async close() {
    await this.flush();
  }
}

export default Logger;
