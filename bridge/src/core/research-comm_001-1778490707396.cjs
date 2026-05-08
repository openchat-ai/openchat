// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:11:47.396Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究的检测方式：
 * 1. TCP Socket 心跳检测
 * 2. Redis Pub/Sub 状态广播
 * 3. gRPC 健康检查
 * 4. UDP 广播发现
 * 5. 数据库状态表轮询
 */

const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');
const http = require('http');

// ============================================================
// 模拟工具类
// ============================================================

class Logger {
    static info(msg, data = {}) {
        console.log(`[${new Date().toISOString()}] [INFO] ${msg}`, data);
    }
    
    static success(msg, data = {}) {
        console.log(`[${new Date().toISOString()}] [✅ SUCCESS] ${msg}`, data);
    }
    
    static warn(msg, data = {}) {
        console.log(`[${new Date().toISOString()}] [⚠️  WARN] ${msg}`, data);
    }
    
    static error(msg, data = {}) {
        console.log(`[${new Date().toISOString()}] [❌ ERROR] ${msg}`, data);
    }
}

// 模拟实例
class MockInstance {
    constructor(id, port) {
        this.id = id;
        this.port = port;
        this.status = 'unknown';
        this.lastHeartbeat = null;
    }
    
    setStatus(status) {
        this.status = status;
        this.lastHeartbeat = new Date();
    }
}

// ============================================================
// 方法1: TCP Socket 心跳检测
// ============================================================

class TCPHeartbeatDetector extends EventEmitter {
    constructor(port) {
        super();
        this.port = port;
        this.server = null;
        this.clients = new Map(); // 存储连接的客户端
    }
    
    // 启动TCP服务器
    start() {
        this.server = net.createServer((socket) => {
            const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
            Logger.info(`[TCP] 新连接: ${clientId}`);
            
            // 接收心跳数据
            socket.on('data', (data) => {
                try {
                    const heartbeat = JSON.parse(data.toString());
                    this.clients.set(clientId, {
                        socket,
                        instanceId: heartbeat.instanceId,
                        lastBeat: Date.now()
                    });
                    this.emit('heartbeat', heartbeat);
                } catch (e) {
                    Logger.error('[TCP] 解析心跳数据失败', { error: e.message });
                }
            });
            
            socket.on('close', () => {
                Logger.warn(`[TCP] 连接关闭: ${clientId}`);
                this.clients.delete(clientId);
                this.emit('clientClose', clientId);
            });
            
            socket.on('error', (err) => {
                Logger.error(`[TCP] socket错误: ${err.message}`);
            });
        });
        
        this.server.listen(this.port, () => {
            Logger.success(`[TCP] 心跳服务器启动在端口 ${this.port}`);
        });
        
        return this;
    }
    
    // 客户端：发送心跳
    sendHeartbeat(instanceId, targetPort) {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            socket.connect(targetPort, '127.0.0.1', () => {
                const heartbeat = {
                    instanceId,
                    timestamp: Date.now(),
                    status: 'alive'
                };
                socket.write(JSON.stringify(heartbeat));
                socket.end();
                resolve();
            });
            
            socket.on('error', reject);
        });
    }
    
    // 获取所有活跃实例
    getActiveInstances() {
        const now = Date.now();
        const active = [];
        const timeout = 10000; // 10秒超时
        
        for (const [clientId, client] of this.clients) {
            if (now - client.lastBeat < timeout) {
                active.push(client.instanceId);
            }
        }
        return active;
    }
    
    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

// ============================================================
// 方法2: Redis Pub/Sub 状态广播 (模拟)
// ============================================================

class RedisPubSubDetector extends EventEmitter {
    constructor() {
        super();
        this.subscribers = new Map();
        this.channels = {
            HEARTBEAT: 'instance:heartbeat',
            STATUS: 'instance:status',
            DISCOVERY: 'instance:discovery'
        };
        // 模拟Redis存储
        this.messageStore = [];
    }
    
    // 模拟发布消息
    publish(channel, message) {
        const msg = {
            channel,
            data: message,
            timestamp: Date.now()
        };
        this.messageStore.push(msg);
        
        // 模拟广播给订阅者
        for (const [id, subscriber] of this.subscribers) {
            if (subscriber.channels.includes(channel)) {
                subscriber.callback(msg);
            }
        }
        
        this.emit('message', msg);
        return true;
    }
    
