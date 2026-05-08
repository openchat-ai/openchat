// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:45:26.164Z

const cluster = require('cluster');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const os = require('os');

// 研究主题：实例间通讯方式研究（Beyond HTTP Ping）
console.log('=== 实例间通讯方式研究 ===\n');

// 1. 共享文件系统进行状态检测
function createFileBasedHealthCheck(filePath) {
    return {
        updateStatus: (status) => {
            const data = {
                pid: process.pid,
                status: status,
                timestamp: Date.now(),
                hostname: os.hostname()
            };
            fs.writeFileSync(filePath, JSON.stringify(data));
        },
        checkStatus: () => {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return data;
            } catch (e) {
                return null;
            }
        }
    };
}

// 2. 本地Socket进行心跳通讯
function createSocketHealthCheck(port) {
    let server = null;
    let clients = [];

    function startServer(callback) {
        server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const message = data.toString().trim();
                if (message === 'HEARTBEAT') {
                    socket.write(JSON.stringify({ 
                        type: 'HEARTBEAT_RESPONSE',
                        pid: process.pid,
                        timestamp: Date.now()
                    }) + '\n');
                }
            });
        });

        server.listen(port, () => {
            console.log(`[Socket] 实例 ${process.pid} 监听于端口 ${port}`);
            if (callback) callback();
        });
    }

    function sendHeartbeat(targetPort, callback) {
        const client = net.connect(targetPort, () => {
            client.write('HEARTBEAT\n');
            client.on('data', (data) => {
                const response = JSON.parse(data.toString());
                callback(null, response);
                client.end();
            });
        });

        client.on('error', (err) => {
            callback(err, null);
        });
    }

    return { startServer, sendHeartbeat };
}

// 3. 事件发射器进行内核通信（Cluster模式下使用）
function createClusterEventBus() {
    if (cluster.isPrimary) {
        const workers = [];
        return {
            addWorker: (worker) => workers.push(worker),
            broadcast: (message) => {
                workers.forEach(w => w.send(message));
            }
        };
    } else {
        process.on('message', (msg) => {
            console.log(`[Cluster] 工作进程 ${process.pid} 收到消息:`, msg);
        });
        return {
            send: (msg) => process.send(msg)
        };
    }
}

// 4. 信号量方式进行状态通知
function setupSignalHandler() {
    process.on('SIGUSR1', () => {
        console.log(`[Signal] 实例 ${process.pid} 收到状态查询信号`);
        process.send && process.send({ type: 'STATUS_RESPONSE', status: 'OK' });
    });
}

// 5. 主函数：演示不同通讯方式
async function main() {
    const healthFile = path.join('/tmp', `health_${process.pid}.json`);
    const socketPort = 9999 + (process.pid % 100);

    // 创建文件健康检查
    const fileHealth = createFileBasedHealthCheck(healthFile);
    fileHealth.updateStatus('RUNNING');

    // 创建Socket健康检查
    const socketHealth = createSocketHealthCheck(socketPort);

    if (cluster.isPrimary) {
        console.log('[Primary] 启动集群测试...\n');
        
        // 启动工作进程
        const worker1 = cluster.fork();
        const worker2 = cluster.fork();
        
        // 设置事件总线
        const eventBus = createClusterEventBus();
        eventBus.addWorker(worker1);
        eventBus.addWorker(worker2);

        // 测试集群通信
        setTimeout(() => {
            console.log('\n[Primary] 发送集群广播消息...');
            eventBus.broadcast({ type: 'CLUSTER_STATUS', data: '所有节点正常' });
        }, 2000);

        // 测试文件状态检测
        setTimeout(() => {
            console.log('\n[Primary] 检查文件状态:');
            const status1 = fileHealth.checkStatus();
            console.log('  工作进程1状态:', status1);
        }, 1000);

    } else {
        // 工作进程
        setupSignalHandler();
        
        socketHealth.startServer(() => {
            console.log(`[Worker] 工作进程 ${process.pid} 就绪`);
            
            // 更新文件状态
            fileHealth.updateStatus('WORKER_RUNNING');
            
            // 模拟状态查询
            setTimeout(() => {
                console.log(`\n[Worker ${process.pid}] 当前状态:`, fileHealth.checkStatus());
            }, 1500);
        });

        // 集群消息监听
        if (process.env.TEST_BROADCAST) {
            process.on('message', (msg) => {
                console.log(`[Worker ${process.pid}] 收到广播:`, msg);
            });
        }
    }

    // 清理
    process.on('exit', () => {
        try { fs.unlinkSync(healthFile); } catch (e) {}
    });
}

// 运行主函数
main().catch(console.error);