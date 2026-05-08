// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:24:44.184Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 模拟实例间通讯方式研究
async function researchInstanceCommunication() {
    console.log('=== 实例间通讯方式研究 ===\n');

    // 1. TCP端口探测
    console.log('1. TCP端口探测：');
    const tcpResult = await checkTCPPort('localhost', 3000);
    console.log(`   端口3000状态: ${tcpResult ? '开放' : '关闭或 unreachable'}`);
    
    // 2. UDP广播探测
    console.log('\n2. UDP广播探测：');
    await checkUDPDiscovery();
    
    // 3. 文件系统状态共享
    console.log('\n3. 文件系统状态共享：');
    const fileStatus = await checkFileStatus();
    console.log(`   文件状态: ${fileStatus}`);
    
    // 4. 进程间通讯 (IPC)
    console.log('\n4. 进程间通讯 (IPC)：');
    await testIPC();
    
    // 5. Socket文件探测 (Unix/Linux)
    console.log('\n5. Socket文件探测：');
    await checkUnixSocket();
    
    console.log('\n=== 研究总结 ===');
    console.log('实例间通讯方式：');
    console.log('- TCP端口探测：可以检测服务是否存活');
    console.log('- UDP广播：轻量级发现机制');
    console.log('- 文件系统共享：通过文件状态同步');
    console.log('- IPC：父子进程通信');
    console.log('- Unix Socket：本地进程通信');
}

// TCP端口检测
function checkTCPPort(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, 1000);
        
        socket.setTimeout(1000);
        socket.on('connect', () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve(true);
        });
        
        socket.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
        });
        
        socket.connect(port, host);
    });
}

// UDP广播探测
function checkUDPDiscovery() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const message = Buffer.from('HEARTBEAT');
        
        client.on('message', (msg) => {
            console.log(`   收到UDP响应: ${msg.toString()}`);
            client.close();
            resolve();
        });
        
        client.on('listening', () => {
            const address = client.address();
            console.log(`   UDP监听中: ${address.address}:${address.port}`);
            // 模拟发送广播
            client.send(message, 0, message.length, 8080, '255.255.255.255', (err) => {
                if (err) console.log('   UDP发送失败:', err.message);
                else console.log('   UDP广播已发送');
            });
        });
        
        client.bind(8080);
        setTimeout(() => {
            client.close();
            resolve();
        }, 2000);
    });
}

// 文件系统状态共享
async function checkFileStatus() {
    return new Promise((resolve) => {
        const statusFile = path.join(__dirname, '.instance_status');
        const status = {
            pid: process.pid,
            timestamp: Date.now(),
            status: 'active'
        };
        
        try {
            fs.writeFileSync(statusFile, JSON.stringify(status));
            const data = fs.readFileSync(statusFile, 'utf8');
            fs.unlinkSync(statusFile);
            resolve(JSON.parse(data).status);
        } catch (err) {
            resolve('error: ' + err.message);
        }
    });
}

// 进程间通讯测试
function testIPC() {
    return new Promise((resolve) => {
        console.log('   启动子进程进行IPC测试...');
        
        // 创建一个简单的子进程
        const child = spawn('node', ['-e', `
            const { parentPort, childProcess } = require('worker_threads');
            if (parentPort) {
                parentPort.send({ type: 'heartbeat', status: 'alive' });
                setTimeout(() => {
                    parentPort.send({ type: 'status', data: 'working' });
                }, 500);
            }
        `], { stdio: ['ignore', 'pipe', 'pipe'] });
        
        child.stdout.on('data', (data) => {
            console.log('   子进程输出:', data.toString().trim());
        });
        
        child.stderr.on('data', (data) => {
            console.log('   子进程错误:', data.toString().trim());
        });
        
        child.on('close', (code) => {
            console.log(`   子进程退出，代码: ${code}`);
            resolve();
        });
        
        setTimeout(() => {
            child.kill();
            resolve();
        }, 2000);
    });
}

// Unix Socket探测
async function checkUnixSocket() {
    return new Promise((resolve) => {
        const socketPath = '/tmp/node_instance.sock';
        
        try {
            // 尝试连接Unix socket
            const client = new net.Socket();
            
            client.setTimeout(500);
            client.on('connect', () => {
                console.log('   Unix Socket连接成功');
                client.write('PING');
                client.end();
                resolve();
            });
            
            client.on('error', (err) => {
                console.log('   Unix Socket不可用:', err.code);
                client.destroy();
                resolve();
            });
            
            client.connect(socketPath);
        } catch (err) {
            console.log('   Unix Socket测试失败:', err.message);
            resolve();
        }
    });
}

// 运行研究
researchInstanceCommunication().catch(console.error);