    // 模拟订阅
    subscribe(channels, callback) {
        const subscriberId = `sub_${Date.now()}`;
        this.subscribers.set(subscriberId, {
            channels: Array.isArray(channels) ? channels : [channels],
            callback
        });
        
        Logger.info(`[Redis Pub/Sub] 新订阅者: ${subscriberId}`);
        
        return () => {
            this.subscribers.delete(subscriberId);
        };
    }
    
    // 实例注册/心跳
    registerInstance(instance) {
        this.publish(this.channels.HEARTBEAT, {
            type: 'heartbeat',
            instanceId: instance.id,
            port: instance.port,
            status: 'online'
        });
    }
    
    // 广播实例状态变化
    broadcastStatus(instanceId, status) {
        this.publish(this.channels.STATUS, {
            type: 'status_change',
            instanceId,
            status,
            timestamp: Date.now()
        });
    }
    
    // 服务发现：查询所有在线实例
    discoverInstances() {
        return new Promise((resolve) => {
            const instances = [];
            const discoveryChannel = this.channels.DISCOVERY;
            
            // 发送发现请求
            this.publish(discoveryChannel, {
                type: 'discovery_request',
                requestId: Date.now()
            });
            
            // 收集响应（模拟）
            setTimeout(() => {
                // 从消息历史中提取实例
                const heartbeatMsgs = this.messageStore
                    .filter(m => m.channel === this.channels.HEARTBEAT)
                    .slice(-10);
                
                for (const msg of heartbeatMsgs) {
                    if (!instances.find(i => i.instanceId === msg.data.instanceId)) {
                        instances.push(msg.data);
                    }
                }
                resolve(instances);
            }, 100);
        });
    }
}

// ============================================================
// 方法3: gRPC 健康检查 (模拟)
// ============================================================

class GRPCHealthChecker extends EventEmitter {
    constructor() {
        super();
        this.services = new Map();
        this.healthStatus = new Map();
    }
    
    // 模拟gRPC健康检查协议
    // 实际实现需要 @grpc/grpc-js 和 proto 定义
    
    // 注册服务
    registerService(serviceName, handlers) {
        this.services.set(serviceName, {
            handlers,
            registeredAt: Date.now()
        });
        
        Logger.info(`[gRPC] 服务注册: ${serviceName}`);
    }
    
    // 模拟健康检查调用
    async checkHealth(serviceName) {
        const service = this.services.get(serviceName);
        
        if (!service) {
            return {
                status: 'SERVICE_UNKNOWN',
                message: `Service ${serviceName} not found`
            };
        }
        
        try {
            // 模拟调用健康检查处理器
            if (service.handlers.healthCheck) {
                const result = await service.handlers.healthCheck();
                this.healthStatus.set(serviceName, {
                    status: 'SERVING',
                    lastCheck: Date.now(),
                    result
                });
                return { status: 'SERVING', ...result };
            }
            
            return { status: 'SERVING', message: 'OK' };
        } catch (error) {
            this.healthStatus.set(serviceName, {
                status: 'NOT_SERVING',
                lastCheck: Date.now(),
                error: error.message
            });
            return { status: 'NOT_SERVING', error: error.message };
        }
    }
    
    // 批量检查所有服务
    async checkAllServices() {
        const results = {};
        for (const [name] of this.services) {
            results[name] = await this.checkHealth(name);
        }
        return results;
    }
    
    // 获取Watch服务（流式健康检查）
    watchService(serviceName, interval = 5000) {
        Logger.info(`[gRPC] 启动 Watch: ${serviceName}`);
        
        const timer = setInterval(async () => {
            const status = await this.checkHealth(serviceName);
            this.emit('healthChange', { serviceName, status });
        }, interval);
        
        return () => clearInterval(timer);
    }
}

// ============================================================
// 方法4: UDP 广播发现
// ============================================================

class UDPDiscovery extends EventEmitter {
    constructor(port = 41234) {
        super();
        this.port = port;
        this.server = null;
        this.knownInstances = new Map();
    }
    
