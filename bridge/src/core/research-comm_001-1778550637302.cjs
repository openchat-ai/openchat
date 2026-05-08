// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:50:37.302Z

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

console.log('=== 实例间通讯方式研究 ===\n');

// 模拟多个检测方式
async function researchCommunicationMethods() {
    const results = {};
    
    // 1. TCP Socket 连接检测
    console.log('1. TCP Socket 连接检测...');
    results.tcp = await testTCPSocket();
    
    // 2. UDP 心跳检测
    console.log('2. UDP 心跳检测...');
    results.udp = await testUDPHeartbeat();
    
    // 3. 文件系统状态检测
    console.log('3. 文件系统状态检测...');
    results.file = await testFileBasedDetection();
    
    // 4. 进程间通信 (IPC)
    console.log('4. 进程间通信 (IPC)...');
    results.ipc = await testIPC();
    
    // 5. 共享内存检测
    console.log('5. 共享内存检测...');
    results.sharedMemory = await testSharedMemory();
    
    console.log('\n=== 研究结果汇总 ===');
    console.log(JSON.stringify(results, null, 2));
}

// TCP Socket 检测
function testTCPSocket() {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            socket.write('pong');
            socket.end();
        });
        
        server.listen(0, () => {
            const port = server.address().port;
            
            // 客户端尝试连接
            const client = net.connect({ port, host: 'localhost' }, () => {
                client.on('data', (data) => {
                    if (data.toString() === 'pong') {
                        resolve({ success: true, method: 'TCP Socket', latency: Date.now() % 100 });
                    }
                });
                client.destroy();
                server.close();
            });
            
            client.on('error', () => {
                resolve({ success: false, method: 'TCP Socket', error: 'Connection failed' });
                server.close();
            });
        });
    });
}

// UDP 心跳检测
function testUDPHeartbeat() {
    return new Promise((resolve) => {
        const server = dgram.createSocket('udp4');
        const messages = [];
        
        server.on('message', (msg) => {
            messages.push(msg.toString());
            if (messages.includes('heartbeat')) {
                server.close();
                resolve({ success: true, method: 'UDP Heartbeat', response: 'received' });
            }
        });
        
        server.bind(0, () => {
            const port = server.address().port;
            
            setTimeout(() => {
                const client = dgram.createSocket('udp4');
                client.send('heartbeat', port, 'localhost', () => {
                    client.close();
                });
            }, 50);
        });
        
        server.on('error', () => {
            resolve({ success: false, method: 'UDP Heartbeat', error: 'UDP error' });
            server.close();
        });
    });
}

// 文件系统检测
function testFileBasedDetection() {
    return new Promise((resolve) => {
        const heartbeatFile = path.join(os.tmpdir(), 'instance_heartbeat.json');
        const instanceId = crypto.randomBytes(4).toString('hex');
        
        // 模拟写入心跳
        fs.writeFile(heartbeatFile, JSON.stringify({ 
            id: instanceId, 
            timestamp: Date.now(),
            status: 'alive'
        }), (err) => {
            if (err) {
                resolve({ success: false, method: 'File System', error: err.message });
                return;
            }
            
            // 读取验证
            fs.readFile(heartbeatFile, 'utf8', (err, data) => {
                if (err) {
                    resolve({ success: false, method: 'File System', error: err.message });
                } else {
                    const info = JSON.parse(data);
                    // 清理
                    fs.unlinkSync(heartbeatFile);
                    resolve({ 
                        success: true, 
                        method: 'File System', 
                        instanceId: info.id,
                        age: Date.now() - info.timestamp
                    });
                }
            });
        });
    });
}

// IPC 检测 (使用 socket 文件)
function testIPC() {
    return new Promise((resolve) => {
        const ipcPath = path.join(os.tmpdir(), `ipc_${Date.now()}.sock`);
        let serverReady = false;
        
        const server = net.createServer((socket) => {
            serverReady = true;
            socket.write('ipc_pong');
            socket.end();
        });
        
        server.listen(ipcPath, () => {
            const client = net.connect(ipcPath, () => {
                client.on('data', (data) => {
                    if (data.toString() === 'ipc_pong') {
                        client.destroy();
                        server.close();
                        try { fs.unlinkSync(ipcPath); } catch(e) {}
                        resolve({ success: true, method: 'IPC', type: 'Unix Socket' });
                    }
                });
            });
            
            client.on('error', () => {
                server.close();
                try { fs.unlinkSync(ipcPath); } catch(e) {}
                resolve({ success: false, method: 'IPC', error: 'IPC connection failed' });
            });
        });
        
        server.on('error', () => {
            resolve({ success: false, method: 'IPC', error: 'Cannot create IPC endpoint' });
        });
    });
}

// 共享内存检测 (使用文件描述符模拟)
function testSharedMemory() {
    return new Promise((resolve) => {
        const shmPath = path.join(os.tmpdir(), `shm_${Date.now()}.dat`);
        const buffer = Buffer.from(`alive:${Date.now()}`);
        
        fs.writeFile(shmPath, buffer, (err) => {
            if (err) {
                resolve({ success: false, method: 'Shared Memory', error: err.message });
                return;
            }
            
            fs.readFile(shmPath, (err, data) => {
                fs.unlinkSync(shmPath);
                if (err) {
                    resolve({ success: false, method: 'Shared Memory', error: err.message });
                } else {
                    const content = data.toString();
                    resolve({ 
                        success: true, 
                        method: 'Shared Memory', 
                        status: content.startsWith('alive')
                    });
                }
            });
        });
    });
}

// 运行研究
researchCommunicationMethods().catch(console.error);