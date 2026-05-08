// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:44:44.637Z

// instance-communication-research.js
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const dgram = require('dgram');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. 文件共享检测 (File-based heartbeat)
function fileBasedDetection() {
    return new Promise((resolve) => {
        const heartbeatFile = path.join(__dirname, 'heartbeat.txt');
        const instanceId = `instance-${process.pid}`;
        
        // 写入心跳文件
        fs.writeFileSync(heartbeatFile, JSON.stringify({
            instanceId,
            timestamp: Date.now(),
            status: 'alive'
        }));
        
        // 读取心跳文件
        fs.readFile(heartbeatFile, 'utf8', (err, data) => {
            if (err) {
                console.log('文件共享检测失败:', err.message);
                resolve(false);
            } else {
                const info = JSON.parse(data);
                console.log('✅ 文件共享检测:', info.instanceId, '最后心跳:', new Date(info.timestamp).toLocaleTimeString());
                resolve(true);
            }
        });
    });
}

// 2. TCP Socket检测
function tcpSocketDetection() {
    return new Promise((resolve) => {
        const PORT = 9876;
        const server = net.createServer((socket) => {
            socket.write(JSON.stringify({ type: 'status', status: 'alive', pid: process.pid }));
            socket.end();
        });
        
        server.listen(PORT, () => {
            console.log('✅ TCP Socket 服务端启动，端口:', PORT);
            
            // 模拟客户端检测
            const client = net.connect(PORT, () => {
                client.on('data', (data) => {
                    const response = JSON.parse(data.toString());
                    console.log('✅ TCP Socket 检测结果:', response);
                    client.destroy();
                    server.close();
                    resolve(true);
                });
            });
            
            client.on('error', () => {
                server.close();
                resolve(false);
            });
        });
        
        server.on('error', () => {
            resolve(false);
        });
    });
}

// 3. UDP广播检测
function udpBroadcastDetection() {
    return new Promise((resolve) => {
        const PORT = 9877;
        const server = dgram.createSocket('udp4');
        
        server.on('message', (msg, remote) => {
            const info = JSON.parse(msg.toString());
            console.log('✅ UDP 接收到来自', remote.address + ':' + remote.port, '的心跳:', info);
            server.close();
            resolve(true);
        });
        
        server.bind(PORT, () => {
            console.log('✅ UDP Socket 服务端启动，端口:', PORT);
            
            // 发送广播
            const client = dgram.createSocket('udp4');
            const message = Buffer.from(JSON.stringify({
                type: 'heartbeat',
                instanceId: `instance-${process.pid}`,
                timestamp: Date.now()
            }));
            
            client.broadcastSend(message, PORT, '255.255.255.255', (err) => {
                if (err) console.log('UDP 发送失败:', err);
                client.close();
            });
        });
        
        setTimeout(() => resolve(false), 2000);
    });
}

// 4. IPC (Node.js 进程间通信)
function ipcDetection() {
    return new Promise((resolve) => {
        if (process.argv.includes('--child')) {
            // 子进程
            process.on('message', (msg) => {
                if (msg.type === 'ping') {
                    process.send({ type: 'pong', pid: process.pid, timestamp: Date.now() });
                }
            });
        } else {
            // 父进程
            const child = spawn(process.execPath, [__filename, '--child'], { silent: true });
            child.on('message', (msg) => {
                console.log('✅ IPC 检测结果:', msg);
                child.kill();
                resolve(true);
            });
            
            child.on('error', () => {
                resolve(false);
            });
            
            setTimeout(() => {
                child.kill();
                resolve(false);
            }, 2000);
            
            child.send({ type: 'ping' });
        }
    });
}

// 运行所有检测方式
async function runAllTests() {
    console.log('开始测试各种实例间通讯方式...\n');
    
    const results = {
        '文件共享检测': await fileBasedDetection(),
        'TCP Socket检测': await tcpSocketDetection(),
        'UDP 广播检测': await udpBroadcastDetection(),
        'IPC 检测': await ipcDetection()
    };
    
    console.log('\n=== 检测结果总结 ===');
    Object.entries(results).forEach(([method, success]) => {
        console.log(`${method}: ${success ? '✅ 成功' : '❌ 失败'}`);
    });
    
    // 清理临时文件
    const heartbeatFile = path.join(__dirname, 'heartbeat.txt');
    if (fs.existsSync(heartbeatFile)) {
        fs.unlinkSync(heartbeatFile);
    }
}

runAllTests().catch(console.error);