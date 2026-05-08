// Research by 小红: 如何实现真正的热加载？代码变化时不杀进程，动态加载新模块
// Generated: 2026-05-12T10:03:00.543Z

// 热加载研究实验 - 演示如何在Node.js中实现真正的热加载
// 原理：使用文件监控 + 模块缓存清理 + 动态加载

const fs = require('fs');
const path = require('path');

// 模拟一个需要热加载的模块（实际项目中可能是配置文件或业务逻辑）
// 这里我们动态生成一个模块文件来演示
const MODULE_PATH = path.join(__dirname, 'hot-module.js');

// 创建初始模块内容
function createModuleContent(value) {
  return `
// 热加载模块 - 版本 ${value}
module.exports = {
  name: 'hot-module',
  version: ${value},
  timestamp: ${Date.now()},
  getMessage: function() {
    return '当前版本: ' + this.version + ', 时间戳: ' + this.timestamp;
  }
};
`;
}

// 初始化模块文件
fs.writeFileSync(MODULE_PATH, createModuleContent(1));

// 清理模块缓存的核心函数
function clearModuleCache(modulePath) {
  // 1. 删除require.cache中的缓存
  const resolvedPath = require.resolve(modulePath);
  if (require.cache[resolvedPath]) {
    console.log(`[热加载] 清理缓存: ${resolvedPath}`);
    delete require.cache[resolvedPath];
  }
  
  // 2. 清理父模块中的引用（可选，更彻底）
  for (const parentId in require.cache) {
    const parent = require.cache[parentId];
    if (parent && parent.children) {
      parent.children = parent.children.filter(child => {
        return child.filename !== resolvedPath;
      });
    }
  }
}

// 热加载模块函数
function hotRequire(modulePath) {
  clearModuleCache(modulePath);
  const freshModule = require(modulePath);
  console.log(`[热加载] 加载新模块: 版本=${freshModule.version}, 消息="${freshModule.getMessage()}"`);
  return freshModule;
}

// 监控文件变化并热加载
function watchAndHotReload(modulePath, callback) {
  console.log(`[热加载] 开始监控: ${modulePath}`);
  
  let lastChange = Date.now();
  
  fs.watch(modulePath, (eventType, filename) => {
    // 防止重复触发
    const now = Date.now();
    if (now - lastChange < 100) return;
    lastChange = now;
    
    console.log(`[热加载] 检测到变化: ${eventType} - ${filename}`);
    
    try {
      // 读取新内容（验证文件可读）
      const newContent = fs.readFileSync(modulePath, 'utf-8');
      
      // 执行热加载
      const freshModule = hotRequire(modulePath);
      
      // 回调通知
      if (callback) callback(null, freshModule);
      
    } catch (error) {
      console.error(`[热加载] 错误: ${error.message}`);
      if (callback) callback(error, null);
    }
  });
}

// 演示主函数
async function demo() {
  console.log('='.repeat(60));
  console.log('Node.js 热加载研究实验');
  console.log('='.repeat(60));
  
  // 第1步：初始加载
  console.log('\n[步骤1] 初始加载模块');
  let myModule = require(MODULE_PATH);
  console.log(`  初始消息: ${myModule.getMessage()}`);
  
  // 第2步：验证模块缓存
  console.log('\n[步骤2] 验证模块缓存（再次require不会重新加载）');
  const cachedModule = require(MODULE_PATH);
  console.log(`  缓存模块 === 原始模块: ${cachedModule === myModule}`);
  
  // 第3步：模拟模块变化并热加载
  console.log('\n[步骤3] 模拟模块内容变化');
  fs.writeFileSync(MODULE_PATH, createModuleContent(2));
  
  // 等待文件系统完成写入
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // 第4步：执行热加载
  console.log('\n[步骤4] 执行热加载');
  myModule = hotRequire(MODULE_PATH);
  console.log(`  热加载后消息: ${myModule.getMessage()}`);
  
  // 第5步：验证旧缓存已被清除
  console.log('\n[步骤5] 验证缓存清理');
  const afterHotLoad = require(MODULE_PATH);
  console.log(`  新模块 === 热加载模块: ${afterHotLoad === myModule}`);
  console.log(`  新模块消息: ${afterHotLoad.getMessage()}`);
  
  // 第6步：启动文件监控热加载
  console.log('\n[步骤6] 启动文件监控（持续热加载）');
  watchAndHotReload(MODULE_PATH, (err, module) => {
    if (!err) {
      console.log(`  [回调] 热加载完成！新版本: ${module.version}`);
    }
  });
  
  // 模拟多次变化
  console.log('\n[步骤7] 模拟多次文件变化...');
  for (let i = 3; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.writeFileSync(MODULE_PATH, createModuleContent(i));
    console.log(`  写入版本 ${i}`);
  }
  
  // 等待监控处理完成
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 第8步：研究总结
  console.log('\n' + '='.repeat(60));
  console.log('研究结果总结');
  console.log('='.repeat(60));
  console.log(`
  1. 热加载核心机制:
     - 清理 require.cache 中的模块缓存
     - 清理父模块的 children 引用
     - 重新 require() 加载新代码
  
  2. 关键发现:
     - 模块缓存是热加载的主要障碍
     - 仅删除缓存还不够，需处理子模块引用
     - 文件监控 (fs.watch) 可实现自动热加载
  
  3. 局限性:
     - 不能热加载原生模块 (C++ addons)
     - 模块中已创建的实例/状态不会自动更新
     - 循环引用模块需要特殊处理
  
  4. 生产环境建议:
     - 使用成熟方案如: nodemon, pm2, webpack HMR
     - 对于配置文件，可使用 JSON 或 YAML 格式
     - 对于业务逻辑，考虑进程重启或容器化部署
  `);
  
  // 清理
  console.log('[清理] 删除测试文件');
  fs.unlinkSync(MODULE_PATH);
  clearModuleCache(MODULE_PATH);
  
  console.log('\n实验完成！');
}

// 运行演示
demo().catch(console.errorapsed-1