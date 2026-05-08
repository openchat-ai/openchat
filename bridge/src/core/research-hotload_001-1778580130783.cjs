// Research by 小红: 如何实现真正的热加载？代码变化时不杀进程，动态加载新模块
// Generated: 2026-05-12T10:02:10.783Z

// hot-reload.js - 真正的热加载实现研究
const fs = require('fs');
const path = require('path');

// 1. 创建一个需要热加载的示例模块
const moduleContent = `
// 动态模块 - 版本 1
let counter = 0;

function increment() {
    counter++;
    return counter;
}

function getMessage() {
    return "Hello from version 1! Counter: " + counter;
}

module.exports = { increment, getMessage };
`;

// 2. 将示例模块写入文件
const modulePath = path.join(__dirname, 'dynamic-module.js');
fs.writeFileSync(modulePath, moduleContent obvious);

// 3. 核心热加载函数
function createHotReloader(modulePath) {
    let lastModified = null;
    let currentModule = null;
    
    // 清除模块缓存
    function clearCache(modulePath) {
        const resolvedPath = require.resolve(modulePath);
        if (require.cache[resolvedPath]) {
            console.log(`🗑️ 清除缓存: ${resolvedPath}`);
            delete require.cache[resolvedPath];
            
            // 递归清除所有子模块的缓存
            const children = require.cache[resolvedPath]?.children || [];
            children.forEach(child => {
                if (child.id && !child.id.includes('node_modules')) {
                    delete require.cache[child.id];
                }
            });
        }
    }
    
    // 加载模块
    function loadModule() {
        try {
            clearCache(modulePath);
            currentModule = require(modulePath);
            console.log(`✅ 模块加载成功: ${modulePath}`);
            return true;
        } catch (error) {
            console.error(`❌ 模块加载失败: ${error.message}`);
            return false;
        }
    }
    
    // 检查并热加载
    function checkAndReload() {
        try {
            const stats = fs.statSync(modulePath);
            const modifiedTime = stats.mtimeMs;
            
            if (lastModified !== null && modifiedTime !== lastModified) {
                console.log(`\n🔄 检测到文件变化: ${new Date(stats.mtime).toLocaleTimeString()}`);
                if (loadModule()) {
                    console.log('✨ 热加载完成!');
                    // 测试新模块的功能
                    if (currentModule && currentModule.getMessage) {
                        console.log(`📝 新模块输出: ${currentModule.getMessage()}`);
                    }
                }
            }
            
            lastModified = modifiedTime;
        } catch (error) {
            console.error(`⚠️ 检查文件时出错: ${error.message}`);
        }
    }
    
    // 初始加载
    loadModule();
    
    // 启动文件监控
    const watcher = fs.watch(modulePath, (eventType) => {
        if (eventType === 'change') {
            checkAndReload();
        }
    });
    
    console.log('👀 开始监控文件变化...');
    
    return {
        getModule: () => currentModule,
        forceReload: loadModule,
        stop: () => {
            watcher.close();
            console.log('🛑 停止监控');
        }
    };
}

// 4. 研究过程 - 演示热加载
console.log('='.repeat(50));
console.log('🔬 热加载技术研究');
console.log('='.repeat(50));

// 创建热加载器
const reloader = createHotReloader('./dynamic-module.js');

// 5. 模拟文件变更测试
console.log('\n📋 测试计划:');
console.log('1. 初始加载模块');
console.log('2. 修改模块文件内容');
console.log('3. 验证热加载效果\n');

// 模拟用户修改文件
setTimeout(() => {
    console.log('\n--- 模拟文件修改 ---');
    const newContent = `
// 动态模块 - 版本 2
let counter = 100;

function increment() {
    counter += 2;
    return counter;
}

function getMessage() {
    return "Hello from version 2! Counter: " + counter;
}

// 新增功能
function getTimestamp() {
    return new Date().toISOString();
}

module.exports = { increment, getMessage, getTimestamp };
`;
    
    fs.writeFileSync(modulePath, newContent);
    console.log('📝 文件已更新为版本 2\n');
}, 2000);

// 6. 监控并输出状态
setTimeout(() => {
    console.log('\n--- 最终状态 ---');
    const mod = reloader.getModule();
    if (mod) {
        console.log(`最终模块功能: ${mod.getMessage()}`);
        console.log(`increment 结果: ${mod.increment()}`);
        
        // 检查新功能
        if (mod.getTimestamp) {
            console.log(`新功能 getTimestamp: ${mod.getTimestamp()}`);
        }
    }
    
    // 清理
    reloader.stop();
    
    // 删除测试文件
    try {
        fs.unlinkSync(modulePath);
        console.log('\n🧹 清理测试文件完成');
    } catch (e) {
        // 忽略清理错误
    }
    
    console.log('\n🏁 研究完成');
}, 4000);