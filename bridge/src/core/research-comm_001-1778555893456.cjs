// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:18:13.456Z

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 方法1: 使用 child_process.fork() 消息传递
function demonstrateForkMessaging() {
    console.log('1. Fork 消息传递方式:');
    
    // 主进程创建子进程
    const child = childProcess.fork(__filename, ['child']);
    
    // 子进程发送心跳
    if (process.argv.includes('child')) {
        const heartbeat = () => {
            process.send({ type: 'heartbeat', timestamp: Date.now() });
            setTimeout(heartbeat, 2000);
        };
        heartbeat();
        return;
    }
    
    // 主进程接收心跳
    let lastHeartbeat = 0;
    child.on('message', (msg) => {
        if (msg.type === 'heartbeat') {
            lastHeartbeat = msg.timestamp;
            console.log(`  收到子进程心跳: ${new Date(msg.timestamp).toISOString()}`);
        }
    });
    
    // 检查子进程状态
    setInterval(() => {
        const now = Date.now();
        const timeDiff = now - lastHeartbeat;
        if (timeDiff > 5000) {
            console.log(`  警告: 子进程可能已死亡 (无心跳 ${Math.floor(timeDiff/1000)}s)`);
        } else {
            console.log(`  子进程状态正常 (最近心跳 ${Math.floor(timeDiff/1000)}s前)`);
        }
    }, 3000);
    
    // 清理
    setTimeout(() => {
        child.kill();
        console.log('\n--- Fork演示结束 ---\n');
        demonstrateFileLocking();
    }, 10000);
}

// 方法2: 文件锁 signaling
function demonstrateFileLocking() {
    console.log('2. 文件锁方式:');
    const lockFile = path.join(__dirname, 'process.lock');
    const pid = process.pid;
    
    try {
        // 创建锁文件
        fs.writeFileSync(lockFile, pid.toString());
        console.log(`  创建锁文件, PID: ${pid}`);
        
        // 检查锁文件是否存在
        setInterval(() => {
            if (fs.existsSync(lockFile)) {
                const content = fs.readFileSync(lockFile, 'utf8');
                console.log(`  检查发现: 进程 ${content} 仍在运行`);
            } else {
                console.log('  检测到: 进程已退出, 锁文件消失');
            }
        }, 2000);
        
        // 模拟进程退出
        setTimeout(() => {
            fs.unlinkSync(lockFile);
            console.log(`  移除锁文件, 进程 ${pid} 退出`);
            console.log('\n--- 文件锁演示结束 ---\n');
            demonstrateSocketHeartbeat();
        }, 8000);
    } catch (err) {
        console.error('文件锁错误:', err.message);
    }
}

// 方法3: Socket 心跳
function demonstrateSocketHeartbeat() {
    console.log('3. Socket 心跳方式:');
    
    const PORT = 55555;
    const server = net.createServer((socket) => {
        console.log('  子进程连接成功');
        
        const heartbeat = () => {
            socket.write(JSON.stringify({ type: 'heartbeat', pid: process.pid, time: Date.now() }) + '\n');
        };
        
        heartbeat();
        setInterval(heartbeat, 2000);
    });
    
    server.listen(PORT, () => {
        console.log(`  服务端监听端口 ${PORT}`);
        
        // 客户端连接
        const client = new net.Socket();
        client.connect(PORT, () => {
            console.log('  客户端连接成功');
        });
        
        let lastHeartbeat = 0;
        client.on('data', (data) => {
            const msg = JSON.parse(data.toString().trim());
            if (msg.type === 'heartbeat') {
                lastHeartbeat = msg.time;
                console.log(`  收到心跳: PID=${msg.pid}, 时间=${new Date(msg.time).toISOString()}`);
            }
        });
        
        // 状态检查
        setInterval(() => {
            const timeDiff = Date.now() - lastHeartbeat;
            console.log(`  连接状态: ${timeDiff < 5000 ? '正常' : '断开'} (无响应 ${Math.floor(timeDiff/1000)}s)`);
        }, 2000);
        
        // 清理
        setTimeout(() => {
            client.destroy();
            server.close();
            console.log('\n--- Socket演示结束 ---\n');
            demonstrateProcessSignals();
        }, 10000);
    });
}

// 方法4: 进程信号
function demonstrateProcessSignals() {
    console.log('4. 进程信号方式:');
    const targetPid = process.pid;
    
    console.log(`  当前进程PID: ${targetPid}`);
    console.log('  可以使用以下命令检测进程状态:');
    console.log(`    kill -0 ${targetPid}  # 检查进程是否存在`);
    console.log(`    ps -p ${targetPid}     # 查看进程详情`);
    
    // 模拟检测
    const checkProcess = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch (err) {
            return false;
        }
    };
    
    setInterval(() => {
        const isAlive = checkProcess(targetPid);
        console.log(`  检查PID ${targetPid}: ${isAlive ? '存活' : '死亡'}`);
    }, 2000);
    
    // 演示结束
    setTimeout(() => {
        console.log('\n--- 信号演示结束 ---');
        printSummary();
    }, 6000);
}

// 总结
function printSummary() {
    console.log('\n=== 总结: 实例间通讯方式 ===');
    console.log('1. child_process.fork() 消息: 双向通信, 实时状态');
    console.log('2. 文件锁: 简单可靠, 跨语言支持');
    console.log('3. Socket: 灵活, 可跨机器');
    console.log('4. 进程信号:  lightweight, 系统级检测');
    console.log('\n其他方式:');
    console.log('- Redis Pub/Sub: 跨机器消息传递');
    console.log('- 数据库轮询: 共享状态存储');
    console.log('- Unix Domain Socket: 高性能本地IPC');
    console.log('- Message Queue (MQ): 异步解耦');
}

// 运行演示
demonstrateForkMessaging();