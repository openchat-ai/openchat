// Research by 小明: 杀进程重启的问题：丢失内存状态、断开连接、用户体验差。热加载如何保留状态？
// Generated: 2026-05-12T09:00:41.219Z

// 热加载状态保留系统 - 演示如何在不丢失内存状态的情况下重新加载模块

const fs = require('fs');
const path = require('path');

// ========== 状态管理器 ==========
class StateManager {
  constructor() {
    this.states = new Map();
    this.persistentStates = new Map();
  }

  // 注册持久化状态
  registerState(key, initialValue) {
    if (!this.persistentStates.has(key)) {
      this.persistentStates.set(key, initialValue);
    }
    return this.persistentStates.get(key);
  }

  // 获取持久化状态
  getState(key) {
    return this.persistentStates.get(key);
  }

  // 更新持久化状态
  updateState(key, updater) {
    const current = this.persistentStates.get(key);
    const newValue = typeof updater === 'function' ? updater(current) : updater;
    this.persistentStates.set(key, newValue);
    return newValue;
  }

  // 保存状态到文件
  saveToFile(filePath) {
    const data = {};
    this.persistentStates.forEach((value, key) => {
      data[key] = value;
    });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`状态已保存到 ${filePath}`);
  }

  // 从文件加载状态
  loadFromFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        Object.entries(data).forEach(([key, value]) => {
          this.persistentStates.set(key, value);
        });
        console.log(`从 ${filePath} 加载状态成功`);
        return true;
      }
    } catch (error) {
      console.error('加载状态失败:', error.message);
    }
    return false;
  }
}

// ========== 热加载模块系统 ==========
class HotReloadSystem {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.modules = new Map();
    this.stateFilePath = path.join(__dirname, 'hot_reload_state.json');
  }

  // 加载或重新加载模块
  loadModule(moduleName, moduleFactory) {
    // 尝试从持久化状态恢复
    const moduleState = this.stateManager.registerState(moduleName, {});
    
    // 创建模块实例
    const module = {
      name: moduleName,
      state: moduleState,
      lastLoaded: new Date().toISOString(),
      version: (this.modules.get(moduleName)?.version || 0) + 1
    };

    this.modules.set(moduleName, module);
    
    console.log(`模块 "${moduleName}" 加载完成 (版本 ${module.version})`);
    console.log(`  当前状态:`, JSON.stringify(moduleState));
    
    return module;
  }

  // 模拟用户操作更新状态
  updateModuleState(moduleName, key, value) {
    const module = this.modules.get(moduleName);
    if (!module) {
      console.error(`模块 "${moduleName}" 未加载`);
      return;
    }

    // 更新持久化状态
    this.stateManager.updateState(moduleName, (state) => {
      state[key] = value;
      state.lastUpdated = new Date().toISOString();
      return state;
    });

    console.log(`模块 "${moduleName}" 状态已更新: ${key} = ${value}`);
  }

  // 模拟热加载（重新加载模块但保留状态）
  hotReload(moduleName, moduleFactory) {
    console.log(`\n>>> 执行热加载: "${moduleName}" <<<`);
    
    // 保存当前状态到文件（作为备份）
    this.stateManager.saveToFile(this.stateFilePath);
    
    // 重新加载模块（状态会自动从StateManager恢复）
    const reloadedModule = this.loadModule(moduleName, moduleFactory);
    
    console.log(`热加载完成! 状态已保留:`, JSON.stringify(reloadedModule.state));
    return reloadedModule;
  }

  // 模拟杀进程重启（冷启动）
  coldRestart(moduleName, moduleFactory) {
    console.log(`\n>>> 模拟杀进程重启: "${moduleName}" <<<`);
    
    // 从文件恢复状态
    this.stateManager.loadFromFile(this.stateFilePath);
    
    // 重新加载模块（状态从文件恢复）
    const module = this.loadModule(moduleName, moduleFactory);
    
    console.log(`冷启动完成! 状态已从文件恢复:`, JSON.stringify(module.state));
    return module;
  }

  // 显示所有模块信息
  showModules() {
    console.log('\n当前模块状态:');
    console.log('===============');
    this.modules.forEach((module, name) => {
      console.log(`模块: ${name} (版本 ${module.version})`);
      console.log(`状态:`, JSON.stringify(module.state, null, 2));
      console.log('---');
    });
  }
}

// ========== 演示代码 ==========
function runDemo() {
  console.log('=== 热加载状态保留系统演示 ===\n');

  // 初始化状态管理器
  const stateManager = new StateManager();
  const hotReloadSystem = new HotReloadSystem(stateManager);

  // 模拟用户会话
  console.log('1. 创建用户会话模块并更新状态');
  const userSession = hotReloadSystem.loadModule('userSession', () => {});
  
  // 模拟用户登录和操作
  hotReloadSystem.updateModuleState('userSession', 'userId', 'user_123');
  hotReloadSystem.updateModuleState('userSession', 'username', '小明');
  hotReloadSystem.updateModuleState('userSession', 'loginTime', new Date().toISOString());
  hotReloadSystem.updateModuleState('userSession', 'cart', ['商品A', '商品B']);

  // 模拟数据库连接池
  console.log('\n2. 创建数据库连接池模块');
  const dbPool = hotReloadSystem.loadModule('dbConnectionPool', () => {});
  hotReloadSystem.updateModuleState('dbConnectionPool', 'connections', 5);
  hotReloadSystem.updateModuleState('dbConnectionPool', 'status', 'connected');

  // 显示当前状态
  hotReloadSystem.showModules();

  // 模拟热加载（保留状态）
  console.log('\n3. 模拟热加载更新代码');
  hotReloadSystem.hotReload('userSession', () => {});
  
  // 验证状态保留
  console.log('\n4. 验证热加载后状态是否保留:');
  console.log('   userId:', stateManager.getState('userSession').userId);
  console.log('   cart:', stateManager.getState('userSession').cart);

  // 模拟杀进程重启
  console.log('\n5. 模拟杀进程重启（从文件恢复）');
  hotReloadSystem.coldRestart('userSession', () => {});

  // 最终验证
  console.log('\n6. 最终状态验证:');
  console.log('   用户ID:', stateManager.getState('userSession').userId);
  console.log('   用户名:', stateManager.getState('userSession').username);
  console.log('   购物车:', stateManager.getState('userSession').cartTogether);
  console.log('   数据库连接数:', stateManager.getState('dbConnectionPool').connections);

  // 清理
  console.log('\n7. 清理临时文件');
  try {
    fs.unlinkSync(path.join(__dirname, 'hot_reload_state.json'));
    console.log('   临时状态文件已删除');
  } catch (e) {
    // 文件可能不存在
  }

  console.log('\n=== 演示结束 ===');
  console.log('\n研究结论:');
  console.log('1. 热加载通过将状态存储在独立的状态管理器中，可以保留内存状态');
  console.log('2. 持久化到文件系统可以在杀进程后恢复状态');
  console.log('3. 关键设计: 状态与业务逻辑分离，模块只负责使用状态而不拥有状态');
  console.log('4. 实际生产环境可使用 Redis/Memcached 或数据库替代文件存储');
}

// 运行演示
runDemo();