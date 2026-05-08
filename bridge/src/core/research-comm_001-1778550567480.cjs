// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:49:27.480Z

/**
 * 实例间通讯方式研究 - 状态检测方法
 * 除了HTTP Ping外的多种检测方式
 */

const net = require('net');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const http = require('http');
const os = require('os');

// ============================================
// 研究结果存储
// ============================================
const researchResults = {
    methods: [],
    testResults: []
};

// 添加研究结果的方法
function addMethod(name, description, pros, cons) {
    researchResults.methods.push({ name, description, pros, cons };
}

// ============================================
// 方法1: TCP Socket 连接检测
// ============================================
addMethod(
    'TCP Socket 检测',
    '通过尝试建立TCP连接来检测实例是否存活',
    ['简单可靠', '跨语言跨平台', '开销低'],
    ['需要实例监听TCP端口', '只能检测连接性，不能传递状态']
);

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
                resolve({ healthy: true, latency: 0, method: 'TCP' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ healthy: false, reason: 'timeout', method: 'TCP' });
            });

            socket.on('error', (err) => {
                resolve({ healthy: false, reason: err.message, method: 'TCP' });
            });

            socket.connect(this.port, this.host);
        });
    }
}

// 简单的TCP服务器模拟
function createTCPServer(port) {
    return new Promise((resolve) => {
        const server = net.createServer((socket) => {
            socket.write('pong');
            socket.end();
        });
        server.listen(port, () => {
            console.log(`[TCP Server] 监听端口 ${port}`);
            resolve(server);
        });
    });
}

// ============================================
// 方法2: UDP 广播检测
// ============================================
addMethod(
    'UDP 广播/多播',
    '通过UDP广播或多播发送心跳，实例回复UDP包',
    ['支持多播发现', '开销极低', '适合局域网'],
    ['不可靠传输', '可能被防火墙阻止', '需要处理丢包']
);

class UDPHealthChecker {
    constructor(port = 41234) {
        this.port = port;
        this.client = dgram.createSocket('udp4');
    }

    async broadcast(query) {
        const message = Buffer.from(JSON.stringify({ type: 'health-query', query }));
        
        return new Promise((resolve) => {
            this.client.send(message, 0, message.length, this.port, '255.255.255.255', (err) => {
                if (err) {
                    resolve({ healthy: false, error: err.message });
                } else {
                    resolve({ healthy: true, sent: true });
                }
            });
        });
    }

    close() {
        this.client.close();
    }
}

// UDP服务器
function createUDPServer(port = 41234) {
    const server = dgram.createSocket('udp4');
    
    server.on('message', (msg, rinfo) => {
        const data = JSON.parse(msg.toString());
        if (data.type === 'health-query') {
            // 回复UDP包
            const response = Buffer.from(JSON.stringify({
                type: 'health-response',
                status: 'healthy',
                timestamp: Date.now()
            }));
            server.send(response, rinfo.port, rinfo.address);
        }
    });

    server.bind(port, () => {
        server.setBroadcast(true);
        console.log(`[UDP Server] 监听端口 ${port} (广播模式)`);
    });

    return server;
}

// ============================================
// 方法3: 共享存储 (Redis风格模拟)
// ============================================
addMethod(
    '共享存储检测',
    '实例在共享存储(Redis/Memcached)中定期更新心跳',
    ['状态可持久化', '支持分布式', '可传递复杂状态'],
    ['需要额外组件', '有网络延迟', '需要处理脑裂问题']
);

class SharedStorageHealthChecker {
    constructor() {
        // 模拟Redis存储
        this.storage = new Map();
    }

    // 模拟实例注册心跳
    async registerHeartbeat(instanceId, data) {
        const key = `heartbeat:${instanceId}`;
        this.storage.set(key, {
            data,
            timestamp: Date.now()
        });
        return true;
    }

    // 检查实例是否存活
    async checkInstance(instanceId, timeout = 5000) {
        const key = `heartbeat:${instanceId}`;
        const record = this.storage.get(key);
        
        if (!record) {
            return { healthy: false, reason: 'not registered' };
        }

        const age = Date.now() - record.timestamp;
        return {
            healthy: age < timeout,
            latency: age,
            lastData: record.data,
            method: 'SharedStorage'
        };
    }
}

// ============================================
// 方法4: gRPC 健康检查协议
// ============================================
addMethod(
    'gRPC 健康检查',
    '使用gRPC的Health Checking Protocol',
    ['高效二进制', '支持流式', '强类型定义'],
    ['需要 Protocol Buffer', '学习曲线较陡']
);

// 模拟gRPC健康检查
class GRPCHealthChecker {
    constructor(host, port) {
        this.address = `${host}:${port}`;
    }

    // 模拟gRPC健康检查调用
    async check() {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        return {
            healthy: true,
            status: 'SERVING',
            method: 'gRPC',
            service: this.address
        };
    }
}

// ============================================
// 方法5: WebSocket 长连接
// ============================================
addMethod(
    'WebSocket 连接',
    '维护持久TCP连接，实时推送状态',
    ['双向通信', '实时性好', '支持推送'],
    ['需要维护连接状态', '对服务端有负载']
);

class WebSocketHealthChecker {
    constructor() {
        this.connections = new Map();
    }

    // 模拟WebSocket连接
    connect(instanceId, url) {
        const connection = {
            id: instanceId,
            url,
            status: 'connected',
            lastHeartbeat: Date.now()
        };
        this.connections.set(instanceId, connection);
        console.log(`[WebSocket] 实例 ${instanceId} 已连接`);
        return connection;
    }

