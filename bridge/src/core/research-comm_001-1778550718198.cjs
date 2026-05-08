// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:51:58.198Z

// 实例间通讯方式研究：非HTTP ping的状态检测方法
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('=== 实例间通讯方式研究：检测姐妹状态的非HTTP ping方法 ===\n');

// 1. TCP Socket 心跳检测
function createTCPHeartbeat(port, nodeId) {
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            const message = data.toString();
            if (message === 'HEARTBEAT') {
                console.log(`[${nodeId}] 收到来自节点的心跳请求`);
                socket.write('ALIVE');
            }
        });
    });

    server.listen(port, () => {
        console.log(`[${nodeId}] TCP服务器启动，端口 ${port}`);
    });

    // 定期发送心跳
    setInterval(() => {
        const client = net.connect(port, () => {
            client.write('HEARTBEAT');
        });
        
        client.on('data', (data) => {
            if (data.toString() === 'ALIVE') {
                console.log(`[${nodeId}] 收到来自节点${port}的ALIVE响应`);
            }
        });
        
        client.on('close', () => {
            console.log(`[${nodeId}] 节点${port}连接关闭`);
        });
    }, 3000);
}

// 2. UDP 广播检测
function createUDPMonitor(port, nodeId) {
    const server = dgram.createSocket('udp4');
    
    server.on('message', (message, remote) => {
        const msg = message.toString();
        console.log(`[${nodeId}] 收到UDP消息: ${msg} 来自 ${remote.address}:${remote.port}`);
        
        if (msg === 'STATUS_CHECK') {
            const response = Buffer.from(`NODE_${nodeId}_ALIVE`);
            server.send(response, remote.port, remote.address);
        }
    });

    server.bind(port, () => {
        console.log(`[${nodeId}] UDP服务器启动，端口 ${port}`);
        
        // 定期广播状态
        setInterval(() => {
            const message = Buffer.from(`NODE_${nodeId}_STATUS`);
            server.broadcastAddress = '255.255.255.255';
            server.setBroadcast(true);
            server.send(message, port, '255.255.255.255');
            console.log(`[${nodeId}] 广播状态: NODE_${nodeId}_STATUS`);
        }, 4000);
    });
}

// 3. IPC - 文件系统通知
function createFileWatcher(nodeId, watchDir) {
    const dir = path.join(__dirname, watchDir);
    
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}

    // 写入状态文件
    const statusFile = path.join(dir, `status_${nodeId}.txt`);
    
    setInterval(() => {
        const timestamp = new Date().toISOString();
        fs.writeFileSync(statusFile, `${nodeId}:${timestamp}`);
        console.log(`[${nodeId}] 更新状态文件: ${statusFile}`);
    }, 2000);

    // 监听其他节点状态
    fs.watch(dir, (eventType, filename) => {
        if (filename && filename.startsWith('status_') && filename !== `status_${nodeId}.txt`) {
            const filePath = path.join(dir, filename);
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (!err) {
                    console.log(`[${nodeId}] 检测到节点状态变化: ${data.trim()}`);
                }
            });
        }
    });
}

// 4. 进程信号通信 (适用于同一主机)
function createSignalHandler(nodeId) {
    process.on('SIGUSR1', () => {
        console.log(`[${nodeId}] 收到来自父进程的自定义信号`);
    });
    
    // 模拟定期发送信号
    setInterval(() => {
        console.log(`[${nodeId}] 发送自定义信号给父进程`);
        process.kill(process.ppid, 'SIGUSR1');
    }, 5000);
}

// 5. 共享内存模拟 (使用文件作为共享存储)
function createSharedMemoryStore(nodeId, storeFile) {
    const storePath = path.join(__dirname, storeFile);
    
    setInterval(() => {
        const data = {
            nodeId,
            timestamp: Date.now(),
            status: 'active'
        };
        fs.writeFileSync(storePath, JSON.stringify(data));
        console.log(`[${nodeId}] 更新共享存储: ${storePath}`);
    }, 3000);
    
    // 读取其他节点共享数据
    setInterval(() => {
        try {
            const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            if (data.nodeId !== nodeId) {
                console.log(`[${nodeId}] 从共享存储读取节点状态: ${JSON.stringify(data)}`);
            }
        } catch (e) {}
    }, 2000);
}

// 启动演示
console.log('\n--- 启动多个节点演示 ---\n');

// 节点1
console.log('\n=== 节点 1 ===');
createTCPHeartbeat(3001, 'Node1');
createUDPMonitor(3002, 'Node1');
createFileWatcher('Node1', 'node1_watch');
createSharedMemoryStore('Node1', 'shared_store.json');

// 节点2 (模拟)
console.log('\n=== 节点 2 ===');
createTCPHeartbeat(3003, 'Node2');
createUDPMonitor(3004, 'Node2');
createFileWatcher('Node2', 'node2_watch');
createSharedMemoryStore('Node2', 'shared_store.json');

console.log('\n=== 可用的实例间通讯方式总结 ===');
console.log('1. TCP Socket: 点对点可靠通信，适合心跳检测');
console.log('2. UDP 广播: 高效广播，适合状态发现');
console.log('3. 文件系统: 跨进程文件通知，适合同一主机');
console.log('4. 进程信号: 轻量级信号，适合Unix进程');
console.log('5. 共享存储: 文件/Redis作为中间件，适合分布式');
console.log('\n=== 推荐的生产方案 ===');
console.log('- 局域网内: UDP广播 + TCP确认');
console.log('- 跨主机: Redis Pub/Sub 或 RabbitMQ');
console.log('- 容器环境: Kubernetes探针或etcd');
console.log('- 高可用: gRPC心跳或WebSocket长连接');