    start() {
        this.server = dgram.createSocket('udp4');
        
        this.server.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                
                if (data.type === 'announce') {
                    // 新实例 announcement
                    this.knownInstances.set(data.instanceId, {
                        ...data,
                        address: rinfo.address,
                        port: rinfo.port,
                        lastSeen: Date.now()
                    });
                    
                    Logger.info(`[UDP] 收到公告: ${data.instanceId}`, {
                        address: rinfo.address,
                        port: rinfo.port
                    });
                    
                    // 响应发现请求
                    this.sendResponse(rinfo);
                    
                    this.emit('instanceDiscovered', data);
                } else if (data.type === 'discovery') {
                    // 收到发现请求，广播自己的存在
                    this.broadcastAnnounce();
                }
            } catch (e) {
                Logger.error('[UDP] 解析消息失败', { error: e.message });
            }
        });
        
        this.server.bind(this.port, () => {
            this.server.setBroadcast(true);
            Logger.success(`[UDP] 发现服务启动在端口 ${this.port}`);
            
            // 启动后广播自己的存在
            this.broadcastAnnounce();
        });
        
        return this;
    }
    
    // 广播自己的存在
    broadcastAnnounce() {
        const message = Buffer.from(JSON.stringify({
            type: 'announce',
            instanceId: `instance_${process.pid}`,
            port: 3000,
            services: ['api', 'health'],
            timestamp: Date.now()
        }));
        
        this.server.send(message, 0, message.length, this.port, '255.255.255.255', (err) => {
            if (err) {
                Logger.error('[UDP] 广播失败', { error: err.message });
            } else {
                Logger.info('[UDP] 已广播公告');
            }
        });
    }
    
    // 发送响应
    sendResponse(rinfo) {
        const message = Buffer.from(JSON.stringify({
            type: 'response',
            instanceId: `instance_${process.pid}`,
            timestamp: Date.now()
        }));
        
        this.server.send(message, rinfo.port, rinfo.address);
    }
    
    // 发起发现请求
    sendDiscoveryRequest() {
        const message = Buffer.from(JSON.stringify({
            type: 'discovery',
            requestId: Date.now()
        }));
        
        this.server.send(message, 0, message.length, this.port, '255.255.255.255');
    }
    
    // 获取所有已知实例
    getKnownInstances() {
        const now = Date.now();
        const valid = [];
        
        for (const [id, instance] of this.knownInstances) {
            if (now - instance.lastSeen < 30000) { // 30秒内有效
                valid.push(instance);
            }
        }
        
        return valid;
    }
    
    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

// ============================================================
// 方法5: 数据库状态表轮询 (模拟)
// ============================================================

class DatabaseStatusPoller extends EventEmitter {
    constructor() {
        super();
        // 模拟数据库表
        this.statusTable = new Map();
        this.pollInterval = null;
    }
    
    // 模拟数据库写入
    async updateStatus(instanceId, status) {
        const record = {
            instanceId,
            status,
            updatedAt: new Date(),
            metadata: {
                pid: process.pid,
                memory: process.memoryUsage()
            }
        };
        
        this.statusTable.set(instanceId, record);
        
        Logger.info(`[DB] 更新状态: ${instanceId} -> ${status}`);
        
        return record;
    }
    
    // 模拟数据库读取 - 获取所有实例状态
    async getAllStatuses() {
        const now = Date.now();
        const instances = [];
        
        for (const [instanceId, record] of this.statusTable) {
            const age = now - record.updatedAt.getTime();
            
            instances.push({
                ...record,
                isStale: age > 30000 // 30秒视为过期
            });
        }
        
        return instances;
    }
    
    // 轮询所有实例状态
    async pollAllInstances() {
        const instances = await this.getAllStatuses();
        
        const healthy = instances.filter(i => !i.isStale && i.status === 'healthy');
        const unhealthy = instances.filter(i => i.isStale || i.status !== 'healthy');
        
        Logger.info(`[DB] 轮询结果: ${healthy.length} 健康, ${unhealthy.length} 不健康`);
        
        this.emit('pollResult', { healthy, unhealthy });
        
        return { healthy, unhealthy };
    }
    
