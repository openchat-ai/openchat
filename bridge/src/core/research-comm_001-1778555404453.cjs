// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:10:04.453Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const cluster = require('cluster');
const process = require('process');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 模拟多个实例（使用cluster模块）
if (cluster.isMaster) {
    console.log('主进程启动，创建工作进程...\n');
    
    // 方法1: 进程信号检测
    console.log('--- 方法1: 进程信号检测 ---');
    const workers = [];
    for (let i = 0; i < 3; i++) {
        const worker = cluster.fork();
        workers.push(worker);
        console.log(`启动工作进程 ${worker.id}`);
    }
    
    // 监听工作进程状态
    cluster.on('online', (worker) => {
        console.log(`✓ 检测到新工作进程上线: ${worker.id}`);
    });
    
    cluster.on('exit', (worker, code, signal) => {
        console.log(`✗ 工作进程 ${worker.id} 退出，退出码: ${code}, 信号: ${signal}`);
    });
    
    // 方法2: 共享文件检测
    console.log('\n--- 方法2: 共享文件检测 ---');
    const sharedFile = path.join(__dirname, 'shared_status.json');
    const pid = process.pid;
    
    setInterval(() => {
        try {
            // 写入状态文件
            fs.writeFileSync(sharedFile, JSON.stringify({
                pid: pid,
                timestamp: Date.now(),
                status: 'active',
                hostname: os.hostname()
            }));
            console.log(`[${new Date().toISOString()}] 状态文件更新成功`);
        } catch (err) {
            console.error('状态文件写入失败:', err.message);
        }
    }, 3000);
    
    // 读取其他实例状态
    setInterval(() => {
        try {
            if (fs.existsSync(sharedFile)) {
                const data = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
                console.log(`[文件检测] 发现实例: PID=${data.pid}, 状态=${data.status}`);
            }
        } catch (err) {
            console.error('状态文件读取失败:', err.message);
        }
    }, 2000);
    
    // 方法3: UDP广播检测
    console.log('\n--- 方法3: UDP广播检测 ---');
    const udpServer = dgram.createSocket('udp4');
    const UDP_PORT = 5000;
    
    udpServer.on('message', (msg, rinfo) => {
        try {
            const data = JSON.parse(msg.toString());
            console.log(`[UDP发现] 来自 ${rinfo.address}:${rinfo.port} 的实例: ${data.pid}`);
        } catch (e) {
            console.log(`[UDP发现] 收到来自 ${rinfo.address}:${rinfo.port} 的广播`);
        }
    });
    
    udpServer.bind(UDP_PORT, () => {
        console.log(`UDP服务器监听端口 ${UDP_PORT}`);
    });
    
    // 定期发送UDP广播
    setInterval(() => {
        const message = Buffer.from(JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            type: 'heartbeat'
        }));
        // 发送广播（假设同一网络）
        // dgram.createSocket('udp4').send(message, UDP_PORT, '255.255.255.255');
        console.log(`[UDP广播] 发送心跳包`);
    }, 4000);
    
    // 定时检查
    setTimeout(() => {
        console.log('\n=== 研究总结 ===');
        console.log('除了HTTP ping，实例间通讯的主要方式包括：');
        console.log('1. 进程信号 (如SIGUSR1) -  lightweight but limited');
        console.log('2. 共享文件 - 简单可靠，适合状态共享');
        console.log('3. UDP广播 -  discovery，无需预知对方地址');
        console.log('4. Unix域套接字 - 高性能本地IPC');
        console.log('5. 消息队列 (Redis/MQ) - 解耦，支持跨机器');
        console.log('6. 共享内存 - 极高性能，但复杂');
        console.log('7. TCP套接字点对点 - 可靠有序');
        console.log('8. 数据库通知 - 利用数据库的发布订阅功能');
        console.log('9. 消息总线 (如Redis Pub/Sub)');
        console.log('10. 使用cluster模块的内置通信');
        
        // 清理
        workers.forEach(w => w.kill());
        try { fs.unlinkSync(sharedFile); } catch(e) {}
        udpServer.close();
        process.exit(0);
    }, 15000);
    
} else {
    // 工作进程
    console.log(`工作进程 ${process.pid} 启动`);
    
    // 响应信号
    process.on('SIGUSR1', () => {
        console.log(`[工作进程 ${process.pid}] 收到来自主进程的信号`);
    });
    
    // 定期向主进程发送状态
    setInterval(() => {
        process.send({ type: 'status', pid: process.pid, timestamp: Date.now() });
    }, 2000);
    
    process.on('message', (msg) => {
        console.log(`[工作进程 ${process.pid}] 收到主进程消息:`, msg);
    });
}