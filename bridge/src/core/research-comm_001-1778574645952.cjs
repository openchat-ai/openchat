// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:30:45.953Z

// 实例间通讯方式研究：检测姐妹状态的方法
// 除了HTTP ping，还有多种方式可以实现

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');
console.log('研究目标：探索除HTTP ping外，检测姐妹实例状态的方法\n');

// 1. TCP Socket 心跳检测
function demonstrateTCPPing() {
    console.log('1️⃣ TCP Socket 心跳检测');
    console.log('原理：通过建立TCP连接来检测目标实例是否存活');
    console.log('优点：比HTTP更轻量，不需要HTTP服务器');
    console.log('示例：');
    
    const server = net.createServer((socket) => {
        console.log('  - 姐妹实例TCP连接已建立');
        socket.write('ping');
        socket.on('data', (data) => {
            console.log(`  收到回应: ${data}`);
        });
    });
    
    server.listen(9000, () => {
        console.log('  TCP服务器已启动在端口9000');
        
        // 模拟客户端检测
        const client = new net.Socket();
        client.connect(9000, 'localhost', () => {
            console.log('  ✓ 姐妹实例TCP连接成功');
            client.write('pong');
            client.end();
        });
        
        client.on('error', (err) => {
            console.log('  ✗ 姐妹实例不可达:', err.message);
        });
        
        // 清理
        setTimeout(() => {
            server.close();
        }, 100);
    });
}

// 2. UDP 心跳包检测
function demonstrateUDPHeartbeat() {
    console.log('\n2️⃣ UDP 心跳包检测');
    console.log('原理：发送UDP广播或多播包，无需建立连接');
    console.log('优点：快速、无连接开销，适合广播');
    console.log('示例：');
    
    const server = dgram.createSocket('udp4');
    
    server.on('message', (msg, rinfo) => {
        console.log(`  收到UDP心跳: ${msg} 来自 ${rinfo.address}:${rinfo.port}`);
    });
    
    server.bind(9001, () => {
        console.log('  UDP服务器已启动在端口9001');
        
        // 发送UDP包
        const client = dgram.createSocket('udp4');
        const message = Buffer.from('heartbeat');
        client.send(message, 9001, 'localhost', (err) => {
            if (err) {
                console.log('  ✗ UDP发送失败:', err.message);
            } else {
                console.log('  ✓ UDP心跳包已发送');
            }
            client.close();
        });
        
        setTimeout(() => {
            server.close();
        }, 100);
    });
}

// 3. Unix Domain Socket 检测
function demonstrateUnixSocket() {
    console.log('\n3️⃣ Unix Domain Socket 检测');
    console.log('原理：通过本地socket文件进行进程间通信');
    console.log('优点：高性能，只适用于同一台机器');
    console.log('示例：');
    
    const socketPath = path.join(os.tmpdir(), 'sister-instance.sock');
    
    // 清理可能存在的旧socket文件
    try {
        if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }
    } catch (e) {}
    
    const server = net.createServer((socket) => {
        console.log('  姐妹实例通过Unix Socket连接');
        socket.on('data', (data) => {
            console.log(`  收到消息: ${data}`);
        });
    });
    
    server.listen(socketPath, () => {
        console.log(`  Unix Socket服务器已启动: ${socketPath}`);
        
        // 客户端连接
        const client = net.createConnection(socketPath, () => {
            console.log('  ✓ Unix Socket连接成功');
            client.write('status_check');
            client.end();
        });
        
        client.on('error', (err) => {
            console.log('  ✗ Unix Socket连接失败:', err.message);
        });
        
        setTimeout(() => {
            server.close();
            try {
                fs.unlinkSync(socketPath);
            } catch (e) {}
        }, 100);
    });
}

// 4. 共享内存/文件锁检测
function demonstrateFileLockDetection() {
    console.log('\n4️⃣ 文件锁/共享文件检测');
    console.log('原理：通过检查锁文件或共享状态文件来判断实例存活');
    console.log('优点：简单可靠，适合分布式协调');
    console.log('示例：');
    
    const lockFile = path.join(os.tmpdir(), 'sister-instance.lock');
    
    // 模拟创建锁文件
    try {
        fs.writeFileSync(lockFile, JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            status: 'alive'
        }));
        console.log('  锁文件已创建:', lockFile);
        
        // 检测姐妹状态
        if (fs.existsSync(lockFile)) {
            const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
            const isAlive = (Date.now() - data.timestamp) < 5000; // 5秒超时
            console.log(`  ✓ 姐妹实例状态: ${isAlive ? '存活' : '可能已死'}`);
            console.log(`  实例PID: ${data.pid}, 最后更新: ${new Date(data.timestamp).toISOString()}`);
        }
        
        // 清理
        fs.unlinkSync(lockFile);
    } catch (err) {
        console.log('  ✗ 文件锁检测失败:', err.message);
    }
}

// 5. 信号量检测
function demonstrateSignalDetection() {
    console.log('\n5️⃣ 进程信号检测 (仅限同一台机器)');
    console.log('原理：通过发送操作系统信号检测进程是否存活');
    console.log('优点：最底层、最快速');
    console.log('示例：');
    
    try {
        // 检测当前进程自己（模拟检测姐妹进程）
        const targetPid = process.pid;
        process.kill(targetPid, 0); // 信号0用于检测进程是否存在
        console.log(`  ✓ 进程 ${targetPid} 存在且存活`);
        
        // 尝试检测一个不存在的进程
        try {
            process.kill(99999, 0);
        } catch (err) {
            if (err.code === 'ESRCH') {
                console.log('  ✗ 进程 99999 不存在');
            }
        }
    } catch (err) {
        console.log('  ✗ 信号检测失败:', err.message);
    }
}

// 执行所有演示
console.log('开始研究...\n');

// 由于异步操作，按顺序执行
demonstrateTCPPing();
setTimeout(demonstrateUDPHeartbeat, 200);
setTimeout(demonstrateUnixSocket, 400);
setTimeout(demonstrateFileLockDetection, 600);
setTimeout(demonstrateSignalDetection, 800);

// 总结
setTimeout(() => {
    console.log('\n=== 研究总结 ===');
    console.log('除了HTTP ping，还有以下方式可以检测姐妹实例状态：');
    console.log('1. TCP Socket心跳 - 可靠，支持跨网络');
    console.log('2. UDP心跳包 - 快速，适合广播场景');
    console.log('3. Unix Domain Socket - 高性能，仅限本地');
    console.log('4. 文件锁/共享文件 - 简单可靠，适合分布式');
    console.log('5. 进程信号 - 最底层，仅限同一机器');
    console.log('\n选择建议：');
    console.log('- 跨机器通信：TCP或UDP');
    console.log('- 同一机器高性能：Unix Socket或信号');
    console.log('- 简单场景：文件锁');
    console.log('- 需要HTTP协议特性：HTTP ping');
}, 1000);