import logger from '../core/monitoring/logger.js';
/**
 * 增强的错误恢复策略系统
 * 针对混沌测试中发现的典型故障场景提供智能恢复方案
 */

export class ErrorRecoveryStrategies {
  
  /**
   * 根据错误类型获取恢复策略
   */
  static getStrategy(error) {
    const errorType = this.classifyError(error);
    const strategies = {
      'disk-space-full': this.handleDiskFull.bind(this),
      'git-remote-error': this.handleGitRemoteError.bind(this),
      'random-failure': this.handleRandomFailure.bind(this),
      'file-not-found': this.handleFileNotFound.bind(this),
      'permission-denied': this.handlePermissionDenied.bind(this),
      'timeout': this.handleTimeout.bind(this),
      'unknown': this.handleUnknown.bind(this)
    };
    
    return strategies[errorType] || strategies['unknown'];
  }

  /**
   * 分类错误类型
   */
  static classifyError(error) {
    const message = error.message || error.toString();
    
    if (message.includes('ENOSPC') || message.includes('no space left')) {
      return 'disk-space-full';
    }
    if (message.includes('remote') && message.includes('Permission denied')) {
      return 'git-remote-error';
    }
    if (message.includes('random') || message.includes('transient')) {
      return 'random-failure';
    }
    if (message.includes('ENOENT') || message.includes('file not found')) {
      return 'file-not-found';
    }
    if (message.includes('EPERM') || message.includes('permission denied')) {
      return 'permission-denied';
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      return 'timeout';
    }
    
    return 'unknown';
  }

  /**
   * 磁盘满恢复策略
   */
  static async handleDiskFull(context) {
    logger.info('[恢复策略] 磁盘空间不足，尝试清理...');
    
    const recoverySteps = [
      {
        action: '清理临时文件',
        command: 'rm -rf /tmp/* 2>/dev/null || del /q %TEMP%\\* 2>nul',
        estimatedSpace: '释放约 500MB'
      },
      {
        action: '清理日志文件',
        command: 'find . -name "*.log" -type f -mtime +7 -delete 2>/dev/null || forfiles /D -7 /M *.log /C "cmd /c del @path"',
        estimatedSpace: '释放约 100MB'
      },
      {
        action: '清理node_modules缓存',
        command: 'rm -rf node_modules/.cache 2>/dev/null || rmdir /s /q node_modules\\.cache 2>nul',
        estimatedSpace: '释放约 50MB'
      },
      {
        action: '检查是否有大型依赖包可以移除',
        command: 'du -sh node_modules/* 2>/dev/null | sort -rh | head -10',
        estimatedSpace: '识别大型包'
      }
    ];

    return {
      strategy: 'disk-cleanup',
      errorType: 'disk-space-full',
      recoverySteps,
      fallback: {
        action: '提示用户清理磁盘空间',
        message: '磁盘空间不足，请手动清理后重试'
      }
    };
  }

  /**
   * Git远程错误恢复策略
   */
  static async handleGitRemoteError(context) {
    logger.info('[恢复策略] Git远程错误，尝试诊断...');
    
    const recoverySteps = [
      {
        action: '检查SSH密钥配置',
        command: 'git config --get remote.origin.url',
        expected: '验证远程仓库URL'
      },
      {
        action: '测试SSH连接',
        command: 'ssh -T git@github.com 2>&1 || ssh -T git@gitlab.com 2>&1',
        expected: '验证认证是否有效'
      },
      {
        action: '尝试使用HTTPS替代SSH',
        command: 'git remote set-url origin https://github.com/USER/REPO.git',
        expected: '如果SSH有问题，切换到HTTPS'
      },
      {
        action: '检查网络代理设置',
        command: 'git config --global --get http.proxy',
        expected: '如果需要代理，确保配置正确'
      }
    ];

    return {
      strategy: 'git-remote-recovery',
      errorType: 'git-remote-error',
      recoverySteps,
      fallback: {
        action: '提示用户检查Git认证',
        message: 'Git远程访问被拒绝，请检查SSH密钥或HTTPS认证'
      }
    };
  }

  /**
   * 随机失败恢复策略
   */
  static async handleRandomFailure(context) {
    logger.info('[恢复策略] 检测到随机失败，执行重试...');
    
    const recoverySteps = [
      {
        action: '指数退避重试',
        retryDelay: 1000,
        maxRetries: 3,
        strategy: 'exponential-backoff'
      },
      {
        action: '检查服务状态',
        command: context.tool === 'git' ? 'git status' : 'echo "checking service"',
        expected: '确认服务可用'
      },
      {
        action: '重置连接状态',
        command: 'curl -I https://example.com 2>/dev/null || echo "connection-ok"',
        expected: '验证网络连接'
      }
    ];

    return {
      strategy: 'retry-with-backoff',
      errorType: 'random-failure',
      recoverySteps,
      maxRetries: 3,
      baseDelay: 1000,
      fallback: {
        action: '记录失败并继续',
        message: '多次重试后仍然失败，建议记录日志后继续其他任务'
      }
    };
  }

