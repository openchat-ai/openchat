// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:13:10.178Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 研究实例间通讯方式
async function researchInterInstanceCommunication() {
    console.log('=== 实例间通讯方式研究 ===\n');
    
    // 1. TCP Socket 连接检测
    console.log('1. TCP Socket 连接检测:');
    await testTCPSocket();
    
    // 2. UDP 广播检测
    console.log('\n2. UDP 广播检测:');
    await testUDPBroadcast();
    
    // 3. 文件系统共享状态
    console.log('\n3. 文件系统共享状态:');
    await testFileBasedCommunication();
    
    // 4. 本地进程通信 (IPC)
    console.log('\n4. 本地进程通信 (IPC):');
    testIPC();
    
    console.log('\n=== 研究总结 ===');
    console.log('实例间通讯方式汇总:');
    console.log('- TCP Socket: 点对点可靠连接，适合状态同步');
    console.log('- UDP 广播: 多播发现，适合服务发现');
    console.log('- 文件系统: 跨进程文件锁，适合简单状态共享');
    console.log('- IPC: 管道通信，适合本地进程间通讯');
    console.log('- HTTP: RESTful API，适合web服务');
    console.log('- WebSocket: 双向实时通信');
    console.log('- Redis PUB/SUB: 消息队列');
    console.log('- 数据库轮询: 共享数据存储');
}

// TCP Socket 测试
function testTCPSocket() {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            socket.write('pong');
            socket.end();
        });
        
        server.listen(0, () => {
            const port = server.address().port;
            console.log(`  创建TCP服务器，端口: ${port}`);
            
            // 客户端连接测试
            const client = net.connect(port, () => {
                console.log('  TCP连接成功建立');
                client.destroy();
                server.close();
                resolve();
            });
            
            client.on('data', (data) => {
                console.log(`  收到响应: ${data.toString().trim()}`);
            });
            
            client.on('error', (err) => {
                console.log(`  TCP连接错误: ${err.message}`);
                server.close();
                resolve();
            });
        });
        
        server.on('error', (err) => {
            console.log(`  服务器错误: ${err.message}`);
            resolve();
        });
    });
}

// UDP 广播测试
function testUDPBroadcast() {
    return new Promise((resolve) => {
        const server = dgram.createSocket('udp4');
        const PORT = 50000;
        
        server.on('message', (msg, rinfo) => {
            console.log(`  收到UDP消息: ${msg.toString()} 来自 ${rinfo.address}:${rinfo.port}`);
            server.close();
            resolve();
        });
        
        server.bind(PORT, () => {
            console.log(`  UDP服务器监听端口 ${PORT}`);
            
            // 模拟广播
            const client = dgram.createSocket('udp4');
            const message = Buffer.from('heartbeat');
            client.send(message, PORT, '127.0.0.1', () => {
                console.log('  发送UDP广播消息');
                client.close();
            });
        });
        
        setTimeout(() => {
            server.close();
            resolve();
        }, 2000);
    });
}

// 文件系统通信测试
async function testFileBasedCommunication() {
    const stateFile = path.join(__dirname, 'instance_state.json');
    
    // 写入状态
    const state = {
        instanceId: process.pid,
        timestamp: Date.now(),
        status: 'active'
    };
    
    try {
        fs.writeFileSync(stateFile, JSON.stringify(state));
        console.log('  写入实例状态到文件');
        
        // 读取状态
        const data = fs.readFileSync(stateFile, 'utf8');
        const parsed = JSON.parse(data);
        console.log(`  从文件读取状态: instanceId=${parsed.instanceId}, status=${parsed.status}`);
        
        // 清理
        fs.unlinkSync(stateFile);
    } catch (err) {
        console.log(`  文件操作错误: ${err.message}`);
    }
}

// IPC 测试 (命名管道)
function testIPC() {
    if (process.platform === 'win32') {
        console.log('  Windows平台: 可创建命名管道');
    } else {
        console.log('  Unix平台: 可创建本地域套接字');
        console.log('  域套接字路径: /tmp/nodejs-ipc.sock');
    }
}

// 运行研究
researchInterInstanceCommunication().catch(console.error);