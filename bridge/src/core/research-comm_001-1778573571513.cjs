// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:12:51.513Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究的检测方式：
 * 1. TCP Socket 连接检测
 * 2. Redis Pub/Sub 心跳机制
 * 3. 共享内存/数据库状态标记
 * 4. 进程间通信(IPC)
 * 5. WebSocket 长连接
 */

const net = require('net');
const EventEmitter = require('events');
const { createClient } = require('redis');

// ==================== 模拟工具类 ====================

class InstanceSimulator extends EventEmitter {
    constructor(id, port) {
        super();
        this.id = id;
        this.port = port;
        this.status = 'offline';
        this.lastHeartbeat = Date.now();
    }

    start() {
        this.status = 'online';
        console.log(`[实例 ${this.id}] 已启动，端口: ${this.port}`);
    }

    stop() {
        this.status = 'offline';
        console.log(`[实例 ${this.id}] 已停止`);
    }

    heartbeat() {
        this.lastHeartbeat = Date.now();
        this.status = 'online';
    }
}

// ==================== 方式1: TCP Socket 检测 ====================

class TCPDetector {
    constructor(port) {
        this.port = port;
        this.server = null;
        this.clients = new Map();
    }

    start() {
        return new Promise((resolve) => {
            this.server = net.createServer((socket) => {
                const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
                console.log(`[TCP] 新连接: ${clientId}`);
                
                this.clients.set(clientId, { socket, lastPing: Date.now() });

                socket.on('data', (data) => {
                    const msg = data.toString();
                    if (msg === 'PING') {
                        socket.write('PONG');
                        const client = this.clients.get(clientId);
                        if (client) client.lastPing = Date.now();
                    }
                });

                socket.on('close', () => {
                    console.log(`[TCP] 连接关闭: ${clientId}`);
                    this.clients.delete(clientId);
                });

                socket.on('error', (err) => {
                    console.log(`[TCP] 错误: ${err.message}`);
                });
            });

            this.server.listen(this.port, () => {
                console.log(`[TCP] 检测服务启动在端口 ${this.port}`);
                resolve();
            });
        });
    }

    async checkPeer(host, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let responded = false;

            const timeout = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    socket.destroy();
                    resolve({ alive: false, latency: null });
                }
            }, 3000);

            socket.connect(port, host, () => {
                socket.write('PING');
            });

            socket.on('data', (data) => {
                if (data.toString() === 'PONG' && !responded) {
                    responded = true;
                    clearTimeout(timeout);
                    socket.destroy();
                    resolve({ alive: true, latency: Date.now() });
                }
            });

            socket.on('error', () => {
                if (!responded) {
                    responded = true;
                    clearTimeout(timeout);
                    resolve({ alive: false, latency: null });
                }
            });
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('[TCP] 检测服务已停止');
        }
    }
}

// ==================== 方式2: Redis Pub/Sub 心跳机制 ====================

class RedisHeartbeat {
    constructor(instanceId, redisUrl) {
        this.instanceId = instanceId;
        this.redisUrl = redisUrl;
        this.client = null;
        this.subscriber = null;
        this.instances = new Map();
        this.heartbeatInterval = null;
    }

    async start() {
        try {
            this.client = createClient({ url: this.redisUrl };
            this.subscriber = this.client.duplicate();
            
            await this.client.connect();
            await this.subscriber.connect();
            
            console.log('[Redis] 连接成功');

            // 订阅心跳频道
            await this.subscriber.subscribe('instance-heartbeat', (message) => {
                const data = JSON.parse(message);
                this.instances.set(data.instanceId, {
                    ...data,
                    lastSeen: Date.now()
                });
            });

            // 定期发布自己的心跳
            this.heartbeatInterval = setInterval(async () => {
                await this.client.publish('instance-heartbeat', JSON.stringify({
                    instanceId: this.instanceId,
                    status: 'online',
                    timestamp: Date.now()
                }));
            }, 2000);

            // 定期清理超时实例
            setInterval(() => {
                const now = Date.now();
                for (const [id, data] of this.instances) {
                    if (now - data.lastSeen > 10000) {
                        console.log(`[Redis] 实例 ${id} 已离线 (超时)`);
                        this.instances.delete(id);
                    }
                }
            }, 5000);

            console.log('[Redis] 心跳机制已启动');
        } catch (err) {
            console.log('[Redis] 连接失败:', err.message);
        }
    }

    getInstances() {
        return Array.from(this.instances.entries()).map(([id, data]) => ({
            instanceId: id,
            ...data
        }));
    }

    async stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.client) {
            await this.client.quit();
        }
        if (this.subscriber) {
            await this.subscriber.quit();
        }
        console.log('[Redis] 已停止');
    }
}