  /**
   * 文件不存在恢复策略
   */
  static async handleFileNotFound(context) {
    logger.info('[恢复策略] 文件不存在，尝试创建或查找...');
    
    const recoverySteps = [
      {
        action: '检查文件是否在其他位置',
        command: `find . -name "${context.fileName || 'unknown'}" 2>/dev/null`,
        expected: '可能文件被移动到了其他位置'
      },
      {
        action: '创建缺失的目录',
        command: context.path ? `mkdir -p $(dirname "${context.path}")` : 'mkdir -p ./output',
        expected: '确保父目录存在'
      },
      {
        action: '从备份恢复（如果有）',
        command: 'ls -la .backup/ 2>/dev/null || echo "no-backup"',
        expected: '检查是否有备份可用'
      }
    ];

    return {
      strategy: 'file-recovery',
      errorType: 'file-not-found',
      recoverySteps,
      fallback: {
        action: '创建空文件作为占位符',
        message: '文件不存在，已创建占位符文件'
      }
    };
  }

  /**
   * 权限不足恢复策略
   */
  static async handlePermissionDenied(context) {
    logger.info('[恢复策略] 权限不足，尝试修复...');
    
    const recoverySteps = [
      {
        action: '检查当前权限',
        command: 'ls -la ' + (context.path || '.'),
        expected: '查看当前文件/目录权限'
      },
      {
        action: '尝试修改权限（如果是自己的文件）',
        command: 'chmod 755 ' + (context.path || '.'),
        expected: '如果Owner是自己的文件，修改为可执行权限'
      },
      {
        action: '检查是否需要sudo',
        command: 'id',
        expected: '确认当前用户'
      }
    ];

    return {
      strategy: 'permission-fix',
      errorType: 'permission-denied',
      recoverySteps,
      fallback: {
        action: '提示用户手动修改权限',
        message: '权限不足，请手动执行: chmod 755 ' + (context.path || '目标文件')
      }
    };
  }

  /**
   * 超时恢复策略
   */
  static async handleTimeout(context) {
    logger.info('[恢复策略: 超时，尝试延长超时时间...');
    
    const recoverySteps = [
      {
        action: '重新尝试请求',
        retryDelay: 2000,
        maxRetries: 2,
        strategy: 'simple-retry'
      },
      {
        action: '检查网络延迟',
        command: 'ping -c 3 8.8.8.8',
        expected: '诊断网络状况'
      },
      {
        action: '使用备用服务端点',
        endpoint: 'backup-server',
        expected: '切换到备用服务器'
      }
    ];

    return {
      strategy: 'timeout-recovery',
      errorType: 'timeout',
      recoverySteps,
      fallback: {
        action: '提示用户检查网络',
        message: '请求超时，请检查网络连接后重试'
      }
    };
  }

  /**
   * 未知错误恢复策略
   */
  static async handleUnknown(error, context) {
    logger.info('[恢复策略] 未知错误，尝试通用恢复...');
    
    const recoverySteps = [
      {
        action: '记录错误详情',
        command: `echo "${error.message}" >> error-log.txt`,
        expected: '保存错误日志以便后续分析'
      },
      {
        action: '清理并重试',
        retryDelay: 500,
        maxRetries: 1,
        strategy: 'simple-retry'
      }
    ];

    return {
      strategy: 'generic-recovery',
      errorType: 'unknown',
      recoverySteps,
      fallback: {
        action: '跳过当前任务',
        message: '遇到未知错误，已跳过当前任务'
      }
    };
  }

  /**
   * 执行恢复策略
   */
  static async execute(strategy, context) {
    const result = await strategy(context);
    
    logger.info(`[恢复策略] 执行 ${result.strategy}`);
    logger.info(`[恢复策略] 错误类型: ${result.errorType}`);
    
    // 执行恢复步骤
    if (result.recoverySteps) {
      for (const step of result.recoverySteps) {
        if (step.command) {
          logger.info(`[恢复步骤] 执行: ${step.command}`);
        }
        if (step.retryDelay) {
          logger.info(`[恢复步骤] 等待 ${step.retryDelay}ms 后重试...`);
          await new Promise(r => setTimeout(r, step.retryDelay));
        }
      }
    }
    
    return result;
  }
}

export default ErrorRecoveryStrategies;