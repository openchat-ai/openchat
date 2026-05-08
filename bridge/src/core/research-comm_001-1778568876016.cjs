// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:54:36.016Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 作者：小刚（勇气=62%, 创造力=43%）
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ============================================
// 方法1: TCP端口检测
// ============================================
function checkTcpPort(host, port, timeout = 3000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'unknown';
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            status = 'online';
            socket.destroy();
        });
        
        socket.on('timeout', () => {
            status = 'timeout';
            socket.destroy();
        });
        
        socket.on('error', (err) => {
            status = err.code === 'ECONNREFUSED' ? 'offline' : 'error';
        });
        
        socket.on('close', () => {
            resolve({ host, port, status, method: 'TCP' });
        });
        
        socket.connect(port, host);
    });
}

// ============================================
// 方法2: UDP广播心跳
// ============================================
class UdpHeartbeat extends EventEmitter {
    constructor(port = 41234) {
        super();
        this.port = port;
        this.server = null;
        this.clients = new Map();
    }
    
    startServer() {
        this.server = dgram.createSocket('udp4');
        
        this.server.on('message', (msg, rinfo) => {
            const data = JSON.parse(msg.toString());
            this.clients.set(rinfo.address, {
                ...data,
                lastSeen: Date.now()
            });
            this.emit('heartbeat', data);
        });
        
        this.server.bind(this.port);
        console.log(`[UDP] 心跳服务器启动在端口 ${this.port}`);
    }
    
    sendHeartbeat(instanceId, port) {
        const message = JSON.stringify({
            instanceId,
            port,
            timestamp: Date.now(),
            status: 'alive'
        });
        
        const client = dgram.createSocket('udp4');
        const buffer = Buffer.from(message);
        
        client.send(buffer, 0, buffer.length, this.port, '255.255.255.255', (err) => {
            if (err) console.error('[UDP] 发送失败:', err);
            client.close();
        });
    }
    
    getClients() {
        return this.clients;
    }
}

// ============================================
// 方法3: 共享文件状态标记
// ============================================
class FileBasedStatus {
    constructor(statusDir = './status') {
        this.statusDir = statusDir;
        this.ensureDir();
    }
    
    ensureDir() {
        if (!fs.existsSync(this.statusDir)) {
            fs.mkdirSync(this.statusDir, { recursive: true });
        }
    }
    
