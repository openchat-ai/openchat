// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:37:07.450Z

const cluster = require('cluster');
const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');

// 主进程负责协调
if (cluster.isMaster) {
    console.log('=== 实例间通讯方式研究 ===\n');
    
    const numCPUs = Math.min(2, os.cpus().length); // 限制数量便于演示
    const workers = [];
    
    // 创建工作进程
    for (let i = 0; i < numCPUs; i++) {
        const worker = cluster.fork();
        workers.push(worker);
    }
    
    let heartbeatCount = 0;
    let fileCheckCount = 0;
    let socketMsgCount = 0;
    
    // 监听工作进程消息
    workers.forEach((worker, index) => {
        worker.on('message', (msg) => {
            if (msg.type === 'heartbeat') {
                heartbeatCount++;
                console.log(`[主进程] 收到来自工作${index}的心跳 - 状态: ${msg.status}`);
            } else if (msg.type === 'fileStatus') {
                fileCheckCount++;
                console.log(`[主进程] 收到来自工作${index}的文件状态通知: ${msg.content}`);
            } else if (msg.type === 'socketMessage') {
                socketMsgCount++;
                console.log(`[主进程] 收到来自工作${index}的Socket消息: ${msg.data}`);
            }
        });
    });
    
    // 定期输出统计信息
    setInterval(() => {
        console.log('\n=== 当前通信统计 ===');
        console.log(`心跳通信次数: ${heartbeatCount}`);
        console.log(`文件通知次数: ${fileCheckCount}`);
        console.log(`Socket消息次数: ${socketMsgCount}`);
        console.log('==================\n');
    }, 3000);
    
    // 容错处理
    cluster.on('exit', (worker, code, signal) => {
        console.log(`工作进程 ${worker.process.pid} 退出，重启中...`);
        cluster.fork();
    });
    
} else {
    // 工作进程
    const workerId = cluster.worker.id;
    console.log(`工作进程 ${process.pid} 启动\n`);
    
    // 方法1: 集群内置的心跳机制 (IPC)
    console.log('[方式1] 使用Cluster内置IPC进行心跳检测');
    setInterval(() => {
        process.send({
            type: 'heartbeat',
            status: 'active',
            pid: process.pid,
            timestamp: Date.now()
        });
    }, 1500);
    
    // 方法2: 文件系统通知 (适合跨机器或持久化状态)
    console.log('[方式2] 使用文件系统进行状态通知');
    const statusFile = path.join(__dirname, `worker_${workerId}_status.txt`);
    
    setInterval(() => {
        try {
            fs.writeFileSync(statusFile, `active:${Date.now()}`);
            process.send({
                type: 'fileStatus',
                content: `更新状态文件: ${statusFile}`
            });
        } catch (err) {
            console.error('文件写入失败:', err.message);
        }
    }, 2000);
    
    // 方法3: Socket连接 (适合跨机器通讯)
    console.log('[方式3] 尝试Socket本地连接');
    const socketServer = net.createServer((socket) => {
        socket.write(`来自工作${workerId}的问候\n`);
        socket.on('data', (data) => {
            process.send({
                type: 'socketMessage',
                data: `收到来自Socket的消息: ${data.toString().trim()}`
            });
        });
    });
    
    socketServer.listen(0, () => {
        const port = socketServer.address().port;
        console.log(`Socket服务器启动，端口: ${port}`);
    });
    
    socketServer.on('error', (err) => {
        console.log('[方式3] Socket创建失败（可能端口被占用）:', err.message);
    });
}