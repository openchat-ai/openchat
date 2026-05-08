// Research by 小明: 杀进程重启的问题：丢失内存状态、断开连接、用户体验差。热加载如何保留状态？
// Generated: 2026-05-12T09:00:38.072Z

// 热加载状态保留研究 - Node.js 实现
// 研究如何通过模块热替换(HMR)保留内存状态

const fs = require('fs');
const path = require('path');

// 模拟一个需要保留状态的应用模块
class ChatServer {
  constructor() {
    this.connections = new Map();
    this.messages = [];
    this.stateVersion = 1;
  }

  addConnection(userId, socket) {
    this.connections.set(userId, { socket, connectedAt: Date.now() });
    console.log(`[状态] 用户 ${userId} 已连接，当前连接数: ${this.connections.size}`);
  }

  addMessage(userId, text) {
    const msg = { userId, text, timestamp: Date.now() };
    this.messages.push(msg);
    console.log(`[状态] 消息已添加，总消息数: ${this.messages.length}`);
    return msg;
  }

  getStats() {
    return {
      connections: this.connections.size,
      messages: this.messages.length,
      stateVersion: this.stateVersion
    };
  }
}

// 状态管理器 - 核心热加载机制
class HotStateManager {
  constructor() {
    this.state = null;
    this.stateFilePath = path.join(__dirname, '.hot_state.json');
    this.backupFilePath = path.join(__dirname, '.hot_state.backup.json');
  }

  // 保存状态到文件（热加载时的持久化）
  saveState(app) {
    const stateData = {
      connections: Array.from(app.connections.entries()).map(([userId, connData]) => ({
        userId,
        connectedAt: connData.connectedAt
      })),
      messages: app.messages.slice(-100), // 只保留最近100条消息
      stateVersion: app.stateVersion + 1,
      savedAt: Date.now()
    };

    try {
      // 先写备份文件，防止写坏主文件
      fs.writeFileSync(this.backupFilePath, JSON.stringify(stateData, null, 2));
      // 原子性替换主文件
      fs.renameSync(this.backupFilePath, this.stateFilePath);
      console.log(`[热加载] 状态已保存 (版本 ${stateData.stateVersion})`);
      return true;
    } catch (err) {
      console.error('[热加载] 保存状态失败:', err.message);
      return false;
    }
  }

  // 加载之前保存的状态
  loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const rawData = fs.readFileSync(this.stateFilePath, 'utf8');
        const stateData = JSON.parse(rawData);

        // 重建 ChatServer 实例
        const app = new ChatServer();
        app.stateVersion = stateData.stateVersion || 1;
        
        // 恢复连接（不恢复实际socket，只恢复元数据）
        if (stateData.connections) {
          stateData.connections.forEach(conn => {
            app.connections.set(conn.userId, {
              socket: null, // 实际socket需要重新建立
              connectedAt: conn.connectedAt
            });
          });
        }

        // 恢复消息
        if (stateData.messages) {
          app.messages = stateData.messages;
        }

        console.log(`[热加载] 状态已恢复 (版本 ${app.stateVersion}, 连接: ${app.connections.size}, 消息: ${app.messages.length})`);
        return app;
      }
    } catch (err) {
      console.error('[热加载] 加载状态失败:', err.message);
      // 尝试从备份恢复
      if (fs.existsSync(this.backupFilePath)) {
        console.log('[热加载] 尝试从备份恢复...');
        fs.renameSync(this.backupFilePath, this.stateFilePath);
        return this.loadState(); // 递归尝试
      }
    }
    return null;
  }

  // 清理状态文件
  cleanup() {
    try {
      if (fs.existsSync(this.stateFilePath)) fs.unlinkSync(this.stateFilePath);
      if (fs.existsSync(this.backupFilePath)) fs.unlinkSync(this.backupFilePath);
      console.log('[热加载] 状态文件已清理');
    } catch (err) {
      console.error('[热加载] 清理失败:', err.message);
    }
  }
}

