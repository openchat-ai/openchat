// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:32:39.719Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function tcpHeartbeatDemo() {
    console.log('1. TCP Socket 心跳检测');
    console.log('   - 通过建立TCP连接发送心跳包');
    console.log('   - 适用于可靠的点对点通信');
    console.log('   - 例子: 客户端每30秒向服务端发送"ping"，服务端回复"pong"\n');
}

// 2. UDP 广播/组播检测
function udpBroadcastDemo() {
    console.log('2. UDP 广播/组播检测');
    
    const server = dgram.createSocket('udp4');
    const PORT = 3001;
    
    server.on('message', (message, remote) => {
        console.log(`   [UDP] 收到来自 ${remote.address}:${remote.port} 的消息: ${message}`);
        // 回复心跳
        server.send('pong', remote.port, remote.address);
    });
    
    server.on('listening', () => {
        const address = server.address();
        console.log(`   [UDP] 监听中 ${address.address}:${address.port}`);
        
        // 模拟发送广播
        setTimeout(() => {
            server.send('heartbeat', PORT, '255.255.255.255');
            console.log('   [UDP] 发送广播 heartbeat');
        }, 100);
        
        setTimeout(() => server.close(), 2000);
    });
    
    server.bind(PORT).then(() => {
        console.log('   [UDP] 广播检测已启动\n');
    });
}

// 3. IPC (进程间通讯) 检测
function ipcDemo() {
    console.log('3. IPC (进程间通讯) 检测');
    console.log('   - 使用 Node.js child_process 或 cluster 模块');
    console.log('   - 父子进程通过管道或共享句柄通信');
    console.log('   - 例子: 主进程 fork 子进程，定期检查子进程状态\n');
}

// 4. 文件系统通知
function fileWatchDemo() {
    console.log('4. 文件系统通知');
    
    const watchFile = path.join(__dirname, 'heartbeat.tmp');
    const watcher = fs.watch(watchFile, (eventType) => {
        console.log(`   [FILE] 检测到文件变更: ${eventType}`);
    });
    
    // 模拟写入心跳文件
    setTimeout(() => {
        fs.writeFileSync(watchFile, Date.now().toString());
        console.log('   [FILE] 写入心跳文件');
    }, 150);
    
    setTimeout(() => {
        watcher.close();
        fs.unlinkSync(watchFile);
        console.log('   [FILE] 清理\n');
    }, 2000);
}

// 5. Redis PUB/SUB 检测
function redisDemo() {
    console.log('5. Redis PUB/SUB 检测');
    console.log('   - 实例通过 Redis 订阅主题进行通信');
    console.log('   - 发布者发送状态消息，订阅者接收确认');
    console.log('   - 例子: 每个实例都订阅 "heartbeat" 频道\n');
}

// 6. 共享内存检测
function sharedMemoryDemo() {
    console.log('6. 共享内存检测');
    console.log('   - 多个进程共享同一段内存区域');
    console.log('   - 可以写读 timestamps 或状态标志');
    console.log('   - 例子: 使用 shm 模块在 Linux/Unix 系统中\n');
}

// 7. WebSocket 实时通信
function websocketDemo() {
    console.log('7. WebSocket 实时通信');
    console.log('   - 建立持久化的双向通信');
    console.log('   - 服务端可主动推送状态给客户端');
    console.log('   - 例子: 定期发送 JSON 状态包\n');
}

// 8. 数据库轮询
function dbPollingDemo() {
    console.log('8. 数据库轮询');
    console.log('   - 实例定期更新数据库中的状态表');
    console.log('   - 其他实例轮询该表获取最新状态');
    console.log('   - 例子: 每秒更新 last_seen 时间戳\n');
}

// 运行演示
(async () => {
    tcpHeartbeatDemo();
    ipcDemo();
    redisDemo();
    sharedMemoryDemo();
    websocketDemo();
    dbPollingDemo();
    
    // 异步演示
    await udpBroadcastDemo();
    await fileWatchDemo();
    
    console.log('=== 总结 ===');
    console.log('常用的实例间通讯方式:');
    console.log('- TCP: 可靠、有序的数据传输');
    console.log('- UDP: 低延迟广播，适合不可靠场景');
    console.log('- IPC: 高效进程间通信');
    console.log('- 文件: 简单跨平台方式');
    console.log('- Redis: 分布式系统首选');
    console.log('- WebSocket: 前后台实时通信');
})();