// ==================== 方式3: 共享状态检测(模拟数据库) ====================

class SharedStateDetector {
    constructor() {
        // 模拟共享存储
        this.sharedState = new Map();
        this.cleanupInterval = null;
    }

    // 模拟实例注册
    register(instanceId, metadata = {}) {
        this.sharedState.set(instanceId, {
            instanceId,
            status: 'online',
            registeredAt: Date.now(),
            lastUpdate: Date.now(),
            metadata
        });
        console.log(`[共享状态] 实例 ${instanceId} 已注册`);
    }

    // 模拟实例更新状态
    update(instanceId, status) {
        const instance = this.sharedState.get(instanceId);
        if (instance) {
            instance.status = status;
            instance.lastUpdate = Date.now();
        }
    }

    // 获取所有实例状态
    getAllInstances() {
        const now = Date.now();
        const instances = [];

        for (const [id, data] of this.sharedState) {
            // 超过30秒认为离线
            const isAlive = (now - data.lastUpdate) < 30000;
            instances.push({
                instanceId: id,
                status: isAlive ? data.status : 'offline',
                lastUpdate: data.lastUpdate,
                metadata: data.metadata
            });
        }

        return instances;
    }

    // 启动模拟的实例健康检查
    startHealthCheck() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, data] of this.sharedState) {
                if (now - data.lastUpdate > 30000) {
                    console.log(`[共享状态] 实例 ${id} 标记为离线`);
                    data.status = 'offline';
                }
            }
        }, 10000);
    }

    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

// ==================== 方式4: WebSocket 长连接检测 ====================

class WebSocketDetector {
    constructor(port) {
        this.port = port;
        this.clients = new Set();
        // 简化实现，使用net模拟WebSocket
        this.server = null;
    }

    start() {
        return new Promise((resolve) => {
            this.server = net.createServer((socket) => {
                this.clients.add(socket);
                const clientId = `client-${this.clients.size}`;
                console.log(`[WebSocket] 新客户端: ${clientId}`);

                // 模拟WebSocket握手和心跳
                socket.on('data', (data) => {
                    const msg = data.toString();
                    if (msg.includes('GET /ws')) {
                        // 模拟WebSocket升级响应
                        socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
                    } else if (msg === 'HEARTBEAT') {
                        socket.write('HEARTBEAT_ACK');
                    }
                });

                socket.on('close', () => {
                    this.clients.delete(socket);
                    console.log(`[WebSocket] 客户端断开: ${clientId}`);
                });
            });

            this.server.listen(this.port, () => {
                console.log(`[WebSocket] 服务启动在端口 ${this.port}`);
                resolve();
            });
        });
    }

    // 向所有客户端广播消息
    broadcast(message) {
        for (const client of this.clients) {
            client.write(message);
        }
    }

    getClientCount() {
        return this.clients.size;
    }

    stop() {
        if (this.server) {
            this.server.close();
            for (const client of this.clients) {
                client.destroy();
            }
            console.log('[WebSocket] 已停止');
        }
    }
}

// ==================== 主程序：演示各种检测方式 ====================