    // 启动定期轮询
    startPolling(intervalMs = 5000) {
        Logger.info(`[DB] 启动轮询，间隔 ${intervalMs}ms`);
        
        this.pollInterval = setInterval(() => {
            this.pollAllInstances();
        }, intervalMs);
        
        return this;
    }
    
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
}

// ============================================================
// 主研究程序
// ============================================================

async function runResearch() {
    console.log('\n' + '='.repeat(60));
    console.log('🔬 实例间通讯方式研究 - 状态检测方法对比');
    console.log('='.repeat(60) + '\n');
    
    // 存储研究结果
    const results = {
        methods: [],
        comparison: []
    };
    
    // ------------------- 方法1: TCP Socket 心跳 -------------------
    Logger.info('='.repeat(50));
    Logger.info('方法1: TCP Socket 心跳检测');
    Logger.info('='.repeat(50));
    
    const tcpDetector = new TCPHeartbeatDetector(19999);
    tcpDetector.start();
    
    // 模拟多个实例发送心跳
    const instanceIds = ['instance-A', 'instance-B', 'instance-C'];
    
    for (const id of instanceIds) {
        try {
            await tcpDetector.sendHeartbeat(id, 19999);
            Logger.success(`[TCP] ${id} 发送心跳成功`);
        } catch (e) {
            Logger.error(`[TCP] ${id} 发送心跳失败`, { error: e.message });
        }
    }
    
    // 获取活跃实例
    setTimeout(() => {
        const active = tcpDetector.getActiveInstances();
        Logger.success(`[TCP] 检测到活跃实例: ${active.join(', ')}`);
        
        results.methods.push({
            name: 'TCP Socket 心跳',
            description: '通过建立TCP连接发送JSON心跳数据',
            pros: ['简单可靠', '支持双向通信', '可传输丰富数据'],
            cons: ['需要维护连接', '相对HTTP更复杂'],
            latency: '低 (~1ms)',
            complexity: '低'
        });
        
        console.log('\n');
    }, 500);
    
    // ------------------- 方法2: Redis Pub/Sub -------------------
    Logger.info('='.repeat(50));
    Logger.info('方法2: Redis Pub/Sub 状态广播');
    Logger.info('='.repeat(50));
    
    const redisPubSub = new RedisPubSubDetector();
    
    // 订阅状态更新
    redisPubSub.subscribe(['instance:heartbeat', 'instance:status'], (msg) => {
        Logger.info(`[Redis] 收到消息: ${msg.channel}`, msg.data);
    });
    
    // 模拟实例注册
    for (const id of instanceIds) {
        redisPubSub.registerInstance({ id, port: 3000 });
    }
    
    // 服务发现
    const discovered = await redisPubSub.discoverInstances();
    Logger.success(`[Redis] 发现实例数: ${discovered.length}`);
    
    results.methods.push({
        name: 'Redis Pub/Sub',
        description: '通过发布/订阅模式广播状态变化',
        pros: ['支持多订阅者', '解耦性好', '支持模式匹配'],
        cons: ['需要Redis基础设施', '消息可能丢失'],
        latency: '低 (~1ms)',
        complexity: '中'
    });
    
    console.log('\n');
    
    // ------------------- 方法3: gRPC 健康检查 -------------------
    Logger.info('='.repeat(50));
    Logger.info('方法3: gRPC 健康检查');
    Logger.info('='.repeat(50));
    
    const grpcHealth = new GRPCHealthChecker();
    
    // 注册模拟服务
    grpcHealth.registerService('UserService', {
        healthCheck: async () => {
            return { checks: { db: 'ok', cache: 'ok' } };
        }
    });
    
    grpcHealth.registerService('OrderService', {
        healthCheck: async () => {
            return { checks: { db: 'ok', mq: 'ok' } };
        }
    });
    
    // 执行健康检查
    const healthResults = await grpcHealth.checkAllServices();
    Logger.success(`[gRPC] 健康检查结果:`, healthResults);
    
    // 启动Watch模式
    const unwatch = grpcHealth.watchService('UserService', 3000);
    
    setTimeout(() => {
        unwatch();
        Logger.info('[gRPC] 停止 Watch');
        
        results.methods.push({
            name: 'gRPC 健康检查',
            description: '使用gRPC协议的标准健康检查服务',
            pros: ['标准化', '支持流式', '高效(Protocol Buffers)'],
            cons: ['需要gRPC依赖', '学习曲线'],
            latency: '极低 (<1ms)',
            complexity: '中'
        });
        
        console.log('\n');
    }, 5000);
    
    // ------------------- 方法4: UDP 广播发现 -------------------
    Logger.info('='.repeat(50));
    Logger.info('方法4: UDP 广播服务发现');
    Logger.info('='.repeat(50));
    
    const udpDiscovery = new UDPDiscovery(41235);
    udpDiscovery.start();
    
    // 监听实例发现
    udpDiscovery.on('instanceDiscovered', (data) => {
        Logger.info(`[UDP] 发现新实例: ${data.instanceId}`);
    });
    
    // 发送发现请求
    setTimeout(() => {
        udpDiscovery.sendDiscoveryRequest();
    }, 1000);
    
    setTimeout(() => {
        const known = udpDiscovery.getKnownInstances();
        Logger.success(`[UDP] 已发现实例: ${known.length} 个`);
        
        results.methods.push({
            name: 'UDP 广播发现',
            description: '通过UDP广播进行局域网服务发现',
            pros: ['无需中心节点', '自动发现', '低开销'],
            cons: ['仅限局域网', '不可靠'],
            latency: '极低',
            complexity: '低'
        });
        
        console.log('\n');
    }, 3000);
    
    // ------------------- 方法5: 数据库状态表 -------------------
    Logger.info('='.repeat(50));
    Logger.info('方法5: 数据库状态表轮询');
    Logger.info('='.repeat(50));
    
    const dbPoller = new DatabaseStatusPoller();
    
    // 模拟实例更新状态
    for (const id of instanceIds) {
        await dbPoller.updateStatus(id, 'healthy');
    }
    
    // 启动轮询
    dbPoller.startPolling(3000);
    
    dbPoller.on('pollResult', (result) => {
        Logger.info(`[DB] 轮询完成: ${result.healthy.length} 健康`);
    });
    
    setTimeout(() => {
        dbPoller.stopPolling();
        
        results.methods.push({
            name: '数据库状态表轮询',
            description: '通过数据库记录状态，定期轮询获取',
            pros: ['持久化', '可查询历史', '支持复杂查询'],
            cons: ['有延迟', '增加数据库负载'],
            latency: '高 (取决于DB性能)',
            complexity: '中'
        });
        
        console.log('\n');
    }, 8000);
    
    // ------------------- 研究总结 -------------------
    setTimeout(() => {
        console.log('\n' + '='.repeat(60));
        console.log('📊 研究结果总结');
        console.log('='.repeat(60));
        
        // 清理资源
        tcpDetector.stop();
        udpDiscovery.stop();
        
        // 输出对比表格
        console.log('\n| 方法 | 延迟 | 复杂度 | 可靠性 | 适用场景 |');
        console.log('|------|------|--------|--------|----------|');
        
        const comparison = [
            ['TCP Socket 心跳', '低', '低', '高', '服务间通信'],
            ['Redis Pub/Sub', '低', '中', '中', '分布式系统'],
            ['gRPC 健康检查', '极低', '中', '高', '微服务'],
            ['UDP 广播', '极低', '低', '低', '局域网发现'],
            ['数据库轮询', '高', '中', '高', '持久化状态']
        ];
        
        for (const row of comparison) {
            console.log(`| ${row.join(' | ')} |`);
        }
        
        console.log('\n📝 关键发现:');
        console.log('1. 没有"最佳"方案，只有"最适合"的方案');
        console.log('2. 生产环境通常组合使用多种方式');
        console.log('3. HTTP ping 仍然是最通用的方式（简单、可观测性好）');
        console.log('4. 对于高性能场景，考虑 gRPC 或 TCP');
        console.log('5. 对于服务发现，UDP广播 + 确认机制效果好");
        
        console.log('\n✅ 研究完成！\n');
        
    }, 10000);
}

// 运行研究
runResearch().catch(console.error);