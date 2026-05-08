// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:49:19.133Z

const { spawn } = require('child_process');
const { MessagePort, MessageChannel } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const net = require('net');

console.log('=== 实例间通讯方式研究 ===\n');

// 方法1: MessagePort (Node.js 跨进程通信)
function demonstrateMessagePort() {
    console.log('1. MessagePort 方式 (Node.js 内置):');
    
    const { port1, port2 } = new MessageChannel();
    
    port1.on('message', (message) => {
        console.log('   收到主进程消息:', message);
    });
    
    port2.on('message', (message) => {
        console.log('   收到工作进程消息:', message);
    });
    
    // 模拟状态检测
    port1.postMessage({ type: 'heartbeat', status: 'active', timestamp: Date.now() });
    port2.postMessage({ type: 'heartbeat', status: 'idle', timestamp: Date.now() });
    
    setTimeout(() => {
        port1.close();
        port2.close();
    }, 100);
}

// 方法2: TCP Socket 通信
function demonstrateTCPSocket() {
    console.log('\n2. TCP Socket 方式:');
    
    const stateFile = path.join(__dirname, 'worker-state.txt');
    
    // 模拟状态文件写入
    fs.writeFileSync(stateFile, JSON.stringify({
        pid: process.pid,
        status: 'running',
        timestamp: Date.now()
    }));
    
    // 状态检测函数
    function checkWorkerState() {
        try {
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                console.log('   检测到工作状态:', state.status, '| 时间:', new Date(state.timestamp).toLocaleTimeString());
                return state;
            }
        } catch (e) {
            console.log('   状态文件读取失败');
        }
    }
    
    checkWorkerState();
    
    // 清理
    setTimeout(() => {
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }
    }, 200);
}

// 方法3: Unix Domain Socket (或TCP)
function demonstrateUnixSocket() {
    console.log('\n3. Unix Domain Socket 方式:');
    
    const socketPath = path.join(__dirname, 'instance.sock');
    
    // 创建服务器端
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            const message = JSON.parse(data.toString());
            console.log('   收到实例状态:', message.status, '| PID:', message.pid);
        });
    });
    
    server.listen(socketPath, () => {
        console.log('   Socket 服务器启动，等待实例连接...');
        
        // 模拟向另一个实例发送状态
        const client = net.connect(socketPath, () => {
            client.write(JSON.stringify({
                status: 'active',
                pid: process.pid,
                uptime: process.uptime()
            }));
            client.end();
        });
        
        setTimeout(() => {
            server.close();
            if (fs.existsSync(socketPath)) {
                fs.unlinkSync(socketPath);
            }
        }, 300);
    });
}

// 方法4: 信号量通信 (Unix/Linux/macOS)
function demonstrateSignals() {
    console.log('\n4. 进程信号方式:');
    
    // 模拟子进程
    const child = spawn('node', ['-e', `
        process.on('SIGUSR2', () => {
            console.log('   子进程收到自定义信号，状态: 正在运行');
            process.exit(0);
        });
    `]);
    
    // 主进程发送信号
    setTimeout(() => {
        console.log('   主进程向子进程发送 SIGUSR2 信号...');
        process.kill(child.pid, 'SIGUSR2');
    }, 100);
    
    child.on('exit', (code) => {
        console.log('   子进程退出代码:', code);
    });
}

// 方法5: 共享内存模拟 (文件锁)
function demonstrateFileLock() {
    console.log('\n5. 文件锁方式 (共享状态):');
    
    const lockFile = path.join(__dirname, 'instance.lock');
    
    try {
        fs.writeFileSync(lockFile, String(process.pid));
        console.log('   实例已上锁，PID:', process.pid);
        
        // 检查锁文件
        if (fs.existsSync(lockFile)) {
            const pid = fs.readFileSync(lockFile, 'utf8');
            console.log('   当前锁定实例 PID:', pid);
        }
    } catch (e) {
        console.log('   获取锁失败:', e.message);
    } finally {
        // 清理
        setTimeout(() => {
            if (fs.existsSync(lockFile)) {
                fs.unlinkSync(lockFile);
                console.log('   锁已释放');
            }
        }, 150);
    }
}

// 运行所有演示
async function runDemos() {
    demonstrateMessagePort();
    demonstrateTCPSocket();
    demonstrateUnixSocket();
    demonstrateSignals();
    demonstrateFileLock();
    
    // 总结
    setTimeout(() => {
        console.log('\n=== 总结: 实例间通讯方式 ===');
        console.log('1. MessagePort: 高性能跨进程消息通道');
        console.log('2. 文件通信: 简单可靠的状态共享');
        console.log('3. Socket: 灵活的网络通信');
        console.log('4. 进程信号: 轻量级状态通知');
        console.log('5. 文件锁: 分布式锁机制');
    }, 500);
}

runDemos();