async function main() {
    console.log('========================================');
    console.log('实例间通讯方式研究 - 状态检测方法对比');
    console.log('========================================\n');

    // 方式1: TCP Socket 检测演示
    console.log('--- 方式1: TCP Socket 连接检测 ---');
    const tcpDetector = new TCPDetector(7001);
    await tcpDetector.start();

    // 模拟检测远程实例
    const tcpResult = await tcpDetector.checkPeer('127.0.0.1', 7001);
    console.log(`[TCP] 检测结果: ${JSON.stringify(tcpResult)}`);
    console.log('原理: 通过TCP握手和PING/PONG消息检测连接状态\n');

    // 方式2: Redis Pub/Sub 心跳演示
    console.log('--- 方式2: Redis Pub/Sub 心跳机制 ---');
    const redisHeartbeat = new RedisHeartbeat('instance-1', 'redis://localhost:6379');
    
    // 由于可能没有Redis，我们模拟演示
    console.log('[模拟] Redis心跳机制工作流程:');
    console.log('  1. 每个实例定期(例如每2秒)向Redis频道发布心跳');
    console.log('  2. 所有实例订阅该频道，接收其他实例的心跳');
    console.log('  3. 如果某个实例超过阈值时间(如10秒)未收到心跳，标记为离线');
    console.log('优点: 支持跨机器、跨网络，无需开放端口\n');

    // 方式3: 共享状态检测演示
    console.log('--- 方式3: 共享状态(数据库/Redis键)检测 ---');
    const sharedState = new SharedStateDetector();
    sharedState.startHealthCheck();

    // 模拟实例注册
    sharedState.register('service-a', { ip: '192.168.1.10', port: 3000 });
    sharedState.register('service-b', { ip: '192.168.1.11', port: 3001 });

    // 模拟状态更新
    setTimeout(() => {
        sharedState.update('service-a', 'busy');
    }, 1000);

    // 查看状态
    setTimeout(() => {
        const instances = sharedState.getAllInstances();
        console.log('[共享状态] 当前实例列表:', JSON.stringify(instances, null, 2));
    }, 2000);

    console.log('原理: 通过共享存储(数据库/Redis)记录实例状态，定期更新和检查\n');

    // 方式4: WebSocket 长连接演示
    console.log('--- 方式4: WebSocket 长连接检测 ---');
    const wsDetector = new WebSocketDetector(7002);
    await wsDetector.start();

    // 模拟客户端连接
    const mockClient = new net.Socket();
    mockClient.connect(7002, '127.0.0.1', () => {
        mockClient.write('GET /ws HTTP/1.1\r\nHost: localhost\r\n\r\n');
    });
    mockClient.on('data', (data) => {
        console.log('[WebSocket] 收到响应:', data.toString().trim());
    });

    setTimeout(() => {
        console.log(`[WebSocket] 当前连接数: ${wsDetector.getClientCount()}`);
        console.log('原理: 保持长连接，通过心跳帧维持连接，连接断开即认为实例离线\n');
    }, 1000);

    // 方式5: 其他方式总结
    console.log('--- 方式5: 其他检测方式总结 ---');
    console.log(`
┌─────────────────────┬────────────────────────────────────────────┐
│       方式          │                   说明                      │
├─────────────────────┼────────────────────────────────────────────┤
│ HTTP/HTTPS Ping     │ 最常见，通过HTTP请求检测，负载均衡器常用    │
│ TCP Socket          │ 更轻量，无需HTTP开销，适合高并发场景       │
│ WebSocket           │ 双向通信，支持实时推送，适合需要推送的场景 │
│ gRPC健康检查        │ 基于HTTP/2，支持流式，适合微服务架构       │
│ Redis Pub/Sub       │ 分布式环境，无需开放每个实例端口           │
│ Consul/Etcd         │ 服务发现+健康检查，功能全面               │
│ 数据库状态表        │ 简单可靠，适合有共享数据库的场景           │
│ UDP广播/多播        │ 局域网快速发现，但不可靠                    │
│ MQTT/NATS           │ 消息队列方式，适合IoT和实时场景           │
│ 自定义二进制协议    │ 最高性能，但开发和维护成本高              │
└─────────────────────┴────────────────────────────────────────────┘
    `);

    // 清理
    setTimeout(() => {
        tcpDetector.stop();
        wsDetector.stop();
        sharedState.stop();
        console.log('\n[研究完成] 所有演示服务已停止');
        process.exit(0);
    }, 5000);
}

// 运行主程序
main().catch(console.error);