    // 更新自己的状态
    updateStatus(instanceId, status) {
        const filePath = path.join(this.statusDir, `${instanceId}.json`);
        const data = {
            instanceId,
            status,
            timestamp: Date.now(),
            pid: process.pid
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return data;
    }
    
    // 读取其他实例状态
    getInstanceStatus(instanceId) {
        const filePath = path.join(this.statusDir, `${instanceId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                // 检查是否超时（超过10秒视为离线）
                if (Date.now() - data.timestamp > 10000) {
                    return { ...data, isStale: true };
                }
                return{ ...data, isStale: false };
            }
        } catch (e) {
            console.error('读取状态文件失败:', e);
        }
        return null;
    }
    
    // 获取所有实例状态
    getAllStatuses() {
        const files = fs.readdirSync(this.statusDir);
        const statuses = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const instanceId = file.replace('.json', '');
                const status = this.getInstanceStatus(instanceId);
                if (status) statuses.push(status);
            }
        }
        return statuses;
    }
}

// ============================================
// 方法4: HTTP健康检查端点
// ============================================
function createHealthServer(port, instanceId) {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                instanceId,
                status: 'healthy',
                uptime: process.uptime(),
                timestamp: Date.now()
            }));
        } else if (req.url === '/ping') {
            res.writeHead(200);
            res.end('pong');
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
    
    server.listen(port, () => {
        console.log(`[HTTP] 实例 ${instanceId} 健康检查服务器运行在端口 ${port}`);
    });
    
    return server;
}

function checkHttpHealth(url, timeout = 3000) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    url,
                    status: res.statusCode === 200 ? 'online' : 'error',
                    responseTime: Date.now() - startTime,
                    method: 'HTTP',
                    data: JSON.parse(data || '{}')
                });
            });
        }).on('error', (err) => {
            resolve({
                url,
                status: 'offline',
                error: err.message,
                method: 'HTTP'
            });
        }).setTimeout(timeout, () => {
            resolve({
                url,
                status: 'timeout',
                method: 'HTTP'
            });
        });
    });
}

// ============================================
// 方法5: Unix域套接字（进程间通信）
// ============================================
class UnixSocketStatus {
    constructor(socketPath = '/tmp/instance-status.sock') {
        this.socketPath = socketPath;
    }
    
    startServer(instanceId) {
        if (fs.existsSync(this.socketPath)) {
            fs.unlinkSync(this.socketPath);
        }
        
        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const request = JSON.parse(data.toString());
                if (request.type === 'status') {
                    socket.write(JSON.stringify({
                        instanceId,
                        status: 'running',
                        timestamp: Date.now()
                    }));
                }
            });
        });
        
        server.listen(this.socketPath, () => {
            console.log(`[Unix Socket] 服务器运行在 ${this.socketPath}`);
        });
        
        return server;
    }
    
    checkStatus() {
        return new Promise((resolve) => {
            if (!fs.existsSync(this.socketPath)) {
                resolve({ status: 'no socket', method: 'Unix Socket' });
                return;
            }
            
            const client = net.createConnection(this.socketPath);
            
            client.on('connect', () => {
                client.write(JSON.stringify({ type: 'status' });
            });
            
            client.on('data', (data) => {
                resolve({
                    ...JSON.parse(data.toString()),
                    method: 'Unix Socket'
                });
                client.end();
            });
            
            client.on('error', (err) => {
                resolve({ status: 'error', error: err.message, method: 'Unix Socket' });
            });
            
            setTimeout(() => {
                client.end();
                resolve({ status: 'timeout', method: 'Unix Socket' });
            }, 3000);
        });
    }
}

// ============================================
// 方法6: 基于Redis的心跳机制
// ============================================
class RedisHeartbeat {
    constructor(redisUrl = 'redis://localhost:6379') {
        this.redisUrl = redisUrl;
        this.connected = false;
    }
    
    async connect() {
        try {
            // 尝试加载redis客户端
            const redis = require('redis');
            this.client = redis.createClient({ url: this.redisUrl });
            await this.client.connect();
            this.connected = true;
            console.log('[Redis] 连接成功');
        } catch (err) {
            console.log('[Redis] Redis未安装，模拟演示');
            this.connected = false;
        }
    }
    
    async sendHeartbeat(instanceId, ttl = 10) {
        if (!this.connected) {
            // 模拟
            return { simulated: true, instanceId, ttl };
        }
        
        const key = `instance:${instanceId}:heartbeat`;
        await this.client.set(key, JSON.stringify({
            instanceId,
            timestamp: Date.now(),
            status: 'alive'
        }), { EX: ttl });
    }
    
    async getAllInstances() {
        if (!this.connected) {
            return [
                { instanceId: 'instance-1', simulated: true, status: 'alive' },
                { instanceId: 'instance-2', simulated: true, status: 'alive' }
            ];
        }
        
        const keys = await this.client.keys('instance:*:heartbeat');
        const instances = [];
        
        for (const key of keys) {
            const data = await this.client.get(key);
            instances.push(JSON.parse(data));
        }
        
        return instances;
    }
}

// ============================================
// 主程序：综合演示
// ============================================
async function main() {
    console.log('='.repeat(60));
    console.log('实例间通讯方式研究 - 状态检测方法');
    console.log('='.repeat(60));
    
    // 1. TCP端口检测演示
    console.log('\n【方法1】TCP端口检测');
    console.log('-'.repeat(40));
    const tcpResult = await checkTcpPort('127.0.0.1', 80);
    console.log('检测结果:', tcpResult);
    
    // 2. HTTP健康检查
    console.log('\n【方法2】HTTP健康检查');
    console.log('-'.repeat(40));
    const healthResult = await checkHttpHealth('http://localhost:3000/health');
    console.log('检测结果:', healthResult);
    
    // 3. 文件状态标记
    console.log('\n【方法3】共享文件状态标记');
    console.log('-'.repeat(40));
    const fileStatus = new FileBasedStatus('./status');
    fileStatus.updateStatus('instance-A', 'running');
    fileStatus.updateStatus('instance-B', 'running');
    
    // 模拟instance-B离线（不更新）
    setTimeout(() => {
        const allStatus = fileStatus.getAllStatuses();
        console.log('所有实例状态:', allStatus);
    }, 100);
    
    // 4. UDP心跳
    console.log('\n【方法4】UDP广播心跳');
    console.log('-'.repeat(40));
    const udpHeartbeat = new UdpHeartbeat(41235);
    udpHeartbeat.startServer();
    
    // 发送广播
    setInterval(() => {
        udpHeartbeat.sendHeartbeat('my-instance', 3000);
    }, 2000);
    
    // 5. Unix域套接字
    console.log('\n【方法5】Unix域套接字');
    console.log('-'.repeat(40));
    const unixSocket = new UnixSocketStatus('/tmp/test-instance.sock');
    unixSocket.startServer('test-instance');
    
    setTimeout(async () => {
        const result = await unixSocket.checkStatus();
        console.log('Unix Socket检测结果:', result);
    }, 500);
    
    // 6. Redis心跳
    console.log('\n【方法6】Redis Pub/Sub 心跳');
    console.log('-'.repeat(40));
    const redisHb = new RedisHeartbeat();
    await redisHb.connect();
    await redisHb.sendHeartbeat('instance-1', 10);
    const instances = await redisHb.getAllInstances();
    console.log('Redis检测到的实例:', instances);
    
    // 总结
    console.log('\n' + '='.repeat(60));
    console.log('研究总结：实例状态检测方法对比');
    console.log('='.repeat(60));
    
    const summary = `
┌─────────────┬──────────┬─────────┬────────────┐
│ 方法        │ 延迟     │ 可靠性  │ 适用场景   │
├─────────────┼──────────┼─────────┼────────────┤
│ HTTP Ping   │ 中等     │ 高      │ 微服务     │
│ TCP端口     │ 低       │ 高      │ 基础检测   │
│ UDP心跳     │ 低       │ 中      │ 局域网     │
│ 文件状态    │ 中       │ 低      │ 简单部署   │
│ Unix Socket│ 最低     │ 高      │ 同机进程   │
│ Redis心跳   │ 低       │ 高      │ 分布式     │
│ gRPC        │ 低       │ 高      │ 微服务     │
│ 服务发现    │ 中       │ 高      │ K8s/云原生 │
└─────────────┴──────────┴─────────┴────────────┘

推荐方案：
1. 简单场景：HTTP /health 端点 + 负载均衡器健康检查
2. 容器环境：K8s liveness/readiness 探针
3. 分布式系统：Redis/etcd 心跳 + 服务发现
4. 高性能要求：gRPC 健康检查或 UDP 组播
5. 同机多实例：Unix 域套接字或共享内存
    `;
    
    console.log(summary);
    
    // 保持进程运行以便演示
    setTimeout(() => {
        console.log('\n演示完成，5秒后退出...');
        setTimeout(() => process.exit(0), 5000);
    }, 3000);
}

// 运行主程序
main().catch(console.error);