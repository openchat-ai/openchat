/**
 * Agent 安全沙箱系统
 * 实现物理隔离、权限控制、资源限制等安全措施
 */
export class SecuritySandbox {
  constructor(config = {}) {
    this.config = {
      // 安全配置
      enableContainerization: config.enableContainerization ?? false,
      maxTimeout: config.maxTimeout ?? 30000, // 30秒超时
      maxOutputLines: config.maxOutputLines ?? 200,
      maxMemory: config.maxMemory ?? '512m',
      maxCpu: config.maxCpu ?? '1.0',
      
      // 黑名单命令
      blacklistedCommands: [
        'rm -rf',
        'sudo',
        'su',
        'dd',
        'mkfs',
        'mount',
        'umount',
        'chattr',
        'mv /etc /tmp',
        'cat /etc/shadow',
        'chmod 777 /',
        'shutdown',
        'halt',
        'poweroff',
        'reboot',
        'init',
        'telinit',
        'kill -9 -1',
        'killall -9',
        ':(){ :|:& };:',
        'fork bomb',
        'format',
        'diskpart'
      ],
      
      // 白名单命令（只读操作）
      whitelistedCommands: [
        'ls', 'cat', 'grep', 'find', 'head', 'tail', 'more', 'less',
        'ps', 'top', 'htop', 'df', 'du', 'free', 'whoami', 'pwd',
        'git status', 'git log', 'git diff', 'git show', 'git branch',
        'echo', 'printenv', 'env', 'which', 'whereis', 'whatis'
      ],
      
      // 灰名单命令（需要确认）
      graylistedCommands: [
        'echo', 'cp', 'mv', 'mkdir', 'touch', 'rm', 'rmdir',
        'git add', 'git commit', 'git push', 'git pull',
        'npm install', 'npm uninstall', 'npm update',
        'yarn add', 'yarn remove', 'yarn install',
        'pip install', 'pip uninstall', 'pip install -r',
        'curl', 'wget', 'ssh', 'scp', 'rsync'
      ]
    };
    
    this.actionHistory = []; // 记录执行历史
    this.currentIteration = 0;
    this.maxIterations = 10; // 最大迭代次数
    this.loopDetection = new LoopDetector();
  }

  /**
   * 执行命令的安全包装器
   */
  async executeCommand(command, options = {}) {
    // 1. 安全检查
    const securityCheck = this.securityCheck(command);
    if (!securityCheck.allowed) {
      throw new Error(`Security violation: ${securityCheck.reason}`);
    }

    // 2. 资源限制检查
    if (this.currentIteration >= this.maxIterations) {
      throw new Error('Maximum iteration limit reached. Terminating to prevent infinite loop.');
    }
    this.currentIteration++;

    // 3. 循环检测
    if (this.loopDetection.isRepetitive(command)) {
      throw new Error('Potential infinite loop detected. Action blocked to prevent repetitive behavior.');
    }

    // 4. 权限控制
    const permissionLevel = this.getPermissionLevel(command);
    if (permissionLevel === 'gray') {
      // 需要人工确认
      if (!options.confirmation) {
        throw new Error(`Action requires confirmation: ${command}. Use confirmation option to proceed.`);
      }
    }

    // 5. 执行命令（在真实实现中，这里应运行在沙盒环境中）
    try {
      const result = await this.executeInSandbox(command, options);
      this.actionHistory.push({
        command,
        timestamp: Date.now(),
        success: true,
        result: result
      });
      return result;
    } catch (error) {
      this.actionHistory.push({
        command,
        timestamp: Date.now(),
        success: false,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 安全检查
   */
  securityCheck(command) {
    const cmdLower = command.toLowerCase().trim();
    
    // 检查黑名单
    for (const blacklisted of this.config.blacklistedCommands) {
      if (cmdLower.includes(blacklisted.toLowerCase())) {
        return {
          allowed: false,
          reason: `Blocked by security policy: ${blacklisted}`
        };
      }
    }

    // 检查是否包含危险字符
    if (/[;&|$`]/.test(command) && !this.isSafeCommand(command)) {
      return {
        allowed: false,
        reason: 'Contains potentially dangerous characters'
      };
    }

    return {
      allowed: true,
      reason: 'Passed security checks'
    };
  }

  /**
   * 判断是否为安全命令
   */
  isSafeCommand(command) {
    // 白名单命令总是安全的
    return this.config.whitelistedCommands.some(allowed => 
      command.trim().startsWith(allowed)
    );
  }

  /**
   * 获取命令权限级别
   */
  getPermissionLevel(command) {
    if (this.config.whitelistedCommands.some(w => command.startsWith(w))) {
      return 'white';
    }
    
    if (this.config.graylistedCommands.some(g => command.startsWith(g))) {
      return 'gray';
    }
    
    return 'black'; // 默认为黑/需确认
  }

  /**
   * 在沙盒中执行命令（模拟）
   */
  async executeInSandbox(command, options = {}) {
    // 这里应该是真实的沙盒执行逻辑
    // 但在当前实现中，我们模拟这个过程
    
    return new Promise((resolve) => {
      setTimeout(() => {
        // 模拟命令执行结果
        const mockResults = {
          'ls': 'file1.txt  file2.js  src/',
          'pwd': '/home/user/project',
          'git status': 'On branch main\nnothing to commit, working tree clean',
          'echo hello': 'hello',
          'cat package.json': '{"name": "test", "version": "1.0.0"}'
        };
        
        const result = mockResults[command] || `Executed: ${command}\n(output limited for security)`;
        
        // 限制输出长度
        const lines = result.split('\n');
        if (lines.length > this.config.maxOutputLines) {
          resolve(lines.slice(0, this.config.maxOutputLines).join('\n') + '\n[OUTPUT TRUNCATED FOR SECURITY]');
        } else {
          resolve(result);
        }
      }, Math.random() * 100); // 模拟执行延迟
    });
  }

  /**
   * 获取安全报告
   */
  getSecurityReport() {
    return {
      totalActions: this.actionHistory.length,
      blockedActions: this.actionHistory.filter(a => !a.success).length,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
      recentActions: this.actionHistory.slice(-5), // 最近5次操作
      securityViolations: this.actionHistory.filter(a => 
        a.error && a.error.includes('Security violation')
      ).length
    };
  }

  /**
   * 重置迭代计数器
   */
  resetIterationCounter() {
    this.currentIteration = 0;
    this.loopDetection.reset();
  }
}

/**
 * 循环检测器
 */
class LoopDetector {
  constructor(windowSize = 10) {
    this.actionWindow = [];
    this.windowSize = windowSize;
  }

  /**
   * 检查是否为重复操作
   */
  isRepetitive(command) {
    this.actionWindow.push(command);
    
    // 保持窗口大小
    if (this.actionWindow.length > this.windowSize) {
      this.actionWindow.shift();
    }

    // 检查最近的重复
    const recentActions = this.actionWindow.slice(-3); // 检查最近3次
    if (recentActions.length >= 3) {
      const lastThree = recentActions.slice(-3);
      if (lastThree.every(cmd => cmd === lastThree[0])) {
        return true; // 连续3次相同命令
      }
    }

    // 检查 A->B->A 模式（循环模式）
    if (this.actionWindow.length >= 4) {
      const recent = this.actionWindow.slice(-4);
      if (recent[0] === recent[2] && recent[1] === recent[3]) {
        return true; // 检测到 A->B->A->B 循环
      }
    }

    return false;
  }

  /**
   * 重置检测器
   */
  reset() {
    this.actionWindow = [];
  }
}