// Research by 管家: 如何实现真正的热加载？代码变化时不杀进程，动态加载新模块
// Generated: 2026-05-12T10:02:18.335Z

// hot-reload.js - 真正的热加载模块系统
const fs = require('fs');
const path = require('path');
const Module = require('module');

class HotReloader {
  constructor() {
    this.watchers = new Map();
    this.modules = new Map();
    this.loadedCount = 0;
    this.reloadCount = 0;
  }

  // 清除模块缓存
  cleanCache(modulePath) {
    const resolvedPath = require.resolve(modulePath);
    
    // 递归清除父模块缓存
    const parent = Module._cache[resolvedPath]?.parent;
    if (parent) {
      const idx = parent.children.indexOf(Module._cache[resolvedPath]);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
    }
    
    // 清除缓存
    delete require.cache[resolvedPath];
    console.log(`  [缓存已清理] ${path.basename(modulePath)}`);
  }

  // 热加载模块
  hotRequire(modulePath) {
    const absolutePath = path.resolve(modulePath);
    
    // 首次加载
    if (!this.modules.has(absolutePath)) {
      const mod = require(absolutePath);
      this.modules.set(absolutePath, mod);
      this.loadedCount++;
      console.log(`  [首次加载] ${path.basename(modulePath)}`);
      return mod;
    }
    
    // 重新加载
    this.cleanCache(modulePath);
    try {
      const mod = require(absolutePath);
      this.modules.set(absolutePath, mod);
      this.reloadCount++;
      console.log(`  [热重载] ${path.basename(modulePath)}`);
      return mod;
    } catch (err) {
      console.error(`  [加载失败] ${modulePath}:`, err.message);
      return this.modules.get(absolutePath); // 返回旧模块
    }
  }

  // 监听文件变化
  watch(modulePath) {
    const absolutePath = path.resolve(modulePath);
    
    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      console.error(`[错误] 文件不存在: ${modulePath}`);
      return;
    }

    // 首次加载
    this.hotRequire(modulePathsof);

    // 设置文件监听
    const watcher = fs.watch(absolutePath, (eventType, filename) => {
      if (eventType === 'change') {
        console.log(`\n[检测到变化] ${filename}`);
        const newModule = this.hotRequire(modulePath);
        
        // 如果模块有 onHotReload 回调，调用它
        if (newModule && typeof newModule.onHotReload === 'function') {
          newModule.onHotReload();
        }
      }
    });

    this.watchers.set(absolutePath, watcher);
    console.log(`[监听中] ${path.basename(modulePath)}`);
  }

  // 停止所有监听
  stop() {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      console.log(`[停止监听] ${path.basename(path)}`);
    }
    this.watchers.clear();
    console.log('\n[统计]');
    console.log(`  首次加载: ${this.loadedCount} 次`);
    console.log(`  热重载: ${this.reloadCount} 次`);
  }
}

// 创建一个测试模块
function createTestModule() {
  const testContent = `
// test-module.js - 测试热加载
let counter = 0;

function increment() {
  counter++;
  console.log('  [模块] 当前计数:', counter);
}

// 热重载时的回调
function onHotReload() {
  console.log('  [模块] 已热重载，保留状态:', counter);
}

module.exports = { increment, counter, onHotReload };
`;

  fs.writeFileSync('./test-module.js', testContent);
  console.log('[创建] test-module.js');
}

// 模拟外部修改文件
function simulateEdit(interval = 2000) {
  let editCount = 0;
  const timer = setInterval(() => {
    editCount++;
    const content = `
// test-module.js - 热加载测试 v${editCount}
let counter = ${editCount * 10};

function increment() {
  counter++;
  console.log('  [模块 v${editCount}] 当前计数:', counter);
}

function onHotReload() {
  console.log('  [模块 v${editCount}] 已热重载');
  // 打印新版本号
  console.log('  [版本] v${editCount}');
}

module.exports = { increment, counter, onHotReload };
`;
    
    fs.writeFileSync('./test-module.js', content);
    console.log(`\n[编辑] 更新为 v${editCount}`);
    
    if (editCount >= 3) {
      clearInterval(timer);
      console.log('\n[演示结束]');
    }
  }, interval);
  
  return timer;
}

// 主程序
async function main() {
  console.log('='.repeat(50));
  console.log('  真正的热加载系统演示');
  console.log('='.repeat(50));
  console.log('\n[研究结论]');
  console.log('1. 通过清理 require.cache 实现模块重载');
  console.log('2. 使用 fs.watch 监听文件变化');
  console.log('3. 保留模块状态（如计数器）需要在模块内自行管理');
  console.log('4. 支持 onHotReload 回调进行热重载后处理');
  console.log('-'.repeat(50));

  // 创建测试模块
  createTestModule();

  // 创建热加载器
  const reloader = new HotReloader();

  // 监听测试模块
  console.log('\n[启动] 开始监听 test-module.js');
  reloader.watch('./test-module.js');

  // 使用模块
  console.log('\n[使用] 调用模块方法');
  const mod = require('./test-module.js');
  mod.increment();
  mod.increment();

  // 模拟外部编辑
  console.log('\n[模拟] 开始模拟文件编辑（每2秒一次）');
  const editTimer = simulateEdit(2000);

  // 5秒后停止
  setTimeout(() => {
    clearInterval(editTimer);
    reloader.stop();
    
    // 清理测试文件
    try {
      fs.unlinkSync('./test-module.js');
      console.log('[清理] 删除测试文件');
    } catch (e) {}
    
    console.log('\n[完成] 热加载研究结束');
  }, 8000);
}

// 运行
main().catch(console.errorphins);