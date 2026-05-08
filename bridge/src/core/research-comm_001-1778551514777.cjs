// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:05:14.777Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 模拟实例ID
const instanceId = process.argv[2] || 'instance-' + process.pid;
const statusFile = path.join('/tmp', `${instanceId}.status`);

console.log(`=== 实例 ${instanceId} 启动 ===`);

// 1. TCP Socket 心跳通信
function createTCPHeartbeat() {
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            if (data.toString() === 'HEARTBEAT') {
                console.log(`[TCP] 收到来自 ${socket.remoteAddress} 的心跳`);
                socket.write('ALIVE');
            }
        });
    });
    
    server.listen(0, () => {
        const port = server.address().port;
        console.log(`[TCP] 心跳服务器启动，端口: ${port}`);
        
        // 定期发送心跳给其他实例
        setInterval(() => {
            const client = new net.Socket();
            client.connect(port, 'localhost', () => {
                client.write('HEARTBEAT');
            });
            client.on('data', (data) => {
                if (data.toString() === 'ALIVE') {
                    console.log(`[TCP] 收到来自端口 ${port} 的 ALIVE 响应`);
                }
            });
            client.on('close', () => client.destroy());
        }, 3000);
    });
    
    return server;
}

// 2. UDP 广播发现
function createUDPDiscovery() {
    const server = dgram.createSocket('udp4');
    const PORT = 5000;
    
    server.on('message', (msg, rinfo) => {
        console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的消息: ${msg}`);
        if (msg.toString() === 'DISCOVER') {
            server.send('I_AM_INSTANCE', rinfo.port, rinfo.address);
        }
    });
    
    server.bind(PORT, () => {
        console.log(`[UDP] 发现服务器启动，端口: ${PORT}`);
        
        // 定期广播发现
        setInterval(() => {
            server.send('DISCOVER', 5000, '255.255.255.255');
            console.log('[UDP] 发送发现广播');
        }, 5000);
    });
    
    return server;
}

// 3. 文件系统状态共享
function createFileStatusWatcher() {
    // 写入自身状态
    setInterval(() => {
        fs.writeFileSync(statusFile, JSON.stringify({
            id: instanceId,
            timestamp: Date.now(),
            pid: process.pid,
            hostname: os.hostname()
        }));
    }, 2000);
    
    // 监听其他实例状态
    setInterval(() => {
        try {
            const files = fs.readdirSync('/tmp')
                .filter(f => f.endsWith('.status') && f !== `${instanceId}.status`);
            
            files.forEach(file => {
                const data = JSON.parse(fs.readFileSync('/tmp/' + file));
                const age = Date.now() - data.timestamp;
                if (age < 5000) {
                    console.log(`[FILE] 发现活跃实例: ${data.id} (PID: ${data.pid}, 延迟: ${age}ms)`);
                }
            });
        } catch (e) {
            // 忽略错误
        }
    }, 3000);
    
    console.log('[FILE] 文件状态监视器启动');
}

// 4. IPC 共享内存模拟
function createIPCClient() {
    // 模拟通过控制台输出状态（实际使用时可替换为真正的IPC）
    const state = {
        id: instanceId,
        status: 'alive',
        lastUpdate: Date.now()
    };
    
    setInterval(() => {
        state.lastUpdate = Date.now();
        process.send && process.send({ type: 'STATUS', data: state });
        console.log(`[IPC] 发送状态: ${JSON.stringify(state)}`);
    }, 2000);
}

// 启动所有通信方式
const tcpServer = createTCPHeartbeat();
const udpServer = createUDPDiscovery();
createFileStatusWatcher();
createIPCClient();

// 清理
process.on('SIGTERM', () => {
    console.log(`实例 ${instanceId}  shutting down...`);
    tcpServer.close();
    udpServer.close();
    try { fs.unlinkSync(statusFile); } catch(e) {}
    process.exit(0);
});

console.log(`实例 ${instanceId} 就绪，正在监测姐妹状态...\n`);