// Research by 小红: 如何检测代码变化并自动热加载？别人改了代码我应该知道
// Generated: 2026-05-12T10:03:08.399Z

// 代码变化检测与热加载研究
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 研究目标：检测文件变化并热加载
console.log('=== 代码热加载研究 ===');
console.log('研究时间:', new Date().toISOString());
console.log('研究目标：检测文件变化并自动重新加载\n');

// 1. 研究不同的文件监控方法
console.log('方法一：使用 fs.watch 监控文件变化');
console.log('优点：跨平台、性能较好');
console.log('缺点：某些平台事件可能重复触发\n');

console.log('方法二：使用 fs.watchFile 轮询检查');
console.log('优点：更精确的状态变更信息');
console.log('缺点：性能开销较大\n');

// 2. 实现一个简单的热加载系统
class HotReloader {
    constructor(watchDir = __dirname) {
        this.watchDir = watchDir;
        this.watchedFiles = new Map();
        this.handlers = new Map();
        this.isWatching = false;
        
        console.log(`初始化热加载器，监控目录: ${watchDir}`);
    }

    // 注册需要监控的文件
    watchFile(filePath, callback) {
        const absolutePath = path.resolve(filePath);
        console.log(`注册监控文件: ${absolutePath}`);
        
        this.watchedFiles.set(absolutePath, {
            mtime: null,
            content: null
        });
        this.handlers.set(absolutePath, callback);
    }

    // 开始监控
    start() {
        console.log('\n开始监控文件变化...');
        console.log('提示：修改文件后，系统会自动检测并尝试热加载\n');
        
        this.isWatching = true;
        
        // 使用 fs.watch 进行实时监控
        const watcher = fs.watch(this.watchDir, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            
            const absolutePath = path.resolve(this.watchDir, filename);
            
            // 只监控 .js 文件
            if (path.extname(filename) !== '.js') return;
            
            console.log(`检测到文件变化: ${filename}`);
            console.log(`变化类型: ${eventType}`);
            
            // 延迟执行以避免重复触发
            if (this.changeTimer) clearTimeout(this.changeTimer);
            this.changeTimer = setTimeout(() => {
                this.handleFileChange(absolutePath, filename);
            }, 100);
        });

        watcher.on('error', (error) => {
            console.error('监控错误:', error.message);
        });

        // 保存 watcher 以便后续清理
        this.watcher = watcher;
        
        // 同时使用 watchFile 作为备份（演示两种方法）
        this.startWatchFileBackup();
    }

    // 使用 watchFile 作为备份监控
    startWatchFileBackup() {
        console.log('\n[备份监控] 启动轮询监控...');
        
        this.watchFileInterval = setInterval(() => {
            for (const [filePath, info] of this.watchedFiles) {
                try {
                    const stats = fs.statSync(filePath);
                    const currentMtime = stats.mtimeMs;
                    
                    if (info.mtime && currentMtime !== info.mtime) {
                        console.log(`[备份监控] 检测到 ${path.basename(filePath)} 变化`);
                        this.handleFileChange(filePath, path.basename(filePath));
                    }
                    
                    info.mtime = currentMtime;
                } catch (error) {
                    // 文件可能被删除
                    console.error(`监控文件 ${filePath} 出错:`, error.message);
                }
            }
        }, 2000); // 每2秒检查一次
    }

    // 处理文件变化
    handleFileChange(absolutePath, filename) {
        console.log(`\n处理文件变化: ${filename}`);
        
        try {
            // 读取新内容
            const content = fs.readFileSync(absolutePath, 'utf-8');
            
            // 清除缓存，实现热加载
            this.clearCache(absolutePath);
            
            // 调用注册的回调
            const handler = this.handlers.get(absolutePath);
            if (handler) {
                console.log(`执行热加载回调...`);
                handler(content, absolutePath);
            }
            
            // 更新存储的内容
            const info = this.watchedFiles.get(absolutePath);
            if (info) {
                info.content = content;
                info.mtime = fs.statSync(absolutePath).mtimeMs;
            }
            
            console.log(`热加载完成: ${filename}\n`);
            
        } catch (error) {
            console.error(`处理文件 ${filename} 时出错:`, error.message);
        }
    }

    // 清除模块缓存
    clearCache(absolutePath) {
        // 清除 Node.js 的模块缓存
        const resolvedPath = require.resolve(absolutePath);
        if (require.cache[resolvedPath]) {
            console.log(`清除缓存: ${absolutePath}`);
            delete require.cache[resolvedPath];
        }
        
        // 递归清除子模块缓存
        for (const key in require.cache) {
            if (key.startsWith(path.dirname(absolutePath))) {
                delete require.cache[key];
            }
        }
    }

    // 停止监控
    stop() {
        console.log('\n停止监控...');
        
        if (this.watcher) {
            this.watcher.close();
        }
        
        if (this.watchFileInterval) {
            clearInterval(this.watchFileInterval);
        }
        
        this.isWatching = false;
        console.log('监控已停止');
    }
}