    // 检查连接状态
    checkConnection(instanceId) {
        const conn = this.connections.get(instanceId);
        if (!conn) {
            return{ healthy: false, reason: 'no connection' };
        }

        const timeSinceHeartbeat = Date.now() - conn.lastHeartbeat;
        return {
            healthy: timeSinceHeartbeat < 10000,
            timeSinceHeartbeat,
            method: 'WebSocket'
        };
    }
}

// ============================================
// 方法6: 服务发现系统 (Consul风格)
// ============================================
addMethod(
    '服务发现系统',
    '使用Consul/Etcd/ZooKeeper进行服务注册和健康检查',
    ['功能全面', '高可用', '支持复杂场景'],
    ['需要额外基础设施', '复杂度高']
);

class ServiceDiscoveryHealthChecker {
    constructor() {
        this.services = new Map();
    }

    // 模拟服务注册
    registerService(serviceName, instanceId, metadata = {}) {
        this.services.set(instanceId, {
            name: serviceName,
            id: instanceId,
            metadata,
            registeredAt: Date.now(),
            healthCheck: 'passing'
        });
        console.log(`[ServiceDiscovery] 注册服务: ${serviceName}/${instanceId}`);
    }

    // 获取服务健康状态
    getServiceHealth(instanceId) {
        const service = this.services.get(instanceId);
        if (!service) {
            return{ healthy: false, reason: 'not registered' };
        }
        
        return {
            healthy: service.healthCheck === 'passing',
            service: service.name,
            metadata: service.metadata,
            method: 'ServiceDiscovery'
        };
    }
}

// ============================================
// 主测试函数
// ============================================
async function runTests() {
    console.log('\n========== 实例间状态检测方法测试 ==========\n');

    // 测试1: TCP检测
    console.log('--- 测试1: TCP Socket 检测 ---');
    const tcpServer = await createTCPServer(19999);
    const tcpChecker = new TCPHealthChecker(19999);
    const tcpResult = await tcpChecker.check();
    console.log('TCP检测结果:', tcpResult);
    researchResults.testResults.push({ method: 'TCP', result: tcpResult };
    tcpServer.close();

    // 测试2: UDP检测
    console.log('\n--- 测试2: UDP 广播检测 ---');
    const udpServer = createUDPServer(41235);
    const udpChecker = new UDPHealthChecker(41235);
    const udpResult = await udpChecker.broadcast('health-check');
    console.log('UDP广播结果:', udpResult);
    researchResults.testResults.push({ method: 'UDP', result: udpResult });
    udpChecker.close();
    udpServer.close();

    // 测试3: 共享存储检测
    console.log('\n--- 测试3: 共享存储检测 ---');
    const storageChecker = new SharedStorageHealthChecker();
    await storageChecker.registerHeartbeat('instance-1', { cpu: 30, memory: 50 });
    await new Promise(r => setTimeout(r, 100));
    const storageResult = await storageChecker.checkInstance('instance-1');
    console.log('共享存储检测结果:', storageResult);
    researchResults.testResults.push({ method: 'SharedStorage', result: storageResult });

    // 测试4: gRPC检测
    console.log('\n--- 测试4: gRPC 健康检测 ---');
    const grpcChecker = new GRPCHealthChecker('localhost', 50051);
    const grpcResult = await grpcChecker.check();
    console.log('gRPC检测结果:', grpcResult);
    researchResults.testResults.push({ method: 'gRPC', result: grpcResult });

    // 测试5: WebSocket检测
    console.log('\n--- 测试5: WebSocket 连接检测 ---');
    const wsChecker = new WebSocketHealthChecker();
    wsChecker.connect('instance-1', 'ws://localhost:8080');
    await new Promise(r => setTimeout(r, 50));
    const wsResult = wsChecker.checkConnection('instance-1');
    console.log('WebSocket检测结果:', wsResult);
    researchResults.testResults.push({ method: 'WebSocket', result: wsResult });

    // 测试6: 服务发现
    console.log('\n--- 测试6: 服务发现检测 ---');
    const sdChecker = new ServiceDiscoveryHealthChecker();
    sdChecker.registerService('my-service', 'instance-1', { version: '1.0.0' });
    const sdResult = sdChecker.getServiceHealth('instance-1');
    console.log('服务发现检测结果:', sdResult);
    researchResults.testResults.push({ method: 'ServiceDiscovery', result: sdResult });

    console.log('\n');
}

// ============================================
// 输出研究总结
// ============================================
function printSummary() {
    console.log('\n============================================');
    console.log('        实例间状态检测方法研究总结');
    console.log('============================================\n');

    console.log('检测方法对比表:');
    console.log('----------------');
    
    researchResults.methods.forEach((method, index) => {
        console.log(`\n${index + 1}. ${method.name}`);
        console.log(`   描述: ${method.description}`);
        console.log(`   优点: ${method.pros.join(', ')}`);
        console.log(`   缺点: ${method.cons.join(', ')}`);
    });

    console.log('\n\n实际测试结果:');
    console.log('-------------');
    researchResults.testResults.forEach((test) => {
        console.log(`[${test.method}]: ${JSON.stringify(test.result)}`);
    });

    console.log('\n\n推荐方案:');
    console.log('----------');
    console.log('1. 简单场景 → TCP Socket / HTTP');
    console.log('2. 服务发现 → Consul / Etcd');
    console.log('3. 实时性要求高 → WebSocket / gRPC');
    console.log('4. 大规模分布式 → 共享存储 (Redis) + 心跳');
    console.log('5. 局域网多实例 → UDP 多播');

    console.log('\n============================================\n');
}

// ============================================
// 运行程序
// ============================================
async function main() {
    console.log('实例间通讯方式研究 - 状态检测方法');
    console.log('================================\n');
    
    await runTests();
    printSummary();
}

main().catch(console.error);