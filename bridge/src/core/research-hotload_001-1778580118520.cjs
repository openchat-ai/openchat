// Research by 小红: 如何实现真正的热加载？代码变化时不杀进程，动态加载新模块
// Generated: 2026-05-12T10:01:58.520Z

// hot-reload.js
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

/**
 * 热加载管理器
 * 实现真正的模块热替换，不杀死进程
 */
class HotReloader {
  constructor() {
    this.modules = new Map();
    this.watchers = new Map();
    this.hooks = new Map();
  }

  /**
   * 注册热加载模块
   * @param {string} modulePath - 模块路径
   * @param {Function} onReload - 重载回调
   */
  register(modulePath, onReload) {
    const absolutePath = path.resolve(modulePath);
    this.hooks.set(absolutePath, onReload);
    
    // 初始化加载模块
    this.loadModule(absolutePath);
    
    // 设置文件监控
    this.watchModule(absolutePath);
  }

  /**
   * 加载模块（带缓存清理）
   */
  loadModule(absolutePath) {
    // 清理模块缓存
    this.cleanCache(absolutePath);
    
    try {
      // 动态加载新模块
      const module = require(absolutePath);
      this.modules.set(absolutePath, module);
      
      console.log(`[热加载] 已加载模块: ${path.basename(absolutePath)}`);
      return module;
    } catch (error) {
      console.error(`[热加载] 加载失败: ${absolutePath}`, error.message);
      return null;
    }
  }

  /**
   * 清理模块缓存（核心机制）
   */
  cleanCache(modulePath) {
    const absolutePath = path.resolve(modulePath);
    
    // 递归清理所有相关缓存
    const cacheKeys = Object.keys(require.cache);
    cacheKeys.forEach(key => {
      if (key.startsWith(absolutePath) || 
          require.cache[key]?.filename === absolutePath) {
        console.log(`[热加载] 清理缓存: ${path.basename(key)}`);
        delete require.cache[key];
      }
    });
  }

  /**
   * 监控文件变化
   */
  watchModule(absolutePath) {
    if (this.watchers.has(absolutePath)) {
      return; // 已有监控
    }

    const watcher = chokidar.watch(absolutePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    watcher.on('change', (filePath) => {
      console.log(`\n[热加载] 检测到文件变化: ${path.basename(filePath)}`);
      
      // 执行热加载
      const newModule = this.loadModule(absolutePath);
      
      // 触发回调
      const hook = this.hooks.get(absolutePath);
      if (hook && newModule) {
        hook(newModule, this.modules.get(absolutePath));
      }
    });

    watcher.on('error', (error) => {
      console.error(`[热加载] 监控错误:`, error);
    });

    this.watchers.set(absolutePath, watcher);
    console.log(`[热加载] 开始监控: ${path.basename(absolutePath)}`);
  }

  /**
   * 停止所有监控
   */
  stop() {
    this.watchers.forEach((watcher, path) => {
      watcher.close();
      console.log(`[热加载] 停止监控: ${path.basename(path)}`);
    });
    this.watchers.clear();
    this.modules.clear();
    this.hooks.clear();
  }
}

// ============ 示例模块 ============

// 创建一个动态模块文件
const demoModulePath = path.join(__dirname, 'demo-module.js');
fs.writeFileSync(demoModulePath, `
// 动态模块示例
module.exports = {
  getMessage: () => 'Hello from version 1',
  timestamp: Date.now()
};
console.log('[Demo模块] 已加载，版本1');
`);

// 等待文件写入完成
setTimeout(() => {
  // 使用示例
  const reloader = new HotReloader();
  
  // 注册热加载模块
  reloader.register(demoModulePath, (newModule, oldModule) => {
    console.log('[热加载回调] 模块已更新！');
    console.log('  新模块消息:', newModule.getMessage());
    console.log('  旧模块时间戳:', oldModule?.timestamp);
    console.log('  新模块时间戳:', newModule.timestamp);
  });

  // 首次加载测试
  const initialModule = require(demoModulePath);
  console.log('\n[初始测试]');
  console.log('  消息:', initialModule.getMessage());
  console.log('  时间戳:', initialModule.timestamp);

  // 模拟文件更新（3秒后）
  setTimeout(() => {
    console.log('\n[模拟更新] 正在修改文件...');
    fs.writeFileSync(demoModulePath, `
// 动态模块示例 - 版本2
module.exports = {
  getMessage: () => 'Hello from version 2 - Updated!',
  timestamp: Date.now(),
  newFeature: 'This is a new feature'
};
console.log('[Demo模块] 已热加载，版本2');
`);
    console.log('  文件已修改，等待热加载...');
  }, 3000);

  // 再模拟一次更新（6秒后）
  setTimeout(() => {
    console.log('\n[模拟更新2] 再次修改文件...');
    fs.writeFileSync(demoModulePath, `
// 动态模块示例 - 版本3
module.exports = {
  getMessage: () => 'Hello from version 3 - Final version!',
  timestamp: Date.now(),
  newFeature: 'Multiple updates work!',
  version: 3
};
console.log('[Demo模块] 已热加载，版本3');
`);
    console.log('  文件已修改，等待热加载...');
  }, 6000);

  // 10秒后清理
  setTimeout(() => {
    console.log('\n[清理] 停止所有监控...');
    reloader.stop();
    
    // 清理测试文件
    fs.unlinkSync(demoModulePath);
    console.log('[清理] 测试文件已删除');
    
    // 输出研究结论
    console.log('\n========== 研究结论 ==========');
    console.log('1. 热加载核心机制：清理 require.cache');
    console.log('2. 使用文件监控检测代码变化');
    console.log('3. 关键步骤：删除缓存 -> 重新 require');
    console.log('4. 注意事项：');
    console.log('   - 需要清理所有相关模块的缓存');
    console.log('   - 使用 chokidar 替代 fs.watch（更稳定）');
    console.log('   - 回调函数允许优雅地更新引用');
    console.log('5. 局限性：');
    console.log('   - 无法热加载原生模块');
    console.log('   - 全局状态（如全局变量）不会自动重置');
    console.log('   - 需要模块自身支持热替换模式');
    console.log('==============================');
  }, 10000);

}, 100); // 给文件写入一点缓冲时间