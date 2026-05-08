// Research by 小红: 杀进程重启的问题：丢失内存状态、断开连接、用户体验差。热加载如何保留状态？
// Generated: 2026-05-12T09:00:26.577Z

// 状态管理器 - 用于在热加载时保留状态
const fs = require('fs');
const path = require('path');

class StateManager {
  constructor() {
    this.stateFile = path.join(__dirname, 'app_state.json');
    this.memoryState = {};
    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.memoryState = JSON.parse(data);
        console.log('[状态管理器] 从磁盘恢复状态:', JSON.stringify(this.memoryState));
      } else {
        console.log('[状态管理器] 首次启动，无历史状态');
        this.memoryState = {
          userSessions: {},
          connectionCount: 0,
          lastActivity: null
        };
      }
    } catch (err) {
      console.error('[状态管理器] 加载状态失败:', err.message);
      this.memoryState = {
        userSessions: {},
        connectionCount: 0,
        lastActivity: null
      };
    }
  }

  saveState() {
    try {
      this.memoryState.lastActivity = new Date().toISOString();
      fs.writeFileSync(this.stateFile, JSON.stringify(this.memoryState, null, 2));
      console.log('[状态管理器] 状态已保存到磁盘');
    } catch (err) {
      console.error('[状态管理器] 保存状态失败:', err.message);
    }
  }

  // 更新用户会话
  updateUserSession(userId, data) {
    if (!this.memoryState.userSessions[userId]) {
      this.memoryState.userSessions[userId] = {
        createdAt: new Date().toISOString(),
        data: {}
      };
    }
    Object.assign(this.memoryState.userSessions[userId].data, data);
    this.saveState();
  }

  // 获取用户会话
  getUserSession(userId) {
    return this.memoryState.userSessions[userId] || null;
  }

  // 增加连接计数
  incrementConnection() {
    this.memoryState.connectionCount++;
    this.saveState();
    return this.memoryState.connectionCount;
  }

  // 获取当前状态
  getState() {
    return { ...this.memoryState };
  }
}

// 模拟热加载模块
class HotReloadModule {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.moduleName = `Module_${Date.now()}`;
    console.log(`[${this.moduleName}] 模块已创建`);
  }

  // 模拟处理用户请求
  handleRequest(userId, action, payload) {
    console.log(`\n[${this.moduleName}] 处理用户 ${userId} 的请求: ${action}`);
    
    // 从状态管理器恢复用户会话
    let session = this.stateManager.getUserSession(userId);
    if (!session) {
      console.log(`[${this.moduleName}] 新用户会话创建`);
      this.stateManager.updateUserSession(userId, { firstAction: action });
    } else {
      console.log(`[${this.moduleName}] 恢复用户会话，历史操作:`, session.data);
    }

    // 执行操作并更新状态
    const result = this.executeAction(userId, action, payload);
    this.stateManager.updateUserSession(userId, { 
      lastAction: action,
      lastResult: result,
      actionCount: (session?.data?.actionCount || 0) + 1
    });

    return result;
  }

  executeAction(userId, action, payload) {
    // 模拟业务逻辑
    const timestamp = new Date().toISOString();
    return {
      success: true,
      action,
      timestamp,
      userId,
      processedBy: this.moduleName,
      data: payload ? `处理数据: ${payload}` : '无数据'
    };
  }
}

// 模拟热加载系统
class HotReloadSystem {
  constructor() {
    this.stateManager = new StateManager();
    this.currentModule = null;
    this.reloadCount = 0;
    
    console.log('\n========== 热加载系统初始化 ==========');
    console.log('[系统] 当前状态:', this.stateManager.getState());
    
    this.loadModule();
  }

  loadModule() {
    // 模拟加载新模块（实际中会清除require缓存）
    this.currentModule = new HotReloadModule(this.stateManager);
    this.reloadCount++;
    console.log(`[系统] 模块已加载 (第${this.reloadCount}次)`);
  }

  reload() {
    console.log('\n========== 执行热加载 ==========');
    console.log('[系统] 保存当前状态到磁盘...');
    this.stateManager.saveState();
    
    // 模拟模块热替换
    console.log('[系统] 卸载旧模块...');
    delete this.currentModule;
    
    console.log('[系统] 加载新模块...');
    this.loadModule();
    
    console.log('[系统] 状态已保留，连接和会话未中断');
    return this.currentModule;
  }

  // 模拟系统崩溃重启
  simulateCrashRestart() {
    console.log('\n========== 模拟系统崩溃重启 ==========');
    console.log('[系统] 系统崩溃！所有内存状态丢失！');
    
    // 模拟重启过程
    console.log('[系统] 重启中...');
    this.stateManager = new StateManager(); // 从磁盘恢复
    this.loadModule();
    
    console.log('[系统] 重启完成，状态从磁盘恢复');
  }
}

// 运行研究
function runStudy() {
  console.log('========================================');
  console.log('    热加载状态保留研究 - 运行报告');
  console.log('========================================\n');

  const system = new HotReloadSystem();
  
  // 模拟用户操作
  console.log('\n--- 用户操作阶段 ---');
  const module1 = system.currentModule;
  module1.handleRequest('user_001', 'login', { username: '小红' });
  module1.handleRequest('user_001', 'view_page', '首页');
  module1.handleRequest('user_002', 'login', { username: '小明' });
  
  console.log('\n当前状态:', JSON.stringify(system.stateManager.getState(), null, 2));
  
  // 执行热加载
  console.log('\n--- 热加载测试 ---');
  const module2 = system.reload();
  
  // 热加载后继续处理请求
  module2.handleRequest('user_001', 'click_button', '提交订单');
  module2.handleRequest('user_002', 'view_page', '个人中心');
  
  console.log('\n热加载后状态:', JSON.stringify(system.stateManager.getState(), null, 2));
  
  // 模拟崩溃重启
  console.log('\n--- 崩溃重启测试 ---');
  system.simulateCrashRestart();
  
  // 重启后恢复会话
  const module3 = system.currentModule;
  module3.handleRequest('user_001', 'checkout', '完成支付');
  
  console.log('\n最终状态:', JSON.stringify(system.stateManager.getState(), null, 2));
  
  // 输出研究结论
  console.log('\n========================================');
  console.log('研究结论:');
  console.log('========================================');
  console.log('1. 热加载保留状态的关键：定期将内存状态持久化到磁盘');
  console.log('2. 通过状态管理器统一管理，模块只关心业务逻辑');
  console.log('3. 用户会话、连接计数等关键数据在热加载后完整保留');
  console.log('4. 崩溃重启也能通过磁盘恢复状态，保证用户体验');
  console.log('5. 缺点：频繁IO操作可能影响性能，需合理设置保存频率');
  console.log('========================================');
  
  // 清理测试文件
  try {
    fs.unlinkSync(path.join(__dirname, 'app_state.json'));
    console.log('\n[清理] 测试状态文件已删除');
  } catch (e) {
    // 忽略
  }
}

// 运行研究
runStudy();