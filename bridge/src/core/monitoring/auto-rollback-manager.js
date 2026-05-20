import { spawn } from 'child_process';

/**
 * AutoRollbackManager 类：自动回滚机制
 */
class AutoRollbackManager {
  constructor() {
    this.rollbackHistory = [];
    this.isRollingBack = false;
    this.onRollback = null;
  }

  /**
   * 执行回滚
   * @param {object} context - 回滚上下文
   * @returns {Promise<object>} 回滚结果
   */
  async rollback(context = {}) {
    if (this.isRollingBack) {
      throw new Error('已在回滚进程中');
    }

    this.isRollingBack = true;
    const rollbackRecord = {
      timestamp: new Date().toISOString(),
      reason: context.reason || 'Test failure detected',
      targetCommit: context.targetCommit || 'HEAD~1',
      status: 'started',
    };

    try {
      // 执行 git revert
      await this.executeGitRevert(rollbackRecord.targetCommit);

      rollbackRecord.status = 'success';
      rollbackRecord.completedAt = new Date().toISOString();

      this.rollbackHistory.push(rollbackRecord);

      if (this.onRollback) {
        this.onRollback(rollbackRecord);
      }

      return {
        success: true,
        message: `已回滚到 ${rollbackRecord.targetCommit}`,
        record: rollbackRecord,
      };
    } catch (error) {
      rollbackRecord.status = 'failed';
      rollbackRecord.error = error.message;
      this.rollbackHistory.push(rollbackRecord);

      throw new Error(`回滚失败: ${error.message}`);
    } finally {
      this.isRollingBack = false;
    }
  }

  /**
   * 执行 git revert
   * @param {string} commit - 目标 commit
   * @returns {Promise<string>} 执行结果
   */
  executeGitRevert(commit) {
    return new Promise((resolve, reject) => {
      const git = spawn('git', ['revert', '--no-edit', commit]);
      let error = '';

      git.stderr.on('data', data => {
        error += data.toString();
      });

      git.on('close', code => {
        if (code === 0) {
          resolve('Reverted successfully');
        } else {
          reject(new Error(`Git revert failed: ${error}`));
        }
      });

      git.on('error', err => {
        reject(new Error(`Failed to execute git: ${err.message}`));
      });
    });
  }

  /**
   * 在测试失败时触发回滚
   * @param {object} testResult - 测试结果
   */
  async onTestFailure(testResult) {
    if (!testResult.success) {
      await this.rollback({
        reason: `Test failure: ${testResult.message}`,
        targetCommit: testResult.failedCommit || 'HEAD~1',
      });
    }
  }

  /**
   * 获取回滚历史
   * @returns {Array} 回滚历史记录
   */
  getHistory() {
    return this.rollbackHistory;
  }

  /**
   * 清空回滚历史
   */
  clearHistory() {
    this.rollbackHistory = [];
  }

  /**
   * 获取统计信息
   * @returns {object} 统计数据
   */
  getStats() {
    const successful = this.rollbackHistory.filter(r => r.status === 'success').length;
    const failed = this.rollbackHistory.filter(r => r.status === 'failed').length;

    return {
      totalRollbacks: this.rollbackHistory.length,
      successful,
      failed,
      isRollingBack: this.isRollingBack,
    };
  }
}

export default AutoRollbackManager;
