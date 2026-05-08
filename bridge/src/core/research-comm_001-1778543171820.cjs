// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:46:11.820Z

// 实例间通讯方式研究：Beyond HTTP Ping
// 研究多种检测姐妹状态的通讯方式

const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function createTCPHeartbeat() {
    console.log('1. TCP Socket 心跳检测:');
    
    // 服务端
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            const message = data.toString().trim();
            if (message === 'PING') {
                socket.write('PONG\n');
                console.log('   [服务端] 收到PING，回复PONG');
            }
        });
    });
    
    server.listen(9999, () => {
        console.log('   [服务端] 监听 9999 端口...');
        
        // 客户端检测
        const client = new net.Socket();
        client.connect(9999, () => {
            console.log('   [客户端] 连接成功，发送PING...');
            client.write('PING\n');
        });
        
        client.on('data', (data) => {
            console.log('   [客户端] 收到回复:', data.toString().trim());
            server.close();
            client.destroy();
        });
    });
}

// 2. UDP 广播发现
function createUDPDiscovery() {
    console.log('\n2. UDP 广播发现:');
    
    const server = dgram.createSocket('udp4');
    const PORT = 9998;
    
    server.on('message', (message, remote) => {
        console.log(`   [服务端] 收到来自 ${remote.address}:${remote.port} 的消息:`, message.toString());
        // 回复状态
        const response = Buffer.from('I am alive!');
        server.send(response, remote.port, remote.address);
    });
    
    server.bind(PORT, () => {
        console.log('   [服务端] 绑定 UDP 端口', PORT);
        
        // 模拟广播发现
        const client = dgram.createSocket('udp4');
        client.on('listening', () => {
            client.addMembership('224.0.0.1');
            const msg = Buffer.from('WHOISIT?');
            client.send(msg, PORT, 'localhost', (err) => {
                if (err) console.error(err);
                console.log('   [客户端] 发送发现广播...');
            });
        });
        
        setTimeout(() => {
            server.close();
            client.close();
        }, 1000);
    });
}

// 3. 文件系统通知 (通过共享文件)
function createFileBasedComm() {
    console.log('\n3. 文件系统通知 (共享文件):');
    
    const statusFile = path.join(__dirname, 'status.tmp');
    
    // 写入状态
    fs.writeFileSync(statusFile, JSON.stringify({
        timestamp: Date.now(),
        status: 'healthy',
        pid: process.pid
    }));
    console.log('   [实例1] 写入状态文件');
    
    // 读取状态
    fs.readFile(statusFile, 'utf8', (err, data) => {
        if (err) throw err;
        const status = JSON.parse(data);
        console.log('   [实例2] 读取状态:', status);
        fs.unlinkSync(statusFile);
    });
}

// 4. IPC (进程间通讯)
function createIPC() {
    console.log('\n4. IPC 进程间通讯:');
    
    // 创建子进程
    const child = spawn('node', ['-e', `
        const { parentPort } = require('worker_threads');
        parentPort.on('message', (msg) => {
            console.log('   [子进程] 收到消息:', msg);
            parentPort.send({ status: 'ok', timestamp: Date.now() });
        });
        parentPort.send('Child ready');
    `], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    child.on('message', (msg) => {
        console.log('   [父进程] 收到子进程消息:', msg.toString());
    });
    
    setTimeout(() => {
        child.kill();
    }, 500);
}

// 5. 共享内存模拟 (使用Buffer)
function createSharedMemory() {
    console.log('\n5. 共享内存通信 (模拟):');
    
    // 在Node.js中，共享内存通常通过Buffer在不同进程间传递
    const sharedBuffer = Buffer.alloc(1024);
    const statusObj = { status: 'running', uptime: process.uptime() };
    const jsonString = JSON.stringify(statusObj);
    
    sharedBuffer.write(jsonString, 0);
    const readData = sharedBuffer.toString('utf8', 0, jsonString.length);
    
    console.log('   [写入] 状态:', statusObj);
    console.log('   [读取] 状态:', JSON.parse(readData));
}

// 运行所有测试
async function runTests() {
    createTCPHeartbeat();
    await new Promise(r => setTimeout(r, 500));
    
    createUDPDiscovery();
    await new Promise(r => setTimeout(r, 1500));
    
    createFileBasedComm();
    await new Promise(r => setTimeout(r, 100));
    
    createIPC();
    await new Promise(r => setTimeout(r, 600));
    
    createSharedMemory();
    
    // 总结
    console.log('\n=== 总结: 实例间通讯方式 ===');
    console.log('1. TCP Socket: 可靠、点对点，适合频繁通信');
    console.log('2. UDP Broadcast: 轻量、适合发现服务');
    console.log('3. 文件共享: 简单、跨平台，适合低频状态同步');
    console.log('4. IPC: 高性能、进程内通信');
    console.log('5. 共享内存: 最快、需特殊处理');
    console.log('6. Redis Pub/Sub: 解耦、跨机器');
    console.log('7. WebSocket: 双向、实时');
    console.log('8. 消息队列: 削峰、可靠性');
}

runTests();