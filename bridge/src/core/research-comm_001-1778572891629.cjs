// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:01:31.629Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// 存储发现的实例
const discoveredInstances = new Map();

// 1. TCP Socket 连接检测
function createTCPServer(port) {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const message = data.toString();
                if (message.startsWith('HEARTBEAT:')) {
                    const instanceId = message.split(':')[1];
                    discoveredInstances.set(instanceId, {
                        type: 'TCP',
                        port: port,
                        lastSeen: Date.now()
                    });
                }
            });
        });
        
        server.listen(port, () => {
            console.log(`TCP服务器启动在端口 ${port}`);
            resolve(server);
        });
    });
}

// TCP客户端发送心跳
function sendTCPHeartbeat(host, port, instanceId) {
    const client = new net.Socket();
    client.connect(port, host, () => {
        client.write(`HEARTBEAT:${instanceId}`);
        client.destroy();
    });
}

// 2. UDP 广播发现
function createUDPDiscovery(broadcastPort, instanceId) {
    const socket = dgram.createSocket('udp4');
    
    // 监听广播消息
    socket.bind(broadcastPort, () => {
        socket.setBroadcast(true);
        console.log(`UDP广播监听在端口 ${broadcastPort}`);
    });
    
    socket.on('message', (message, remote) => {
        const msg = message.toString();
        if (msg.startsWith('INSTANCE_ANNOUNCE:')) {
            const senderId = msg.split(':')[1];
            if (senderId !== instanceId) {
                discoveredInstances.set(senderId, {
                    type: 'UDP',
                    address: remote.address,
                    port: remote.port,
                    lastSeen: Date.now()
                });
            }
        }
    });
    
    // 定期广播存在
    setInterval(() => {
        const message = Buffer.from(`INSTANCE_ANNOUNCE:${instanceId}`);
        socket.send(message, broadcastPort, '255.255.255.255');
    }, 2000);
    
    return socket;
}

// 3. 文件锁方式检测
function createFileLockDiscovery(lockDir, instanceId) {
    const lockFile = path.join(lockDir, `${instanceId}.lock`);
    
    // 创建锁文件
    fs.writeFileSync(lockFile, JSON.stringify({
        instanceId: instanceId,
        pid: process.pid,
        startTime: Date.now()
    }));
    
    // 定期扫描其他锁文件
    setInterval(() => {
        try {
            const files = fs.readdirSync(lockDir);
            files.forEach(file => {
                if (file.endsWith('.lock') && file !== `${instanceId}.lock`) {
                    const filePath = path.join(lockDir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        // 文件在2分钟内更新过则认为存活
                        if (Date.now() - stats.mtime.getTime() < 120000) {
                            discoveredInstances.set(file.replace('.lock', ''), {
                                type: 'FILE_LOCK',
                                lockFile: filePath,
                                lastUpdate: stats.mtime.getTime()
                            });
                        }
                    } catch (e) {
                        // 文件可能已被删除
                    }
                }
            });
        } catch (e) {
            // 目录不存在
        }
    }, 3000);
    
    // 更新锁文件时间戳
    setInterval(() => {
        try {
            fs.utimesSync(lockFile, new Date(), new Date());
        } catch (e) {}
    }, 1000);
    
    return lockFile;
}

// 4. 共享内存方式 (使用SharedArrayBuffer模拟)
function createSharedMemoryDiscovery(instanceId) {
    // 在真实环境中可以使用SharedArrayBuffer或Redis等
    // 这里用Map模拟共享状态
    const sharedState = new Map();
    
    setInterval(() => {
        sharedState.set(instanceId, {
            timestamp: Date.now(),
            pid: process.pid
        });
    }, 1000);
    
    return sharedState;
}

// 主程序
async function main() {
    const instanceId = `instance_${process.pid}`;
    const port = 3000 + (process.pid % 100);
    
    console.log('=== 实例间通讯方式研究 ===\n');
    console.log(`当前实例ID: ${instanceId}`);
    console.log(`监听端口: ${port}\n`);
    
    // 启动各种发现方式
    const tcpServer = await createTCPServer(port);
    const udpSocket = createUDPDiscovery(4000, instanceId);
    const lockFile = createFileLockDiscovery('/tmp/instance_locks', instanceId);
    const sharedState = createSharedMemoryDiscovery(instanceId);
    
    // 模拟其他实例的TCP心跳
    setTimeout(() => {
        sendTCPHeartbeat('localhost', port, 'remote_instance_1');
    }, 1500);
    
    // 打印发现结果
    setInterval(() => {
        console.log('\n=== 发现的姐妹实例 ===');
        if (discoveredInstances.size === 0) {
            console.log('暂未发现其他实例');
        } else {
            for (const [id, info] of discoveredInstances) {
                const timeAgo = Math.floor((Date.now() - info.lastSeen) / 1000);
                console.log(`- ${id}: 类型=${info.type}, 最后见到=${timeAgo}s前`);
            }
        }
        console.log('========================\n');
    }, 5000);
    
    // 清理
    process.on('SIGINT', () => {
        console.log('\n正在清理...');
        try { fs.unlinkSync(lockFile); } catch (e) {}
        tcpServer.close();
        udpSocket.close();
        process.exit(0);
    });
}

main().catch(console.error);