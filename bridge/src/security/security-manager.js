import { SecuritySandbox } from './sandbox.js';

/**
 * 安全管理器 - 统一管理 Agent 的安全措施
 */
export class SecurityManager {
  constructor() {
    this.sandbox = new SecuritySandbox();
    this.activeSessions = new Map(); // 活跃会话的安全上下文
  }

  /**
   * 执行安全命令
   */
  async executeSecureCommand(sessionId, command, options = {}) {
    // 获取会话安全上下文
    let sessionContext = this.activeSessions.get(sessionId);
    if (!sessionContext) {
      sessionContext = {
        startTime: Date.now(),
        commandsExecuted: 0,
        resourcesUsed: { cpu: 0, memory: 0, disk: 0 }
      };
      this.activeSessions.set(sessionId, sessionContext);
    }

    // 更新命令计数
    sessionContext.commandsExecuted++;

    try {
      // 执行安全检查
      const result = await this.sandbox.executeCommand(command, options);
      
      // 更新资源使用情况（模拟）
      sessionContext.resourcesUsed.cpu += Math.random() * 10;
      sessionContext.resourcesUsed.memory += Math.random() * 50;
      
      return {
        success: true,
        result: result,
        securityContext: sessionContext
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        securityContext: sessionContext
      };
    }
  }

  /**
   * 获取安全报告
   */
  getSecurityReport(sessionId = null) {
    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return { error: 'Session not found' };
      }
      
      return {
        session: sessionId,
        commandsExecuted: session.commandsExecuted,
        uptime: Date.now() - session.startTime,
        resourcesUsed: session.resourcesUsed,
        sandboxReport: this.sandbox.getSecurityReport()
      };
    }

    // 全局报告
    return {
      totalSessions: this.activeSessions.size,
      totalCommands: Array.from(this.activeSessions.values())
        .reduce((sum, ctx) => sum + ctx.commandsExecuted, 0),
      sandboxReport: this.sandbox.getSecurityReport()
    };
  }

  /**
   * 重置会话安全上下文
   */
  resetSession(sessionId) {
    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.delete(sessionId);
      this.sandbox.resetIterationCounter(); // 重置迭代计数
    }
  }

  /**
   * 获取安全配置
   */
  getSecurityConfig() {
    return this.sandbox.config;
  }

  /**
   * 更新安全配置
   */
  updateSecurityConfig(newConfig) {
    Object.assign(this.sandbox.config, newConfig);
  }
}

// 全局安全管理器实例
export const securityManager = new SecurityManager();