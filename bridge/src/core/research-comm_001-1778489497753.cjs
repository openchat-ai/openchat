// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:51:37.753Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== 实例间通信方式研究 ===\n');

// 方法1: TCP端口检测
function checkTCPStatus(host, port, timeout = 3000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let isResolved = false;
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
                resolve({ method: 'TCP Port Check', status: 'alive', port });
            }
        });
        
        socket.on('timeout', () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
                resolve({ method: 'TCP Port Check', status: 'timeout', port });
            }
        });
        
        socket.on('error', () => {
            if (!isResolved) {
                isResolved = true;
                resolve({ method: 'TCP Port Check', status: 'error', port });
            }
        });
        
        socket.connect(port, host);
    });
}

// 方法2: UDP心跳检测
function checkUDPStatus(host, port, timeout = 3000) {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        let isResolved = false;
        
        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                client.close();
                resolve({ method: 'UDP Heartbeat', status: 'timeout', port });
            }
        }, timeout);
        
        client.on('message', (msg) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timer);
                client.close();
                resolve({ method: 'UDP Heartbeat', status: 'alive', response: msg.toString() });
            }
        });
        
        client.on('error', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timer);
                client.close();
                resolve({ method: 'UDP Heartbeat', status: 'error' });
            }
        });
        
        // 发送心跳包
        client.send(Buffer.from('PING'), port, host);
    });
}

// 方法3: 文件锁检测（跨进程/共享存储）
function checkFileLockStatus(lockPath) {
    try {
        // 尝试获取文件锁
        const fd = fs.openSync(lockPath, 'wx');
        fs.closeSync(fd);
        
        // 如果成功创建，说明没有其他实例在运行
        fs.unlinkSync(lockPath);
        return { method: 'File Lock', status: 'no_other_instance' };
    } catch (err) {
        if (err.code === 'EEXIST') {
            return { method: 'File Lock', status: 'instance_running' };
        }
        return { method: 'File Lock', status: 'error', error: err.message };
    }
}

// 方法4: 环境变量/进程检测（同一主机）
function checkProcessStatus() {
    const platform = os.platform();
    const instances = [];
    
    // 获取当前进程信息
    instances.push({
        pid: process.pid,
        ppid: process.ppid,
        title: process.title,
        platform: platform
    });
    
    return { 
        method: 'Process Info', 
        status: 'detected', 
        current_process: instances[0],
        platform 
    };
}

// 方法5: 系统信号量检测
function checkSemaphoreStatus(name = 'instance_semaphore') {
    try {
        // Node.js 不直接支持信号量，但可以模拟
        const lockfile = `/tmp/${name}.lock`;
        const result = checkFileLockStatus(lockfile);
        return { method: 'Semaphore Simulation', ...result };
    } catch (error) {
        return { method: 'Semaphore', status: 'error', error: error.message };
    }
}

// 主测试函数
async function runResearch() {
    console.log('1. TCP端口检测:');
    try {
        // 检查常见端口（如Redis 6379）
        const tcpResult = await checkTCPStatus('127.0.0.1', 6379);
        console.log('   结果:', JSON.stringify(tcpResult));
    } catch (e) {
        console.log('   错误:', e.message);
    }
    
    console.log('\n2. UDP心跳检测:');
    try {
        const udpResult = await checkUDPStatus('127.0.0.1', 5555);
        console.log('   结果:', JSON.stringify(udpResult));
    } catch (e) {
        console.log('   错误:', e.message);
    }
    
    console.log('\n3. 文件锁检测:');
    const fileResult = checkFileLockStatus('/tmp/instance_lock_test');
    console.log('   结果:', JSON.stringify(fileResult));
    
    console.log('\n4. 进程信息检测:');
    const processResult = checkProcessStatus();
    console.log('   结果:', JSON.stringify(processResult));
    
    console.log('\n5. 信号量模拟检测:');
    const semResult = checkSemaphoreStatus();
    console.log('   结果:', JSON.stringify(semResult));
    
    // 总结
    console.log('\n=== 研究总结 ===');
    console.log('除了HTTP ping，检测姐妹实例状态的主要方式包括:');
    console.log('1. TCP端口检测 - 直接连接目标端口');
    console.log('2. UDP心跳 - 发送UDP包等待响应');
    console.log('3. 文件锁 - 通过创建/检测锁文件');
    console.log('4. 共享内存/信号量 - 使用系统信号量');
    console.log('5. 消息队列 - 通过Redis/RabbitMQ等中间件');
    console.log('6. 数据库记录 - 在共享DB中写入状态');
    console.log('7. Socket文件 - Unix域套接字');
    console.log('8. 第三方服务 - Consul/Etcd/Zookeeper');
}

// 运行研究
runResearch().catch(console.error);