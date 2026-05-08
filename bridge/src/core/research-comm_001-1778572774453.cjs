// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:59:34.453Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function tcpHeartbeatDemo() {
    console.log('1. TCP Socket 心跳检测:');
    console.log('   - 主实例创建TCP服务器，监听端口');
    console.log('   - 姐妹实例定期connect发起心跳');
    console.log('   - 服务器可判断连接状态和心跳包间隔');
    console.log('   - 适用于可靠性要求高的场景\n');
}

// 2. UDP 广播/组播
function udpBroadcastDemo() {
    console.log('2. UDP 广播/组播:');
    console.log('   - 实例通过UDP广播发送“我在线”信号');
    console.log('   - 其他实例监听广播端口，收到即为在线状态');
    console.log('   - 适用于局域网内快速发现');
    console.log('   - 组播可减少广播量，提高效率\n');
}

// 3. IPC (进程间通讯)
function ipcDemo() {
    console.log('3. IPC (进程间通讯):');
    console.log('   - Unix Domain Socket (Linux/Mac):');
    console.log('     /tmp/app.sock 这种Unix套接字文件');
    console.log('   - Windows Named Pipe:');
    console.log('     \\\\.\\pipe\\app-pipe 这种命名管道');
    console.log('   - 速度快，适用于本地进程通信\n');
}

// 4. 文件系统通知
function fileWatchDemo() {
    console.log('4. 文件系统通知:');
    console.log('   - 共享目录下创建时间戳文件');
    console.log('   - 使用 fs.watch 监听文件变化');
    console.log('   - 定期更新“心跳”文件内容');
    console.log('   - 适用于跨平台，但I/O开销较大\n');
}

// 5. 共享内存/信号量
function sharedMemoryDemo() {
    console.log('5. 共享内存/信号量:');
    console.log('   - 使用 shm 模块在Linux共享内存');
    console.log('   - 写入状态标识，轮询读取');
    console.log('   - 速度极快，但平台相关\n');
}

// 6. 消息队列
function messageQueueDemo() {
    console.log('6. 消息队列 (Message Queue):');
    console.log('   - Redis Pub/Sub:');
    console.log('     实例订阅频道，收到发布消息即在线');
    console.log('   - RabbitMQ/ Kafka:');
    console.log('     基于消息代理的可靠投递');
    console.log('   - 解耦性好，支持跨网络\n');
}

// 7. WebSocket 长连接
function websocketDemo() {
    console.log('7. WebSocket 长连接:');
    console.log('   - 保持双向连接');
    console.log('   - 可随时发送状态更新');
    console.log('   - 适合需要实时通信的场景\n');
}

// 演示：UDP广播实现简单心跳
function demonstrateUDPHeartbeat() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const PORT = 5000;
        const HOST = '255.255.255.255';
        
        // 模拟发送心跳
        const heartbeat = Buffer.from(JSON.stringify({
            instanceId: 'instance-1',
            timestamp: Date.now(),
            status: 'alive'
        }));
        
        client.on('listening', () => {
            console.log('--- UDP广播心跳演示 ---');
            console.log(`发送心跳到 ${HOST}:${PORT}`);
            client.send(heartbeat, PORT, HOST, (err) => {
                if (err) console.error('发送失败:', err);
                else console.log('心跳发送成功');
                client.close();
                resolve();
            });
        });
        
        client.bind(PORT + 1); // 随机端口
    });
}

// 演示：文件系统心跳
function demonstrateFileHeartbeat() {
    return new Promise((resolve) => {
        const heartbeatDir = path.join(os.tmpdir(), 'instance-heartbeat');
        const heartbeatFile = path.join(heartbeatDir, 'heartbeat.json');
        
        console.log('\n--- 文件系统心跳演示 ---');
        console.log(`心跳目录: ${heartbeatDir}`);
        
        try {
            if (!fs.existsSync(heartbeatDir)) {
                fs.mkdirSync(heartbeatDir, { recursive: true });
            }
            
            const heartbeatData = {
                instanceId: 'instance-1',
                timestamp: Date.now(),
                status: 'alive',
                pid: process.pid
            };
            
            fs.writeFileSync(heartbeatFile, JSON.stringify(heartbeatData));
            console.log('心跳文件写入成功:', heartbeatFile);
            
            const readData = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
            console.log('读取心跳数据:', readData);
            
            fs.unlinkSync(heartbeatFile);
            console.log('清理心跳文件');
        } catch (err) {
            console.error('文件操作错误:', err.message);
        }
        
        resolve();
    });
}

// 主函数
async function main() {
    tcpHeartbeatDemo();
    udpBroadcastDemo();
    ipcDemo();
    fileWatchDemo();
    sharedMemoryDemo();
    messageQueueDemo();
    websocketDemo();
    
    await demonstrateUDPHeartbeat();
    await demonstrateFileHeartbeat();
    
    console.log('\n=== 总结 ===');
    console.log('不同通讯方式的优缺点：');
    console.log('HTTP: 简单但开销大');
    console.log('TCP: 可靠但需维护连接');
    console.log('UDP: 轻量但不可靠');
    console.log('文件: 跨平台但慢');
    console.log('IPC: 快但平台相关');
    console.log('消息队列: 解耦但需额外服务');
    console.log('WebSocket: 实时双向但复杂');
}

main().catch(console.error);