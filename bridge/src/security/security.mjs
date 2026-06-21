export class SecuritySandbox {
  constructor(config = {}) {
    this.config = {
      enableContainerization: config.enableContainerization ?? false,
      maxTimeout: config.maxTimeout ?? 30000,
      maxOutputLines: config.maxOutputLines ?? 200,
      maxMemory: config.maxMemory ?? '512m',
      maxCpu: config.maxCpu ?? '1.0',

      blacklistedCommands: [
        'rm -rf', 'sudo', 'su', 'dd', 'mkfs', 'mount', 'umount', 'chattr',
        'mv /etc /tmp', 'cat /etc/shadow', 'chmod 777 /',
        'shutdown', 'halt', 'poweroff', 'reboot', 'init', 'telinit',
        'kill -9 -1', 'killall -9', ':{():|:&};:', 'fork bomb', 'format', 'diskpart'
      ],

      whitelistedCommands: [
        'ls', 'cat', 'grep', 'find', 'head', 'tail', 'more', 'less',
        'ps', 'top', 'htop', 'df', 'du', 'free', 'whoami', 'pwd',
        'git status', 'git log', 'git diff', 'git show', 'git branch',
        'echo', 'printenv', 'env', 'which', 'whereis', 'whatis'
      ],

      graylistedCommands: [
        'echo', 'cp', 'mv', 'mkdir', 'touch', 'rm', 'rmdir',
        'git add', 'git commit', 'git push', 'git pull',
        'npm install', 'npm uninstall', 'npm update',
        'yarn add', 'yarn remove', 'yarn install',
        'pip install', 'pip uninstall', 'pip install -r',
        'curl', 'wget', 'ssh', 'scp', 'rsync'
      ]
    };

    this.actionHistory = [];
    this.currentIteration = 0;
    this.maxIterations = 10;
    this.loopDetection = new LoopDetector();
  }

  async executeCommand(command, options = {}) {
    const securityCheck = this.securityCheck(command);
    if (!securityCheck.allowed) {
      throw new Error(`Security violation: ${securityCheck.reason}`);
    }

    if (this.currentIteration >= this.maxIterations) {
      throw new Error('Maximum iteration limit reached. Terminating to prevent infinite loop.');
    }
    this.currentIteration++;

    if (this.loopDetection.isRepetitive(command)) {
      throw new Error('Potential infinite loop detected. Action blocked to prevent repetitive behavior.');
    }

    const permissionLevel = this.getPermissionLevel(command);
    if (permissionLevel === 'gray') {
      if (!options.confirmation) {
        throw new Error(`Action requires confirmation: ${command}. Use confirmation option to proceed.`);
      }
    }

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

  securityCheck(command) {
    const cmdLower = command.toLowerCase().trim();

    for (const blacklisted of this.config.blacklistedCommands) {
      if (cmdLower.includes(blacklisted.toLowerCase())) {
        return {
          allowed: false,
          reason: `Blocked by security policy: ${blacklisted}`
        };
      }
    }

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

  isSafeCommand(command) {
    return this.config.whitelistedCommands.some(allowed =>
      command.trim().startsWith(allowed)
    );
  }

  getPermissionLevel(command) {
    if (this.config.whitelistedCommands.some(w => command.startsWith(w))) {
      return 'white';
    }

    if (this.config.graylistedCommands.some(g => command.startsWith(g))) {
      return 'gray';
    }

    return 'black';
  }

  async executeInSandbox(command, options = {}) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockResults = {
          'ls': 'file1.txt  file2.js  src/',
          'pwd': '/home/user/project',
          'git status': 'On branch main\nnothing to commit, working tree clean',
          'echo hello': 'hello',
          'cat package.json': '{"name": "test", "version": "1.0.0"}'
        };

        const result = mockResults[command] || `Executed: ${command}\n(output limited for security)`;

        const lines = result.split('\n');
        if (lines.length > this.config.maxOutputLines) {
          resolve(lines.slice(0, this.config.maxOutputLines).join('\n') + '\n[OUTPUT TRUNCATED FOR SECURITY]');
        } else {
          resolve(result);
        }
      }, Math.random() * 100);
    });
  }

  getSecurityReport() {
    return {
      totalActions: this.actionHistory.length,
      blockedActions: this.actionHistory.filter(a => !a.success).length,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
      recentActions: this.actionHistory.slice(-5),
      securityViolations: this.actionHistory.filter(a =>
        a.error && a.error.includes('Security violation')
      ).length
    };
  }

  resetIterationCounter() {
    this.currentIteration = 0;
    this.loopDetection.reset();
  }
}

class LoopDetector {
  constructor(windowSize = 10) {
    this.actionWindow = [];
    this.windowSize = windowSize;
  }

  isRepetitive(command) {
    this.actionWindow.push(command);

    if (this.actionWindow.length > this.windowSize) {
      this.actionWindow.shift();
    }

    const recentActions = this.actionWindow.slice(-3);
    if (recentActions.length >= 3) {
      const lastThree = recentActions.slice(-3);
      if (lastThree.every(cmd => cmd === lastThree[0])) {
        return true;
      }
    }

    if (this.actionWindow.length >= 4) {
      const recent = this.actionWindow.slice(-4);
      if (recent[0] === recent[2] && recent[1] === recent[3]) {
        return true;
      }
    }

    return false;
  }

  reset() {
    this.actionWindow = [];
  }
}

export class SecurityManager {
  constructor() {
    this.sandbox = new SecuritySandbox();
    this.activeSessions = new Map();
  }

  async executeSecureCommand(sessionId, command, options = {}) {
    let sessionContext = this.activeSessions.get(sessionId);
    if (!sessionContext) {
      sessionContext = {
        startTime: Date.now(),
        commandsExecuted: 0,
        resourcesUsed: { cpu: 0, memory: 0, disk: 0 }
      };
      this.activeSessions.set(sessionId, sessionContext);
    }

    sessionContext.commandsExecuted++;

    try {
      const result = await this.sandbox.executeCommand(command, options);

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

    return {
      totalSessions: this.activeSessions.size,
      totalCommands: Array.from(this.activeSessions.values())
        .reduce((sum, ctx) => sum + ctx.commandsExecuted, 0),
      sandboxReport: this.sandbox.getSecurityReport()
    };
  }

  resetSession(sessionId) {
    if (this.activeSessions.has(sessionId)) {
      this.activeSessions.delete(sessionId);
      this.sandbox.resetIterationCounter();
    }
  }

  getSecurityConfig() {
    return this.sandbox.config;
  }

  updateSecurityConfig(newConfig) {
    Object.assign(this.sandbox.config, newConfig);
  }
}

export const securityManager = new SecurityManager();
