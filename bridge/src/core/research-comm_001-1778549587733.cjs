// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:33:07.733Z

const fs = require('fs');
const path = require('path');
const net = require('net');
const cluster = require('cluster');
const os = require('os');

console.log('=== 实例间通信方式研究 ===\n');

// 1. 文件系统状态检测
console.log('1. 文件系统状态检测 (File-based heartbeat)');
const statusFile = path.join(__dirname, '.sibling-status.json');

function updateFileStatus(status) {
    fs.writeFileSync(statusFile, JSON.stringify({
        pid: process.pid,
        status: status,
        timestamp: Date.now(),
        hostname: os.hostname()
    }, null, 2));
}

function checkFileStatus() {
    try {
        if (fs.existsSync(statusFile)) {
            const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
            const age = Date.now() - data.timestamp;
            return {
                alive: age < 5000, // 5秒内则认为存活
                data: data
            };
        }
    } catch (e) {
        console.error('文件状态读取错误:', e.message);
    }
    return { alive: false, data: null };
}

// 模拟状态更新
updateFileStatus('active');
setTimeout(() => {
    const result = checkFileStatus();
    console.log('   文件检测结果:', result.alive ? '存活' : '死亡', result.data);
}, 100);

// 2. TCP Socket 心跳
console.log('\n2. TCP Socket 心跳检测');
const PORT = 9876;
let socketServer = null;
let socketClient = null;

if (cluster.isMaster || !cluster.isMaster) {
    // 服务器端
    socketServer = net.createServer((socket) => {
        socket.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg === 'PING') {
                socket.write('ALIVE\n');
            }
        });
    });
    
    socketServer.listen(PORT, () => {
        console.log('   Socket 服务器启动，端口:', PORT);
        
        // 客户端连接测试
        socketClient = net.connect(PORT, () => {
            console.log('   Socket 客户端连接成功');
            socketClient.write('PING\n');
            
            socketClient.on('data', (data) => {
                console.log('   Socket 响应:', data.toString().trim());
                socketClient.destroy();
                socketServer.close();
            });
        });
        
        socketClient.on('error', (e) => {
            console.log('   Socket 客户端错误:', e.message);
        });
    });
}

// 3. Cluster 模块通信
console.log('\n3. Cluster 模块通信');
if (cluster.isMaster) {
    console.log('   Master 进程 PID:', process.pid);
    // 启动 worker
    const worker = cluster.fork();
    
    worker.on('message', (msg) => {
        console.log('   Master 收到 Worker 消息:', msg);
    });
    
    // 间隔发送消息
    setTimeout(() => {
        worker.send({ type: 'HEARTBEAT_CHECK', from: 'master' });
    }, 100);
    
    // 清理
    setTimeout(() => {
        worker.kill();
        console.log('   Worker 已终止');
    }, 500);
} else {
    // Worker 进程
    console.log('   Worker 进程 PID:', process.pid);
    process.on('message', (msg) => {
        console.log('   Worker 收到 Master 消息:', msg);
        // 回复状态
        process.send({ type: 'STATUS', pid: process.pid, status: 'active' });
    });
}

// 4. UDP 广播探测
setTimeout(() => {
    console.log('\n4. UDP 广播探测');
    
    const server = dgram.createSocket('udp4');
    const dgram = require('dgram');
    
    const UDP_PORT = 9999;
    
    server.on('message', (msg, rinfo) => {
        console.log('   UDP 收到来自', rinfo.address + ':' + rinfo.port, '的消息:', msg.toString());
    });
    
    server.bind(UDP_PORT, () => {
        console.log('   UDP 服务器监听端口:', UDP_PORT);
        
        // 模拟广播
        setTimeout(() => {
            server.close();
            console.log('   UDP 服务器已关闭');
        }, 300);
    });
    
}, 600);

// 5. 演示总结
setTimeout(() => {
    console.log('\n=== 通信方式总结 ===');
    console.log('1. 文件系统: 通过读写文件交换状态，适合低频检测');
    console.log('2. TCP Socket: 低延迟实时通信，需维护连接');
    console.log('3. Cluster: 进程内通信，速度快，仅限同机');
    console.log('4. UDP: 广播发现，无连接，可能丢包');
    console.log('5. Redis/MQ: 跨机通信，需额外服务');
    console.log('6. WebSocket: 双向实时，适合Web场景');
    
    // 清理
    try { fs.unlinkSync(statusFile); } catch(e) {}
    
    process.exit(0);
}, 1000);