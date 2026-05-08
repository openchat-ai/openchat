// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:41:57.242Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 模拟实例配置
const INSTANCE_ID = process.argv[2] || `instance-${Math.floor(Math.random() * 1000)}`;
const PORT = parseInt(process.argv[3]) || 3000;
const STATUS_FILE = path.join(__dirname, 'instance_status.json');

console.log(`\n=== 实例间通讯方式研究 ===`);
console.log(`当前实例: ${INSTANCE_ID}, 端口: ${PORT}\n`);

// 1. TCP Socket 状态检测
function testTCPConnection(port, host = 'localhost') {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 2000;
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve({ success: true, method: 'TCP Socket', port });
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, method: 'TCP Socket', port, error: 'timeout' });
        });
        
        socket.on('error', (err) => {
            resolve({ success: false, method: 'TCP Socket', port, error: err.message });
        });
        
        socket.connect(port, host);
    });
}

// 2. UDP 广播发现
function createUDPDiscovery() {
    const socket = dgram.createSocket('udp4');
    const BROADCAST_PORT = 5000;
    
    socket.bind(BROADCAST_PORT, () => {
        socket.setBroadcast(true);
    });
    
    socket.on('message', (msg, rinfo) => {
        try {
            const data = JSON.parse(msg.toString());
            console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的发现消息:`, data);
        } catch (e) {
            // 忽略解析错误
        }
    });
    
    // 定期广播存在
    setInterval(() => {
        const message = JSON.stringify({
            instanceId: INSTANCE_ID,
            port: PORT,
            timestamp: Date.now()
        });
        socket.send(message, BROADCAST_PORT, '255.255.255.255');
    }, 3000);
    
    return socket;
}

// 3. 文件锁方式检测
function updateStatusFile() {
    try {
        let statuses = {};
        if (fs.existsSync(STATUS_FILE)) {
            statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        }
        
        statuses[INSTANCE_ID] = {
            pid: process.pid,
            port: PORT,
            lastUpdate: Date.now(),
            status: 'alive'
        };
        
        // 写入临时文件后重命名，确保原子性
        const tempFile = STATUS_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(statuses, null, 2));
        fs.renameSync(tempFile, STATUS_FILE);
        
        console.log(`[文件锁] 状态已更新: ${INSTANCE_ID}`);
    } catch (err) {
        console.error('[文件锁] 更新失败:', err.message);
    }
}

function detectByFile() {
    try {
        if (!fs.existsSync(STATUS_FILE)) return [];
        
        const content = fs.readFileSync(STATUS_FILE, 'utf8');
        const statuses = JSON.parse(content);
        const now = Date.now();
        
        return Object.entries(statuses)
            .filter(([id, data]) => {
                // 5秒内有更新的认为存活
                return (now - data.lastUpdate) < 5000 && id !== INSTANCE_ID;
            })
            .map(([id, data]) => ({ id, ...data }));
    } catch (err) {
        return [];
    }
}

// 4. 简单的 TCP 服务器用于被检测
function createTCPServer(port) {
    const server = net.createServer((socket) => {
        socket.end(`Hello from ${INSTANCE_ID}\n`);
    });
    
    server.listen(port, () => {
        console.log(`[TCP Server] 监听端口 ${port}`);
    });
    
    return server;
}

// 主程序
async function main() {
    // 启动 TCP 服务器
    const server = createTCPServer(PORT);
    
    // 启动 UDP 发现
    const udpSocket = createUDPDiscovery();
    
    // 定期更新状态文件
    setInterval(updateStatusFile, 2000);
    
    // 定期检测其他实例
    async function detectOthers() {
        // TCP 检测常见端口
        const portsToCheck = [3000, 3001, 3002, 3003];
        const tcpResults = [];
        
        for (const port of portsToCheck) {
            if (port !== PORT) {
                const result = await testTCPConnection(port);
                tcpResults.push(result);
            }
        }
        
        // 文件检测
        const fileDetected = detectByFile();
        
        // 输出结果
        console.log('\n--- 检测结果 ---');
        console.log('TCP 检测结果:');
        tcpResults.forEach(r => {
            const status = r.success ? '✓ 在线' : '✗ 离线';
            console.log(`  端口 ${r.port}: ${status}`);
        });
        
        console.log('\n文件检测结果:');
        if (fileDetected.length > 0) {
            fileDetected.forEach(inst => {
                console.log(`  ${inst.id} (PID: ${inst.pid}, 端口: ${inst.port})`);
            });
        } else {
            console.log('  暂无其他实例');
        }
        
        console.log('\n--------------------\n');
    }
    
    // 初始检测
    await detectOthers();
    
    // 每5秒检测一次
    setInterval(detectOthers, 5000);
    
    // 清理函数
    process.on('SIGINT', () => {
        console.log('\n正在清理...');
        server.close();
        udpSocket.close();
        
        // 清除状态文件中的自己
        try {
            if (fs.existsSync(STATUS_FILE)) {
                const statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
                delete statuses[INSTANCE_ID];
                fs.writeFileSync(STATUS_FILE, JSON.stringify(statuses, null, 2));
            }
        } catch (e) {}
        
        process.exit(0);
    });
}

// 运行
main().catch(console.error);