// 3. 创建演示用的测试文件
function createTestFiles() {
    const testFilePath = path.join(__dirname, 'test-module.js');
    
    // 创建初始测试模块
    const initialContent = `
// 测试模块 - 版本 1
console.log('测试模块已加载，版本: 1');
module.exports = {
    name: '测试模块',
    version: 1,
    getMessage: () => '这是版本 1 的消息'
};
`;
    
    fs.writeFileSync(testFilePath, initialContent);
    console.log('创建测试文件:', testFilePath);
    
    return testFilePath;
}

// 4. 运行研究
console.log('=== 开始研究 ===\n');

// 创建测试文件
const testFile = createTestFiles();

// 初始化热加载器
const reloader = new HotReloader(__dirname);

// 注册监控并设置回调
reloader.watchFile(testFile, (content, filePath) => {
    console.log(`\n[热加载回调] 文件已更新，新内容长度: ${content.length} 字符`);
    
    try {
        // 尝试重新加载模块
        const module = require(filePath);
        console.log('[热加载回调] 模块重新加载成功');
        console.log('[热加载回调] 模块名称:', module.name);
        console.log('[热加载回调] 模块版本:', module.version);
        console.log('[热加载回调] 模块消息:', module.getMessage());
    } catch (error) {
        console.error('[热加载回调] 模块加载失败:', error.message);
    }
});

// 启动监控
reloader.start();

// 5. 模拟文件变化（演示用）
console.log('\n=== 模拟文件变化 ===');
console.log('提示：在实际使用中，您可以直接修改 test-module.js 文件');
console.log('这里我们模拟 3 秒后自动修改文件内容\n');

setTimeout(() => {
    console.log('模拟文件变化...');
    
    const updatedContent = `
// 测试模块 - 版本 2 (热加载后)
console.log('测试模块已加载，版本: 2');
module.exports = {
    name: '测试模块',
    version: 2,
    getMessage: () => '这是版本 2 的消息 - 热加载成功!'
};
`;
    
    fs.writeFileSync(testFile, updatedContent);
    console.log('文件已更新为版本 2\n');
    
}, 3000);

// 6. 10秒后停止并清理
setTimeout(() => {
    console.log('\n=== 研究总结 ===');
    console.log('1. fs.watch 提供实时文件变化检测');
    console.log('2. 通过清除 require.cache 实现模块热加载');
    console.log('3. 需要处理重复事件和缓存问题');
    console.log('4. 实际项目中建议使用成熟的库如 nodemon 或 chokidar');
    
    // 清理
    reloader.stop();
    
    // 删除测试文件
    try {
        fs.unlinkSync(testFile);
        console.log('清理测试文件');
    } catch (e) {
        // 忽略清理错误
    }
    
    console.log('\n研究完成！');
    process.exit(0);
}, 10000ende.exports