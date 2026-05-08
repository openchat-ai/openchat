// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:16:49.708Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究目标：探索多种检测"姐妹实例"状态的方式
 * 
 * 通讯方式分类：
 * 1. 基于TCP的检测
 * 2. 基于消息队列的检测
 * 3. 基于服务发现的检测
 * 4. 基于共享存储的检测
 * 5. 基于UDP的检测
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');
const { EventEmitter: EventEmitter2 } = require('events');

// 模拟实例信息
const instances = [
    { id: 'instance-1', host: '127.0.0.1', port: 8001, status: 'unknown' },
    { id: 'instance-2', host: '127.0.0.1', port: 8002, status: 'unknown' },
    { id: 'instance-3', host: '127.0.0.1', port: 8003, status: 'unknown' }
];

console.log('='.repeat(60));
console.log('实例间通讯方式研究：状态检测方法');
console.log('='.repeat(60));

// ============================================================
// 方式1: TCP端口检测 (TCP Handshake)
// ============================================================
class TCPHealthCheck {
    constructor(instance) {
        this.instance = instance;
    }

    check() {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = 3000;

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                socket.destroy();
                resolve({ method: 'TCP', instance: this.instance.id, status: 'alive', latency: '<3ms' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ method: 'TCP', instance: this.instance.id, status: 'dead', latency: 'timeout' });
            });

            socket.on('error', (err) => {
                resolve({ method: 'TCP', instance: this.instance.id, status: 'dead', error: err.message });
            });

            socket.connect(this.instance.port, this.instance.host);
        });
    }
}

// ============================================================
// 方式2: 自定义TCP协议 (带心跳)
// ============================================================
class TCPCustomProtocol extends EventEmitter {
    constructor(port) {
        super();
        this.port = port;
        this.server = null;
        this.clients = new Map();
    }

    start() {
        this.server = net.createServer((socket) => {
            const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
            console.log(`[TCP协议] 新客户端连接: ${clientId}`);
            
            this.clients.set(clientId, { socket, lastHeartbeat: Date.now() });

            socket.on('data', (data) => {
                const msg = data.toString();
                if (msg === 'PING') {
                    socket.write('PONG');
                    this.clients.get(clientId).lastHeartbeat = Date.now();
                }
            });

            socket.on('close', () => {
                this.clients.delete(clientId);
                this.emit('clientDisconnected', clientId);
            });
        });

        this.server.listen(this.port, () => {
            console.log(`[TCP协议] 服务启动在端口 ${this.port}`);
        });
    }

    async checkClient(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return { status: 'dead' };
        
        const timeSinceHeartbeat = Date.now() - client.lastHeartbeat;
        return {
            status: timeSinceHeartbeat < 10000 ? 'alive' : 'stale',
            lastHeartbeat: timeSinceHeartbeat + 'ms ago'
        };
    }

    stop() {
        if (this.server) this.server.close();
    }
}

// ============================================================
// 方式3: UDP广播检测
// ============================================================
class UDPDiscovery {
    constructor(broadcastPort = 41234) {
        this.port = broadcastPort;
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true };
        this.knownInstances = new Map();
    }

    start() {
        this.socket.bind(this.port, () => {
            this.socket.setBroadcast(true);
            console.log(`[UDP] 监听端口 ${this.port}`);
        });

        this.socket.on('message', (msg, rinfo) => {
            const data = JSON.parse(msg.toString());
            this.knownInstances.set(rinfo.address, {
                ...data,
                lastSeen: Date.now()
            });
            console.log(`[UDP] 收到实例广播: ${data.instanceId} from ${rinfo.address}:${rinfo.port}`);
        });
    }

    broadcast(instanceInfo) {
        const message = Buffer.from(JSON.stringify(instanceInfo));
        this.socket.send(message, 0, message.length, this.port, '255.255.255.255');
    }

    getInstances() {
        const now = Date.now();
        const result = {};
        this.knownInstances.forEach((info, addr) => {
            result[info.instanceId] = {
                address: addr,
                status: now - info.lastSeen < 5000 ? 'alive' : 'stale',
                lastSeen: info.lastSeen
            };
        });
        return result;
    }

    stop() {
        this.socket.close();
    }
}

// ============================================================
// 方式4: 基于Redis的状态共享 (模拟)
// ============================================================
class RedisStatusRegistry {
    constructor() {
        // 模拟Redis存储
        this.store = new Map();
        this.subscribers = new Map();
    }