// 模拟热加载过程
class HotReloadSimulator {
  constructor() {
    this.stateManager = new HotStateManager();
    this.app = null;
    this.reloadCount = 0;
  }

  // 初始化应用（首次启动）
  initialize() {
    console.log('\n=== 应用首次启动 ===');
    this.app = new ChatServer();
    this.app.stateVersion = 1;
    
    // 模拟一些操作
    this.app.addConnection('user1', { id: 'socket1' });
    this.app.addConnection('user2', { id: 'socket2' });
    this.app.addMessage('user1', '你好！');
    this.app.addMessage('user2', '热加载测试');
    this.app.addMessage('user1', '状态应该被保留');

    console.log('当前状态:', this.app.getStats());
    return this.app;
  }

  // 执行热加载（模拟重启）
  hotReload() {
    this.reloadCount++;
    console.log(`\n=== 第 ${this.reloadCount} 次热加载 ===`);
    
    // 1. 保存当前状态
    console.log('[步骤1] 保存当前状态...');
    const saved = this.stateManager.saveState(this.app);
    if (!saved) {
      console.error('[热加载] 状态保存失败，无法继续');
      return false;
    }

    // 2. 模拟应用重启（销毁旧实例）
    console.log('[步骤2] 销毁旧应用实例...');
    this.app = null;

    // 3. 加载新版本的应用代码（这里用同一个类，但实际场景可能是更新后的代码）
    console.log('[步骤3] 加载新版本应用...');
    const newApp = this.stateManager.loadState();
    
    if (newApp) {
      this.app = newApp;
      // 模拟重新建立实际连接（socket）
      this.app.connections.forEach((conn, userId) => {
        conn.socket = { id: `new_socket_${userId}` };
        console.log(`[恢复] 用户 ${userId} 的连接已重建`);
      });
      
      console.log('热加载后状态:', this.app.getStats());
      return true;
    } else {
      console.error('[热加载] 状态恢复失败，启动全新实例');
      this.app = new ChatServer();
      return false;
    }
  }

  // 模拟多次热加载并验证状态连续性
  simulateMultipleReloads(count = 3) {
    console.log('\n========== 热加载状态保留研究 ==========');
    console.log('研究目标：验证通过序列化/反序列化保留应用状态');
    console.log('关键问题：内存状态、连接断开、用户体验\n');

    this.initialize();
    
    let allSuccess = true;
    for (let i = 0; i < count; i++) {
      const success = this.hotReload();
      if (!success) {
        allSuccess = false;
        break;
      }
      
      // 每次热加载后添加新数据，验证状态累积
      this.app.addMessage('system', `热加载 #${i+1} 完成`);
      console.log(`累积消息数: ${this.app.messages.length}`);
    }

    console.log('\n========== 研究结论 ==========');
    if (allSuccess) {
      console.log('✅ 热加载状态保留成功！');
      console.log(`最终状态: 连接数=${this.app.connections.size}, 消息数=${this.app.messages.length}, 版本=${this.app.stateVersion}`);
      console.log('\n关键发现:');
      console.log('1. 状态序列化到磁盘可以跨重启保留');
      console.log('2. 连接元数据可恢复，但实际socket需要重建');
      console.log('3. 用户需要重新连接，但历史状态完好');
      console.log('4. 使用原子写入和备份文件提高可靠性');
      console.log('\n优化建议:');
      console.log('- 使用内存数据库(如Redis)替代文件存储');
      console.log('- 实现连接池和自动重连机制');
      console.log('- 采用WebSocket心跳检测恢复连接');
      console.log('- 对大型状态使用增量更新');
    } else {
      console.log('❌ 热加载过程中出现错误');
    }

    // 清理
    this.stateManager.cleanup();
  }
}

// 运行研究
const simulator = new HotReloadSimulator();
simulator.simulateMultipleReloads(3apse);