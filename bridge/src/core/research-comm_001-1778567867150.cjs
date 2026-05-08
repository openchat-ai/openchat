// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:37:47.150Z

const { fork, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. Fork IPC (子进程间通讯)
function demonstrateForkIPC() {
    console.log('1. Fork IPC 方式:');
    console.log('   - 适用于 Node.js 进程间通讯');
    console.log('   - 基于消息通道，双向异步');
    console.log('   - 可以发送对象、缓冲区等复杂数据\n');
}

// 2. Unix Domain Socket
function demonstrateUnixSocket() {
    console.log('2. Unix Domain Socket 方式:');
    console.log('   - 高性能本地进程通讯');
    console.log('   - 低延迟，无网络开销');
    console.log('   - 适用于同一主机的进程间通讯\n');
}

// 3. 文件锁检测
function demonstrateFileLock() {
    console.log('3. 文件锁 (File Lock) 方式:');
    console.log('   - 进程通过创建/删除文件来表示状态');
    console.log('   - 简单但需要注意原子性');
    console.log('   - 适合简单状态共享\n');
}

// 4. 信号量
function demonstrateSignals() {
    console.log('4. 进程信号 (Signal) 方式:');
    console.log('   - 使用 kill() 发送信号给其他进程');
    console.log('   - SIGUSR1/SIGUSR2 常用于自定义通讯');
    console.log('   - 适用于简单控制消息\n');
}

// 5. 消息队列
function demonstrateMessageQueue() {
    console.log('5. 消息队列方式:');
    console.log('   - 可以使用 Redis、RabbitMQ 等');
    console.log('   - 支持持久化和广播');
    console.log('   - 适合分布式系统\n');
}

// 实际演示：创建状态文件并检测
function demonstrateFileBasedStatus() {
    const statusFile = path.join(os.tmpdir(), 'process-status.json');
    
    // 模拟当前进程写入状态
    const status = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        status: 'active',
        hostname: os.hostname()
    };
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.log('=== 文件状态检测演示 ===');
    console.log('当前进程写入状态文件:', statusFile);
    
    // 读取并解析状态
    try {
        const content = fs.readFileSync(statusFile, 'utf8');
        const parsedStatus = JSON.parse(content);
        console.log('检测到的姐妹状态:', parsedStatus);
        console.log('状态有效，进程正在运行中\n');
    } catch (err) {
        console.log('无法读取状态文件\n');
    }
}

// 演示 Unix Socket IPC
function demonstrateUnixSocketIPC() {
    console.log('=== Unix Socket IPC 演示 ===');
    const socketPath = path.join(os.tmpdir(), 'ipc-socket');
    
    // 服务端
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            const message = data.toString().trim();
            if (message === 'ping') {
                socket.write(JSON.stringify({ 
                    type: 'status',
                    pid: process.pid,
                    status: 'alive',
                    timestamp: Date.now()
                }));
            }
        });
    });
    
    server.listen(socketPath, () => {
        console.log('Unix Socket 服务端启动，监听:', socketPath);
        
        // 客户端连接检测
        const client = net.connect(socketPath);
        client.on('connect', () => {
            client.write('ping\n');
        });
        
        client.on('data', (data) => {
            const response = JSON.parse(data.toString());
            console.log('从服务端接收到的状态:', response);
            console.log('姐妹进程状态：' + (response.status === 'alive' ? '在线' : '离线') + '\n');
            
            // 清理
            server.close();
            fs.unlinkSync(socketPath);
        });
    });
}

// 主演示函数
function main() {
    demonstrateForkIPC();
    demonstrateUnixSocket();
    demonstrateFileLock();
    demonstrateSignals();
    demonstrateMessageQueue();
    
    demonstrateFileBasedStatus();
    demonstrateUnixSocketIPC();
    
    console.log('=== 总结 ===');
    console.log('除了HTTP ping，常用的实例间通讯方式：');
    console.log('✓ Fork IPC - Node.js 进程间直接通讯');
    console.log('✓ Unix Socket - 高性能本地IPC');
    console.log('✓ 文件锁/状态文件 - 简单状态共享');
    console.log('✓ 进程信号 - 轻量级控制');
    console.log('✓ Redis/消息队列 - 分布式系统通讯');
    console.log('✓ 共享内存 - 超高性能（需小心同步）');
}

main();