    // 模拟发布
    async publish(channel, message) {
        const subscribers = this.subscribers.get(channel) || [];
        subscribers.forEach(callback => callback(message));
    }

    // 模拟订阅
    subscribe(channel, callback) {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, []);
        }
        this.subscribers.get(channel).push(callback);
    }

    // 模拟Redis SET
    async set(key, value) {
        this.store.set(key, { value, timestamp: Date.now() });
        // 模拟发布通知
        await this.publish(`__keyspace@0__:${key}`, 'set');
    }

    // 模拟Redis GET
    async get(key) {
        return this.store.get(key);
    }

    // 注册实例状态
    async registerInstance(instanceId, status) {
        await this.set(`instance:${instanceId}:status`, status);
        await this.set(`instance:${instanceId}:heartbeat`, Date.now());
        console.log(`[Redis] 注册实例 ${instanceId}: ${status}`);
    }

    // 获取所有实例状态
    async getAllInstances() {
        const result = {};
        for (const [key, data] of this.store) {
            if (key.startsWith('instance:') && key.endsWith(':status')) {
                const instanceId = key.split(':')[1];
                const heartbeat = await this.get(`instance:${instanceId}:heartbeat`);
                result[instanceId] = {
                    status: data.value,
                    lastHeartbeat: heartbeat ? heartbeat.timestamp : null,
                    age: Date.now() - (heartbeat?.timestamp || 0)
                };
            }
        }
        return result;
    }
}

// ============================================================
// 方式5: 基于gRPC的健康检查 (模拟)
// ============================================================
class GRPCHealthSimulator {
    constructor() {
        this.services = new Map();
    }

    // 模拟gRPC健康检查协议
    async checkHealth(instance) {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        return {
            method: 'gRPC Health Check',
            instance: instance.id,
            status: Math.random() > 0.3 ? 'SERVING' : 'NOT_SERVING',
            timestamp: Date.now()
        };
    }

    // 模拟流式健康检查
    *streamHealthChecks(instances) {
        for (const instance of instances) {
            yield this.checkHealth(instance);
        }
    }
}

// ============================================================
// 方式6: 基于数据库的状态表
// ============================================================
class DatabaseStatusTable {
    constructor() {
        // 模拟数据库表
        this.table = [];
    }

    async heartbeat(instanceId) {
        const existing = this.table.find(r => r.instance_id === instanceId);
        if (existing) {
            existing.last_heartbeat = new Date();
            existing.status = 'alive';
        } else {
            this.table.push({
                instance_id: instanceId,
                status: 'alive',
                last_heartbeat: new Date(),
                created_at: new Date()
            });
        }
        console.log(`[数据库] 实例 ${instanceId} 发送心跳`);
    }

    async getStatus(instanceId) {
        const record = this.table.find(r => r.instance_id === instanceId);
        if (!record) return { status: 'unknown' };
        
        const timeSinceHeartbeat = Date.now() - record.last_heartbeat.getTime();
        return {
            ...record,
            isStale: timeSinceHeartbeat > 10000,
            timeSinceHeartbeat
        };
    }

    async getAllStatus() {
        return this.table.map(r => ({
            ...r,
            isStale: Date.now() - r.last_heartbeat.getTime() > 10000
        }));
    }
}

