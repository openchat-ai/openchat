// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:59:33.818Z

// instance-communication.js
// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？

const http = require('http');
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. IPC (进程间通讯) - 使用 child_process 内置的 IPC 通道
function demonstrateIPC() {
    console.log('1. IPC 方式 (Process IPC):');
    console.log('   - Node.js 内置的 child_process IPC 机制');
    console.log('   - 父子进程通过 stdio 或专用通道通信');
    console.log('   - 适用于主进程-工作进程架构\n');
}

// 2. UDP 广播 - 无中心节点的服务发现
function demonstrateUDPBroadcast() {
    console.log('2. UDP 广播方式:');
    console.log('   - 利用 UDP 组播/广播发现同伴');
    console.log('   - 低延迟，无需中心调度');
    console.log('   - 适合局域网内发现\n');

    // 创建 UDP 服务器
    const server = dgram.createSocket('udp4');
    const PORT = 50055;
    
    server.on('message', (message, remote) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`   [UDP] 收到来自 ${remote.address}:${remote.port} 的心跳:`, data);
        } catch (e) {}
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`   [UDP] 监听中 ${address.address}:${address.port}`);
        
        // 模拟发送心跳
        setInterval(() => {
            const heartbeat = JSON.stringify({
                type: 'heartbeat',
                pid: process.pid,
                hostname: os.hostname(),
                timestamp: Date.now()
            });
            server.send(heartbeat, PORT, '255.255.255.255');
        }, 3000);
    });

    server.bind(PORT);
}

// 3. TCP Socket 点对点通信
function demonstrateTCPSocket() {
    console.log('3. TCP Socket 方式:');
    console.log('   - 直接的 TCP 连接通讯');
    console.log('   - 可靠、有序的数据传输');
    console.log('   - 需要知道对方的 IP 和端口\n');

    const PORT = 50056;
    
    // 服务器端
    const server = net.createServer((socket) => {
        console.log('   [TCP] 客户端连接建立');
        
        socket.on('data', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log('   [TCP] 收到消息:', message);
                
                // 回复状态
                if (message.type === 'ping') {
                    const response = JSON.stringify({
                        type: 'pong',
                        pid: process.pid,
                        uptime: process.uptime()
                    });
                    socket.write(response);
                }
            } catch (e) {}
        });
    });

    server.listen(PORT, () => {
        console.log(`   [TCP] 服务器监听端口 ${PORT}`);
    });
}

// 4. 文件系统监视 (文件锁/标记)
function demonstrateFileWatch() {
    console.log('4. 文件系统监视方式:');
    console.log('   - 利用文件创建/修改时间戳记录状态');
    console.log('   - 简单的文件锁机制');
    console.log('   - 适用于共享文件系统环境\n');

    const HEARTBEAT_FILE = path.join(__dirname, '.heartbeat');
    
    // 写入心跳标记
    setInterval(() => {
        fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
            pid: process.pid,
            hostname: os.hostname(),
            timestamp: Date.now(),
            uptime: process.uptime()
        }));
    }, 2000);

    // 监视 heartbeat 文件
    fs.watch(HEARTBEAT_FILE, (eventType, filename) => {
        if (filename) {
            try {
                const content = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
                const data = JSON.parse(content);
                console.log(`   [FILE] 心跳更新: PID=${data.pid}, 时间=${new Date(data.timestamp).toLocaleTimeString()}`);
            } catch (e) {}
        }
    });
}

// 5. 信号量通信 (Unix/Linux)
function demonstrateSignal() {
    console.log('5. 信号量方式:');
    console.log('   - 使用 process.kill() 发送信号');
    console.log('   - SIGUSR1/SIGUSR2 自定义信号');
    console.log('   - 仅限单机多进程\n');

    // 设置信号处理
    process.on('SIGUSR1', () => {
        console.log('   [SIGNAL] 收到 SIGUSR1 信号，报告状态');
        process.send && process.send({ type: 'status', uptime: process.uptime() });
    });
}

// 6. 外部消息队列 (Redis风格示例)
function demonstrateMessageQueue() {
    console.log('6. 消息队列方式:');
    console.log('   - Redis Pub/Sub 模式');
    console.log('   - RabbitMQ/AMQP 协议');
    console.log('   - Kafka 消息队列');
    console.log('   - 解耦合、可扩展\n');
}

// 7. HTTP Long Polling / SSE
function demonstrateHTTPLongPoll() {
    console.log('7. HTTP 长轮询/SSE 方式:');
    console.log('   - Server-Sent Events 推送');
    console.log('   - 长轮询模拟实时通信');
    console.log('   - 基于 HTTP 协议\n');
}

// 运行所有演示
console.log('正在演示的通讯方式：\n');

demonstrateIPC();
demonstrateUDPBroadcast();
demonstrateTCPSocket();
demonstrateFileWatch();
demonstrateSignal();
demonstrateMessageQueue();
demonstrateHTTPLongPoll();

console.log('=== 总结 ===');
console.log('实例间通讯方式总结：');
console.log('- IPC: 最适合 Node.js 进程间通讯');
console.log('- UDP: 快速发现，无中心节点');
console.log('- TCP: 可靠的点对点连接');
console.log('- 文件: 简单共享状态');
console.log('- 信号: 单机进程间通信');
console.log('- 消息队列: 高可用、解耦合架构');
console.log('- HTTP: 跨平台，防火墙友好\n');

// 保持进程运行
console.log('演示正在运行中... 按 Ctrl+C 退出');