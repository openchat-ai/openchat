// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:06:09.554Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 模拟的目标实例配置
const instances = [
    { id: 'instance-1', host: 'localhost', port: 3001 },
    { id: 'instance-2', host: 'localhost', port: 3002 },
    { id: 'instance-3', host: 'localhost', port: 3003 }
];

console.log('=== 实例间通信方式研究 ===\n');

// 方法1: TCP Socket 连接检测
async function checkTCPStatus(host, port, timeout = 1000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let isResolved = false;
        
        socket.setTimeout(timeout);
        
        socket.connect(port, host, () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
                resolve({ status: 'alive', method: 'TCP' });
            }
        });
        
        socket.on('error', () => {
            if (!isResolved) {
                isResolved = true;
                resolve({ status: 'dead', method: 'TCP' });
            }
        });
        
        socket.on('timeout', () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
                resolve({ status: 'timeout', method: 'TCP' });
            }
        });
    });
}

// 方法2: UDP 心跳检测
async function checkUDPStatus(host, port, timeout = 1000) {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        let isResolved = false;
        
        const message = Buffer.from(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        
        client.bind(() => {
            client.send(message, port, host, (err) => {
                if (err && !isResolved) {
                    isResolved = true;
                    client.close();
                    resolve({ status: 'dead', method: 'UDP' });
                }
            });
        });
        
        client.on('message', (msg) => {
            if (!isResolved) {
                isResolved = true;
                client.close();
                resolve({ status: 'alive', method: 'UDP' });
            }
        });
        
        setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                client.close();
                resolve({ status: 'timeout', method: 'UDP' });
            }
        }, timeout);
    });
}

// 方法3: 文件锁/共享文件检测
async function checkFileStatus(filepath, maxAge = 5000) {
    try {
        const stats = await fs.promises.stat(filepath);
        const age = Date.now() - stats.mtime.getTime();
        return {
            status: age < maxAge ? 'alive' : 'stale',
            method: 'File',
            age: `${age}ms`
        };
    } catch (err) {
        return { status: 'dead', method: 'File', error: err.message };
    }
}

// 方法4: 进程信号检测 (跨平台限制，仅演示概念)
function checkProcessSignal(pid) {
    try {
        // 在Unix系统上可以发送信号0来检测进程是否存在
        process.kill(pid, 0);
        return { status: 'alive', method: 'Signal' };
    } catch (err) {
        return { status: 'dead', method: 'Signal' };
    }
}

// 方法5: 内存映射文件检测 (概念演示)
async function checkSharedMemoryStatus() {
    // 这需要额外的模块如 mmap-io
    // 这里只是概念性演示
    return { status: 'not_implemented', method: 'SharedMemory' };
}

// 运行所有检测方法
async function runResearch() {
    console.log('1. TCP Socket 检测:');
    for (const instance of instances) {
        const result = await checkTCPStatus(instance.host, instance.port);
        console.log(`   ${instance.id} (${instance.host}:${instance.port}): ${result.status}`);
    }
    
    console.log('\n2. UDP 心跳检测:');
    for (const instance of instances) {
        const result = await checkUDPStatus(instance.host, instance.port);
        console.log(`   ${instance.id} (${instance.host}:${instance.port}): ${result.status}`);
    }
    
    console.log('\n3. 文件状态检测:');
    const testFile = path.join(os.tmpdir(), 'instance-status.json');
    // 创建测试文件
    await fs.promises.writeFile(testFile, JSON.stringify({ 
        timestamp: Date.now(), 
        instance: 'test' 
    }));
    const fileResult = await checkFileStatus(testFile);
    console.log(`   状态文件: ${fileResult.status} (年龄: ${fileResult.age})`);
    
    // 清理测试文件
    await fs.promises.unlink(testFile);
    
    console.log('\n4. 进程信号检测 (当前进程):');
    const signalResult = checkProcessSignal(process.pid);
    console.log(`   当前进程 (PID: ${process.pid}): ${signalResult.status}`);
    
    console.log('\n=== 研究总结 ===');
    console.log('除了 HTTP ping，检测姐妹实例状态的常用方式:');
    console.log('1. TCP Socket - 直接连接目标端口，速度快但需要开放端口');
    console.log('2. UDP 心跳 - 轻量级，但不可靠（可能丢包）');
    console.log('3. Redis Pub/Sub - 需要中间件支持，适合分布式场景');
    console.log('4. 文件锁/共享文件 - 简单但有延迟，不适合高频检测');
    console.log('5. 共享内存 - 高性能但跨平台支持有限');
    console.log('6. 消息队列 - 可靠但增加系统复杂性');
    console.log('7. gRPC/Thrift - 二进制协议，效率高');
}

// 执行研究
runResearch().catch(console.error);