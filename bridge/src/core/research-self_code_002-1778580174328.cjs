// Research by 小刚: 如何检测代码变化并自动热加载？别人改了代码我应该知道
// Generated: 2026-05-12T10:02:54.328Z

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 研究：代码热加载和变化检测方案
console.log('=== 代码热加载与变化检测研究 ===\n');

// 核心研究：文件变化检测
class FileWatcher {
    constructor() {
        this.watchedFiles = new Map();
        this.lastLoadTimes = new Map();
        this.changeLog = [];
    }

    // 方法1: 使用 fs.watchFile（轮询方式）
    watchWithPolling(filePath) {
        const absolutePath = path.resolve(filePath);
        console.log(`[轮询监控] 开始监控: ${absolutePath}`);
        
        fs.watchFile(absolutePath, { interval: 1000 }, (curr, prev) => {
            if (curr.mtimeMs !== prev.mtimeMs) {
                this.handleChange(absolutePath, '轮询检测');
            }
        });
    }

    // 方法2: 使用 fs.watch（事件驱动）
    watchWithEvent(filePath) {
        const absolutePath = path.resolve(filePath);
        const dir = path.dirname(absolutePath);
        const filename = path.basename(absolutePath);
        
        console.log(`[事件监控] 开始监控: ${absolutePath}`);
        
        try {
            const watcher = fs.watch(dir, (eventType, changedFile) => {
                if (changedFile === filename) {
                    this.handleChange(absolutePath, `事件: ${eventType}`);
                }
            });
            
            this.watchedFiles.set(absolutePath, watcher);
        } catch (err) {
            console.error(`监控失败: ${err.message}`);
        }
    }

    // 处理方法变化
    handleChange(filePath, detectionMethod) {
        const now = new Date();
        const lastLoad = this.lastLoadTimes.get(filePath) || 0;
        const timeSinceLastChange = now.getTime() - lastLoad;

        // 防抖：1秒内只处理一次变化
        if (timeSinceLastChange < 1000) {
            console.log(`  [防抖] 忽略频繁变化: ${filePath}`);
            return;
        }

        this.lastLoadTimes.set(filePath, now.getTime());
        
        const logEntry = {
            file: filePath,
            time: now.toISOString(),
            method: detectionMethod
        };
        
        this.changeLog.push(logEntry);
        console.log(`\n🔔 检测到代码变化！`);
        console.log(`   文件: ${filePath}`);
        console.log(`   时间: ${logEntry.time}`);
        console.log(`   检测方式: ${detectionMethod}`);

        // 尝试热加载
        this.hotReload(filePath);
    }

    // 热加载尝试
    hotReload(filePath) {
        console.log(`  [热加载] 尝试重新加载: ${path.basename(filePath)}`);
        
        try {
            // 清除模块缓存
            const modulePath = require.resolve(filePath);
            if (require.cache[modulePath]) {
                console.log(`  [热加载] 清除缓存: ${modulePath}`);
                delete require.cache[modulePath];
                
                // 重新加载模块
                const module = require(filePath);
                console.log(`  ✅ [热加载] 成功重新加载模块`);
                
                // 如果模块有初始化函数，调用它
                if (typeof module.init === 'function') {
                    module.init();
                }
            }
        } catch (err) {
            console.log(`  ⚠️ [热加载] 失败: ${err.message}`);
            console.log(`  [热加载] 模块可能不是 CommonJS 格式，跳过缓存清除`);
        }
    }

    // 停止所有监控
    stopAll() {
        console.log('\n[清理] 停止所有文件监控...');
        
        // 停止事件监控
        for (const [filePath, watcher] of this.watchedFiles) {
            watcher.close();
            console.log(`  停止监控: ${filePath}`);
        }
        
        // 停止轮询监控
        for (const [filePath] of this.lastLoadTimes) {
            try {
                fs.unwatchFile(filePath);
            } catch (e) {
                // 忽略错误
            }
        }
        
        console.log('[清理] 所有监控已停止');
    }

    // 生成报告
    generateReport() {
        console.log('\n=== 变化检测报告 ===');
        console.log(`总检测次数: ${this.changeLog.length}`);
        
        if (this.changeLog.length > 0) {
            console.log('\n变化历史:');
            this.changeLog.forEach((entry, index) => {
                console.log(`  ${index + 1}. ${entry.file}`);
                console.log(`     时间: ${entry.time}`);
                console.log(`     检测方式: ${entry.method}`);
            });
        }
    }
}

// 研究：创建测试模块
function createTestModule() {
    const testModulePath = path.join(__dirname, 'test-module.js');
    
    const moduleContent = `
// 测试模块 - 用于演示热加载
let counter = 0;

function init() {
    console.log('[测试模块] 初始化完成');
    counter++;
}

function getCounter() {
    return counter;
}

// 导出
module.exports = {
    init,
    getCounter,
    name: '测试模块 v' + counter
};
`;
    
    fs.writeFileSync(testModulePath, moduleContent);
    console.log(`[测试] 创建测试模块: ${testModulePath}`);
    return testModulePath;
}

// 研究：模拟代码变化
function simulateCodeChange(filePath) {
    setTimeout(() => {
        console.log('\n[模拟] 模拟代码变化...');
        const content = fs.readFileSync(filePath, 'utf8');
        const newContent = content.replace(
            /name: '测试模块 v\d+'/,
            `name: '测试模块 v' + Math.random()`
        );
        fs.writeFileSync(filePath, newContent);
        console.log('[模拟] 文件已修改');
    }, 2000);
}

// 主研究流程
async function main() {
    console.log('研究目标：检测代码变化并自动热加载\n');
    
    // 1. 创建测试环境
    const testFile = createTestModule();
    
    // 2. 初始化监控器
    const watcher = new FileWatcher();
    
    // 3. 测试两种监控方式
    console.log('\n--- 测试轮询监控 ---');
    watcher.watchWithPolling(testFile);
    
    console.log('\n--- 测试事件监控 ---');
    watcher.watchWithEvent(testFile);
    
    // 4. 首次加载模块
    console.log('\n--- 首次加载模块 ---');
    const firstLoad = require(testFile);
    console.log(`模块名称: ${firstLoad.name}`);
    
    // 5. 模拟代码变化
    simulateCodeChange(testFile);
    
    // 6. 等待并收集结果
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 7. 生成报告
    watcher.generateReport();
    
    // 8. 清理
    watcher.stopAll();
    
    // 9. 删除测试文件
    try {
        fs.unlinkSync(testFile);
        console.log('\n[清理] 删除测试文件');
    } catch (e) {
        // 忽略
    }
    
    console.log('\n=== 研究结论 ===');
    console.log('1. fs.watch 比 fs.watchFile 更高效（事件驱动 vs 轮询）');
    console.log('2. 热加载需要清除 require.cache');
    console.log('3. 防抖机制防止频繁变化导致多次加载');
    console.log('4. 实际生产环境建议使用 chokidar 等成熟库');
}

// 运行研究
main().catch(console.error文案);