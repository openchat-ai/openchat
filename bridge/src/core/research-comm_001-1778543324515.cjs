// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:48:44.515Z

/**
 * 实例间通讯方式研究：状态检测方法
 * 居民小明 - 代码专家
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

console.log('='.repeat(60));
console.log('实例间通讯方式研究 - 状态检测方法');
console.log('='.repeat(60));

// ============================================================
// 方法1: TCP 健康检查 (比HTTP更轻量)
// ============================================================
class TCPHealthChecker {
    constructor(port, host = '127.0.0.1') {
        this.port = port;
        this.host = host;
    }

    async check() {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 3000;

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                socket.destroy();
                resolve({ method: 'TCP', status: 'UP', latency: 0 });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ method: 'TCP', status: 'DOWN', reason: 'timeout' });
            });

            socket.on('error', (err) => {
                socket.destroy();
                resolve({ method: 'TCP', status: 'DOWN', reason: err.message });
            });

            socket.connect(this.port, this.host);
        });
    }
}

// ============================================================
// 方法2: UDP 心跳广播 (适合高频率健康检查)
// ============================================================
class UDPHeartbeat {
    constructor(broadcastPort = 41234) {
        this.port = broadcastPort;
        this.server = null;
        this.clients = new Map();
    }

    startServer(instanceId) {
        this.server = dgram.createSocket('udp4');
        
        this.server.on('message', (msg, rinfo) => {
            const data = JSON.parse(msg.toString());
            this.clients.set(rinfo.address, {
                ...data,
                lastSeen: Date.now()
            });
        });

        this.server.bind(this.port);
        this.instanceId = instanceId;
        
        // 定期广播自己的状态
        setInterval(() => {
            this.broadcast({ 
                instanceId: this.instanceId, 
                status: 'ALIVE',
                timestamp: Date.now() 
            });
        }, 2000);

        console.log(`[UDP] 心跳服务器启动在端口 ${this.port}`);
    }

    broadcast(data) {
        const message = Buffer.from(JSON.stringify(data));
        this.server.send(message, 0, message.length, this.port, '255.255.255.255');
    }

    getPeers() {
        return Array.from(this.clients.entries()).map(([ip, data]) => ({
            ip,
            ...data,
            alive: Date.now() - data.lastSeen < 10000
        }));
    }
}

// ============================================================
// 方法3: 服务发现 + 心跳 (模拟 Consul/Etcd)
// ============================================================
class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.heartbeatInterval = null;
    }

    // 模拟服务注册
    register(serviceName, address, port) {
        const service = {
            name: serviceName,
            address,
            port,
            status: 'healthy',
            registeredAt: Date.now(),
            lastHeartbeat: Date.now()
        };
        this.services.set(`${serviceName}:${address}`, service);
        console.log(`[ServiceRegistry] 注册服务: ${serviceName} at ${address}:${port}`);
        return service;
    }

    // 模拟健康检查
    async healthCheck(serviceName, address, port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);

            socket.on('connect', () => {
                socket.destroy();
                resolve({ status: 'healthy', method: 'TCP health check' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ status: 'unhealthy', reason: 'timeout' });
            });

            socket.on('error', (err) => {
                resolve({ status: 'unhealthy', reason: err.message });
            });

            socket.connect(port, address);
        });
    }

    // 获取所有活跃实例
    async getActiveInstances(serviceName) {
        const instances = [];
        for (const [key, service] of this.services) {
            if (service.name === serviceName) {
                const health = await this.healthCheck(service.name, service.address, service.port);
                instances.push({ ...service, health: health.status });
            }
        }
        return instances;
    }
}

// ============================================================
// 方法4: 共享状态存储 (Redis风格)
// ============================================================
class SharedStateStore {
    constructor() {
        // 模拟 Redis 存储
        this.store = new Map();
        
        // 模拟 Redis pub/sub
        this.subscribers = new Map();
    }

    // 设置实例状态
    setInstanceStatus(instanceId, status) {
        const key = `instance:${instanceId}`;
        this.store.set(key, {
            status,
            updatedAt: Date.now(),
            instanceId
        });
        
        // 模拟发布事件
        this.publish('instance_update', { instanceId, status });
    }

    // 获取实例状态
    getInstanceStatus(instanceId) {
        return this.store.get(`instance:${instanceId}`);
    }

    // 获取所有实例
    getAllInstances() {
        const instances = [];
        for (const [key, value] of this.store) {
            if (key.startsWith('instance:')) {
                instances.push(value);
            }
        }
        return instances;
    }

    // 模拟发布/订阅
    publish(channel, data) {
        const callbacks = this.subscribers.get(channel) || [];
        callbacks.forEach(cb => cb(data));
    }

    subscribe(channel, callback) {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, []);
        }
        this.subscribers.get(channel).push(callback);
    }
}

// ============================================================
// 方法5: WebSocket 长连接 (双向通信)
// ============================================================
class WebSocketHealthMonitor {
    constructor(port = 8080) {
        this.port = port;
        this.clients = new Set();
    }

    startServer() {
        // 简化实现：使用 net 服务器模拟 WebSocket 握手后的状态
        const server = net.createServer((socket) => {
            this.clients.add(socket);
            
            // 发送 ping 帧
            const pingInterval = setInterval(() => {
                if (!socket.destroyed) {
                    socket.write(Buffer.from([0x89, 0x00])); // 简化的 ping 帧
                }
            }, 5000);

            socket.on('data', (data) => {
                // 收到 pong 或其他响应
                if (data[0] === 0x8A) {
                    // 简化的 pong 响应
                }
            });

            socket.on('close', () => {
                this.clients.delete(socket);
                clearInterval(pingInterval);
            });

            socket.on('error', () => {
                this.clients.delete(socket);
            });
        });

        server.listen(this.port, () => {
            console.log(`[WebSocket] 模拟服务器启动在端口 ${this.port}`);
        });
    }

    getClientCount() {
        return this.clients.size;
    }
}

// ============================================================
// 演示和测试
// ============================================================
async function runDemo() {
    console.log('\n--- 开始演示各种实例间状态检测方法 ---\n');

    // 方法1: TCP 健康检查
    console.log('【方法1】TCP 健康检查');
    console.log('-'.repeat(40));
    const tcpChecker = new TCPHealthChecker(80, '127.0.0.1');
    const tcpResult = await tcpChecker.check();
    console.log('结果:', tcpResult);
    console.log('优点: 比HTTP更轻量，不需要完整的HTTP栈\n');

    // 方法2: UDP 心跳
    console.log('【方法2】UDP 心跳广播');
    console.log('-'.repeat(40));
    const udpHeartbeat = new UDPHeartbeat(41235);
    udpHeartbeat.startServer('instance-1');
    
    // 模拟接收其他实例的心跳
    setTimeout(() => {
        const mockPeer = { instanceId: 'instance-2', status: 'ALIVE', lastSeen: Date.now() };
        udpHeartbeat.clients.set('192.168.1.100', mockPeer);
        
        const peers = udpHeartbeat.getPeers();
        console.log('检测到的姐妹实例:', peers);
        console.log('优点: 低延迟，低开销，适合高频检测\n');
    }, 3000);

    // 方法3: 服务注册中心
    console.log('【方法3】服务注册中心模式');
    console.log('-'.repeat(40));
    const registry = new ServiceRegistry();
    registry.register('api-service', '192.168.1.10', 3000);
    registry.register('api-service', '192.168.1.11', 3000);
    registry.register('api-service', '192.168.1.12', 3000);
    
    const instances = await registry.getActiveInstances('api-service');
    console.log('活跃实例:', instances.length);
    console.log('优点: 集中管理，支持负载均衡\n');

    // 方法4: 共享状态存储
    console.log('【方法4】共享状态存储 (Redis风格)');
    console.log('-'.repeat(40));
    const stateStore = new SharedStateStore();
    
    // 模拟多个实例更新状态
    stateStore.setInstanceStatus('instance-A', 'healthy');
    stateStore.setInstanceStatus('instance-B', 'healthy');
    stateStore.setInstanceStatus('instance-C', 'unhealthy');
    
    // 订阅状态变化
    stateStore.subscribe('instance_update', (data) => {
        console.log(`[事件] 实例 ${data.instanceId} 状态变为 ${data.status}`);
    });
    
    console.log('所有实例状态:', stateStore.getAllInstances());
    console.log('优点: 支持状态持久化，可跨语言\n');

    // 方法5: WebSocket
    console.log('【方法5】WebSocket 长连接');
    console.log('-'.repeat(40));
    const wsMonitor = new WebSocketHealthMonitor(8089);
    wsMonitor.startServer();
    console.log('已连接客户端数:', wsMonitor.getClientCount());
    console.log('优点: 双向通信，实时性强\n');

    // 汇总
    console.log('='.repeat(60));
    console.log('研究结论汇总');
    console.log('='.repeat(60));
    
    const summary = `
┌─────────────────────────────────────────────────────────────┐
│                    状态检测方法对比                          │
├──────────────┬────────┬────────┬────────┬──────────────────┤
│ 方法          │ 开销   │ 实时性 │ 可靠性  │ 适用场景         │
├──────────────┼────────┼────────┼────────┼──────────────────┤
│ HTTP Ping     │ 中     │ 低     │ 高     │ 通用             │
│ TCP Connect   │ 低     │ 低     │ 中     │ 快速检测         │
│ UDP Heartbeat │ 极低   │ 高     │ 低     │ 高频检测         │
│ 服务注册中心  │ 中     │ 中     │ 高     │ 分布式系统       │
│ 共享存储      │ 中     │ 中     │ 高     │ 状态同步         │
│ WebSocket     │ 高     │ 极高   │ 高     │ 实时通信         │
│ gRPC          │ 低     │ 高     │ 高     │ 微服务           │
└──────────────┴────────┴────────┴────────┴──────────────────┘

推荐组合策略:
1. 服务注册中心 (Consul/Etcd) + TCP 健康检查
2. Redis Pub/Sub 做状态同步 + 定时健康检查
3. UDP 心跳做快速检测 + HTTP 做深度检查
    `;
    console.log(summary);
}

// 运行演示
runDemo().catch(console.error);