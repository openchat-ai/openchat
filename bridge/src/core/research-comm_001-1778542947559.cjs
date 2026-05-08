// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:42:27.559Z

const fs = require('fs');
const path = require('path');
const process = require('process');

console.log('=== 实例间通信方式研究：姐妹状态检测 ===\n');

// 模拟多个实例的检测方式
const instanceId = process.argv[2] || 'instance-1';
const heartbeatFile = path.join(__dirname, `heartbeat-${instanceId}.txt`);

// 1. 进程信号检测 (Process Signal)
function checkProcessSignal(targetPid) {
    try {
        // 发送信号0，只检测进程是否存在
        process.kill(targetPid, 0);
        return { alive: true, method: 'process.signal' };
    } catch (err) {
        return { alive: false, method: 'process.signal', error: err.message };
    }
}

// 2. 文件锁检测 (File Locking)
function checkFileLock(lockFilePath) {
    try {
        const fd = fs.openSync(lockFilePath, 'w');
        fs.closeSync(fd);
        return { alive: true, method: 'file.lock', lockFile: lockFilePath };
    } catch (err) {
        return { alive: false, method: 'file.lock', error: err.message };
    }
}

// 3. 心跳文件检测 (Heartbeat File)
function checkHeartbeatFile(filePath, timeoutMs = 5000) {
    try {
        const stats = fs.statSync(filePath);
        const now = Date.now();
        const lastUpdate = stats.mtimeMs;
        const isAlive = (now - lastUpdate) < timeoutMs;
        return { 
            alive: isAlive, 
            method: 'heartbeat.file', 
            lastUpdate: new Date(lastUpdate).toISOString(),
            age: now - lastUpdate 
        };
    } catch (err) {
        return { alive: false, method: 'heartbeat.file', error: err.message };
    }
}

// 4. IPC 检查 (模拟)
function checkIPC(channelName) {
    // 在真实场景中，would 与目标进程通信
    return { 
        alive: true, 
        method: 'ipc', 
        note: '需要目标进程监听相同管道' 
    };
}

// 5. Socket 检查 (伪代码逻辑)
function checkSocket(port, host = 'localhost') {
    return { 
        alive: true, 
        method: 'socket.tcp', 
        note: `检查 ${host}:${port} 是否可连接` 
    };
}

// 6. Redis Key TTL 检测 (概念演示)
function checkRedisKey(keyName, ttlThreshold = 10) {
    return { 
        alive: true, 
        method: 'redis.key-ttl', 
        note: `检查 ${keyName} 的 TTL 是否 > ${ttlThreshold}秒` 
    };
}

// 运行演示
console.log('1. 进程信号检测 (Process Signal):');
console.log('   - 发送信号0给目标PID，判断进程是否存在');
console.log('   - 优点：轻量、系统级');
console.log('   - 缺点：需要知道PID，且跨平台差异\n');

console.log('2. 文件锁检测 (File Locking):');
const lockResult = checkFileLock(heartbeatFile + '.lock');
console.log('   结果:', lockResult);
console.log('   - 优点：简单、跨进程');
console.log('   - 缺点：文件系统依赖，需处理锁释放\n');

console.log('3. 心跳文件检测 (Heartbeat File):');
fs.writeFileSync(heartbeatFile, Date.now().toString());
const heartbeatResult = checkHeartbeatFile(heartbeatFile);
console.log('   结果:', heartbeatResult);
console.log('   - 优点：容错性好、可超时');
console.log('   - 缺点：文件I/O开销、需定期更新\n');

console.log('4. IPC 检查 (Inter-Process Communication):');
console.log('   结果:', checkIPC('sister-status'));
console.log('   - 优点：实时、双向');
console.log('   - 缺点：需预先建立通信通道\n');

console.log('5. Socket 检查 (TCP/Unix Socket):');
console.log('   结果:', checkSocket(3001));
console.log('   - 优点：通用、可扩展');
console.log('   - 缺点：需监听端口\n');

console.log('6. Redis Key TTL 检测:');
console.log('   结果:', checkRedisKey('instance:heartbeat'));
console.log('   - 优点：分布式支持、自动过期');
console.log('   - 缺点：需额外依赖Redis\n');

// 清理
setTimeout(() => {
    try {
        fs.unlinkSync(heartbeatFile);
        fs.unlinkSync(heartbeatFile + '.lock');
        console.log('\n=== 清理完成 ===');
    } catch (e) {
        console.log('\n=== 清理失败:', e.message);
    }
}, 100);