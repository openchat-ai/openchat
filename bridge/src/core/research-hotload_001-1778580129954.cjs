// Research by 小明: 如何实现真正的热加载？代码变化时不杀进程，动态加载新模块
// Generated: 2026-05-12T10:02:09.954Z

// 真正的热加载实验 - Node.js 模块热替换实现
// 原理：利用 require.cache 清除缓存 + VM 模块重新编译

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 模拟一个需要热加载的模块
const TARGET_MODULE_PATH = path.join(__dirname, 'hot-module.js');

// 1. 先创建一个测试模块文件
function createTestModule(content) {
  fs.writeFileSync(TARGET_MODULE_PATH, content, 'utf-8');
}

// 初始化测试模块
createTestModule(`
  module.exports = {
    name: '原始版本',
    timestamp: Date.now(),
    greet() {
      console.log('你好，我是原始模块！');
    }
  };
`);

// 2. 实现真正的热加载函数
function hotRequire(modulePath) {
  // 步骤1：清除旧模块缓存
  const resolvedPath = require.resolve(modulePath);
  if (require.cache[resolvedPath]) {
    console.log(`[热加载] 清除缓存: ${resolvedPath}`);
    // 递归清除父模块引用（防止内存泄漏）
    delete require.cache[resolvedPath];
    
    // 清理子模块的父引用（可选，但更彻底）
    const children = require.cache[resolvedPath]?.children || [];
    children.forEach(child => {
      const idx = child.parent?.children.indexOf(child);
      if (idx !== -1) child.parent.children.splice(idx, 1);
    });
  }

  // 步骤2：强制重新加载
  console.log('[热加载] 重新加载模块...');
  const freshModule = require(modulePath);
  
  // 步骤3：验证模块是否真的更新
  console.log(`[热加载] 新模块内容:`, {
    name: freshModule.name,
    timestamp: freshModule.timestamp,
    hasGreet: typeof freshModule.greet === 'function'
  });

  return freshModule;
}

// 3. 高级热加载 - 使用 VM 沙箱实现完全隔离
function vmHotRequire(modulePath) {
  const code = fs.readFileSync(modulePath, 'utf-8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (id) => {
      // 对内部依赖也使用热加载（递归）
      if (id.startsWith('.')) {
        return vmHotRequire(path.resolve(path.dirname(modulePath), id));
      }
      return require(id); // 原生模块保持原样
    },
    console: console,
    __dirname: path.dirname(modulePath),
    __filename: modulePath
  };
  
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: modulePath });
  return sandbox.module.exports;
}

// 4. 实验主流程
console.log('='.repeat(50));
console.log('[研究] 开始热加载实验');
console.log('='.repeat(50));

// 第一次加载
console.log('\n[实验1] 初始加载模块:');
let hotModule = hotRequire(TARGET_MODULE_PATH);
console.log('  初始版本时间戳:', hotModule.timestamp languages);
hotModule.greet();

// 修改模块内容
console.log('\n[实验2] 修改模块文件 (模拟代码变更):');
setTimeout(() => {
  createTestModule(`
    module.exports = {
      name: '热更新版本',
      timestamp: Date.now(),
      greet() {
        console.log('🔥 我是热加载后的新模块！');
      }
    };
  `);
  console.log('  文件已更新，现在进行热加载...');
  
  // 执行热加载
  hotModule = hotRequire(TARGET_MODULE_PATH);
  console.log('  热更新版本时间戳:', hotModule.timestamp);
  hotModule.greet();
  
  // 验证进程是否存活
  console.log('\n[验证] 进程仍然存活，PID:', process.pid);
  
  // 高级实验：VM沙箱版本
  console.log('\n[实验3] VM沙箱热加载 (完全隔离):');
  const vmModule = vmHotRequire(TARGET_MODULE_PATH);
  console.log('  VM沙箱模块:', vmModule.name);
  vmModule.greet();
  
  // 再次修改并热加载
  console.log('\n[实验4] 第二次热更新:');
  createTestModule(`
    module.exports = {
      name: '第二次热更新',
      timestamp: Date.now(),
      greet() {
        console.log('⚡ 这是第二次热更新的效果！');
      },
      newMethod() {
        console.log('✨ 动态添加的方法也生效了！');
      }
    };
  `);
  
  hotModule = hotRequire(TARGET_MODULE_PATH);
  console.log('  第二次更新版本:', hotModule.name);
  hotModule.greet();
  if (hotModule.newMethod) hotModule.newMethod();
  
  // 总结
  console.log('\n' + '='.repeat(50));
  console.log('[结论] 热加载实现要点:');
  console.log('1. 清除 require.cache 是基础');
  console.log('2. 需要处理模块引用链防止内存泄漏');
  console.log('3. VM沙箱提供更彻底的隔离');
  console.log('4. 真实场景需配合文件监听 (fs.watch)');
  console.log('5. 注意: 全局状态和事件监听器需手动清理');
  console.log('='.repeat(50));
  
  // 清理测试文件
  fs.unlinkSync(TARGET_MODULE_PATH);
  console.log('\n[清理] 测试文件已删除');
  
}, 1000);

// 保持进程运行
console.log('\n[监听] 进程保持运行，等待热加载实验完成...');