// ============================================================
// 主研究程序
// ============================================================
async function runResearch() {
    console.log('\n📡 开始研究各种实例间通讯方式...\n');

    // 1. TCP端口检测演示
    console.log('--- 方式1: TCP端口检测 ---');
    const tcpCheck = new TCPHealthCheck({ host: '127.0.0.1', port: 80 };
    const tcpResult = await tcpCheck.check();
    console.log('结果:', tcpResult);
    console.log('原理: 尝试建立TCP连接，成功即表示实例存活\n');

    // 2. 自定义TCP协议
    console.log('--- 方式2: 自定义TCP协议 (心跳) ---');
    const tcpProtocol = new TCPCustomProtocol(9001);
    tcpProtocol.start();
    
    // 模拟客户端连接
    const clientSocket = new net.Socket();
    clientSocket.connect(9001, '127.0.0.1', () => {
        console.log('[模拟] 客户端已连接');
        // 发送心跳
        setInterval(() => clientSocket.write('PING'), 1000);
    });
    
    clientSocket.on('data', (data) => {
        if (data.toString() === 'PONG') {
            console.log('[模拟] 收到PONG响应');
        }
    });

    await new Promise(r => setTimeout(r, 1500));
    tcpProtocol.stop();
    console.log('原理: 维护持久TCP连接，通过PING/PONG心跳检测状态\n');

    // 3. UDP广播
    console.log('--- 方式3: UDP广播发现 ---');
    const udp = new UDPDiscovery(41235);
    udp.start();
    
    // 模拟广播
    setTimeout(() => {
        udp.broadcast({ instanceId: 'instance-1', version: '1.0.0' });
    }, 500);
    
    await new Promise(r => setTimeout(r, 1000));
    console.log('发现的实例:', udp.getInstances());
    udp.stop();
    console.log('原理: 通过UDP广播宣告自身存在，其他实例监听并记录\n');

    // 4. Redis状态共享
    console.log('--- 方式4: Redis/消息队列状态共享 ---');
    const redis = new RedisStatusRegistry();
    
    // 订阅状态变化
    redis.subscribe('instance:status', (msg) => {
        console.log(`[订阅] 收到状态变更通知: ${msg}`);
    });
    
    await redis.registerInstance('instance-1', 'healthy');
    await redis.registerInstance('instance-2', 'healthy');
    await new Promise(r => setTimeout(r, 100));
    
    const allInstances = await redis.getAllInstances();
    console.log('所有实例状态:', JSON.stringify(allInstances, null, 2));
    console.log('原理: 通过Redis Pub/Sub或Keyspace通知实现状态同步\n');

    // 5. gRPC健康检查
    console.log('--- 方式5: gRPC健康检查协议 ---');
    const grpc = new GRPCHealthSimulator();
    const grpcResults = [];
    
    for (const instance of instances) {
        const result = await grpc.checkHealth(instance);
        grpcResults.push(result);
    }
    console.log('gRPC健康检查结果:', grpcResults);
    console.log('原理: 使用gRPC标准健康检查协议，支持流式检查\n');

    // 6. 数据库状态表
    console.log('--- 方式6: 数据库状态表 ---');
    const db = new DatabaseStatusTable();
    
    await db.heartbeat('instance-1');
    await db.heartbeat('instance-2');
    await db.heartbeat('instance-3');
    
    const dbStatus = await db.getAllStatus();
    console.log('数据库状态表:', dbStatus);
    console.log('原理: 所有实例定期更新数据库中的状态记录\n');

    // 总结
    console.log('\n' + '='.repeat(60));
    console.log('📊 研究总结: 实例间状态检测方式对比');
    console.log('='.repeat(60));
    
    const summary = `
┌─────────────────┬──────────┬─────────┬────────────┬─────────────┐
│ 检测方式        │ 延迟     │ 可靠性   │ 资源开销   │ 适用场景    │
├─────────────────┼──────────┼─────────┼────────────┼─────────────┤
│ HTTP Ping       │ 中等     │ 高      │ 中等       │ 通用        │
│ TCP端口检测     │ 低       │ 高      │ 低         │ 快速检测    │
│ TCP心跳协议     │ 很低     │ 很高    │ 低         │ 持久连接    │
│ UDP广播         │ 很低     │ 低      │ 很低       │ 服务发现    │
│ Redis Pub/Sub   │ 低       │ 高      │ 中等       │ 分布式      │
│ Redis Keyspace  │ 低       │ 高      │ 中等       │ 状态同步    │
│ gRPC Health     │ 低       │ 高      │ 中等       │ 微服务      │
│ 数据库状态表    │ 中等     │ 高      │ 中等       │ 强一致性    │
│ Consul/Etcd     │ 低       │ 很高    │ 中等       │ 服务发现    │
│ WebSocket       │ 很低     │ 高      │ 中等       │ 实时通信    │
└─────────────────┴──────────┴─────────┴────────────┴─────────────┘

💡 关键发现:
1. TCP方式比HTTP更轻量，适合高频检测
2. Redis适合多实例状态同步和事件通知
3. 服务发现工具(Consul/Etcd)提供完整解决方案
4. 组合使用多种方式可以提高可靠性
    `;
    
    console.log(summary);
}

// 运行研究
runResearch().catch(console.error);