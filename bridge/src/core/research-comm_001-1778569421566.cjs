// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:03:41.566Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究的检测方式：
 * 1. TCP Socket 连接检测
 * 2. WebSocket 长连接检测  
 * 3. Redis Pub/Sub 心跳机制
 * 4. Redis Keyspace Notifications
 * 5. UDP 广播检测
 * 6. 数据库状态表轮询
 * 7. gRPC 健康检查
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');
const crypto = require('crypto');

// 模拟实例配置
const INSTANCE_CONFIG = {
  id: crypto.randomUUID(),
  port: 3000,
  heartbeatInterval: 3000,
  timeout: 10000
};

console.log('='.repeat(60));
console.log('实例间通讯方式研究 - 状态检测方法对比');
console.log('='.repeat(60));
console.log(`当前实例ID: ${INSTANCE_CONFIG.id}`);
console.log('='.repeat(60));

// ============================================================
// 方法1: TCP Socket 连接检测
// ============================================================
class TCPDetector extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
  }

  // 创建TCP服务器监听连接
  startServer(port) {
    const server = net.createServer((socket) => {
      console.log('[TCP] 收到来自实例的连接:', socket.remoteAddress);
      
      // 发送实例ID
      socket.write(JSON.stringify({ id: INSTANCE_CONFIG.id, type: 'alive' });
      
      // 保持连接并定期发送心跳
      socket.heartbeat = setInterval(() => {
        if (!socket.destroyed) {
          socket.write(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() });
        }
      }, 2000);

      socket.on('data', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.emit('instanceUpdate', msg);
        } catch (e) {}
      });

      socket.on('close', () => {
        clearInterval(socket.heartbeat);
        this.emit('instanceLost', socket.remoteAddress);
      });
    });

    server.listen(port, () => {
      console.log(`[TCP] TCP检测服务器启动在端口 ${port}`);
    });

    return server;
  }

  // 连接到其他实例
  connectToPeer(address, port) {
    const socket = net.createConnection({ port, host: address }, () => {
      console.log(`[TCP] 已连接到实例 ${address}:${port}`);
      socket.write(JSON.stringify({ id: INSTANCE_CONFIG.id, type: 'register' });
    });

    socket.on('data', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.connections.set(address, { socket, ...msg });
        this.emit('peerUpdate', msg);
      } catch (e) {}
    });

    socket.on('close', () => {
      this.connections.delete(address);
      this.emit('peerLost', address);
    });

    return socket;
  }
}

// ============================================================
// 方法2: WebSocket 长连接检测
// ============================================================
class WebSocketDetector extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
  }

  // 模拟WebSocket服务器
  startWSServer(port) {
    // 简化版WebSocket模拟（实际使用ws库）
    const server = http.createServer((req, res) => {
      if (req.url === '/ws') {
        // 这里应该是WebSocket升级，实际简化处理
        console.log('[WebSocket] 收到WebSocket连接请求');
        res.writeHead(101, { 'Content-Type': 'text/plain' });
        res.end('WebSocket Upgrade');
      }
    });

    server.listen(port, () => {
      console.log(`[WebSocket] WebSocket服务模拟启动在端口 ${port}`);
    });

    // 模拟广播消息
    this.broadcast = (message) => {
      console.log('[WebSocket] 广播消息到所有连接的实例:', message);
      this.clients.forEach((client, id) => {
        console.log(`  -> 发送给实例 ${id}`);
      });
    };

    return server;
  }

  // 添加客户端连接
  addClient(id, client) {
    this.clients.set(id, client);
    console.log(`[WebSocket] 实例 ${id} 已连接，当前连接数: ${this.clients.size}`);
    this.emit('clientConnected', id);
  }
}

// ============================================================
// 方法3: Redis Pub/Sub 心跳机制
// ============================================================
class RedisPubSubDetector extends EventEmitter {
  constructor() {
    super();
    this.channel = 'instance-heartbeat';
    this.instances = new Map();
  }

  // 模拟发布心跳
  publishHeartbeat(redisClient) {
    const heartbeat = {
      id: INSTANCE_CONFIG.id,
      timestamp: Date.now(),
      status: 'alive',
      metadata: { cpu: Math.random() * 100, memory: Math.random() * 80 }
    };

    // 实际使用时: redisClient.publish(this.channel, JSON.stringify(heartbeat));
    console.log('[Redis Pub/Sub] 发布心跳:', heartbeat);
    this.emit('heartbeatPublished', heartbeat);
    
    return heartbeat;
  }

  // 模拟订阅处理
  handleSubscription(message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      this.instances.set(data.id, {
        ...data,
        lastSeen: Date.now()
      });
      this.emit('instanceUpdate', data);
    } catch (e) {
      console.error('[Redis Pub/Sub] 解析消息失败:', e);
    }
  }

  // 检查实例超时
  checkTimeouts(timeout = 10000) {
    const now = Date.now();
    const activeInstances = [];
    
    this.instances.forEach((instance, id) => {
      if (now - instance.lastSeen > timeout) {
        console.log(`[Redis Pub/Sub] 实例 ${id} 已超时离线`);
        this.emit('instanceTimeout', id);
      } else {
        activeInstances.push(id);
      }
    });

    console.log(`[Redis Pub/Sub] 当前活跃实例: ${activeInstances.length}`);
    return activeInstances;
  }
}

// ============================================================
// 方法4: Redis Keyspace Notifications
// ============================================================
class RedisKeyspaceDetector extends EventEmitter {
  constructor() {
    super();
    this.instanceKeys = 'instances:status';
  }

  // 模拟设置实例状态键
  setInstanceStatus(redisClient, instanceId, status) {
    // 实际使用时: 
    // redisClient.set(`instance:${instanceId}:status`, status, 'EX', 30);
    // redisClient.publish('__keyspace@0__:instance:' + instanceId + ':status', 'set');
    
    const keyData = {
      key: `instance:${instanceId}:status`,
      value: status,
      timestamp: Date.now(),
      ttl: 30
    };
    
    console.log('[Redis Keyspace] 设置实例状态:', keyData);
    this.emit('statusSet', keyData);
    
    return keyData;
  }

  // 模拟监听键过期事件
  handleKeyExpiration(key) {
    console.log(`[Redis Keyspace] 检测到键过期: ${key}`);
    const instanceId = key.match(/instance:(.+):status/)?.[1];
    if (instanceId) {
      this.emit('instanceExpired', instanceId);
    }
  }
}

// ============================================================
// 方法5: UDP 广播检测
// ============================================================
class UDPDetector extends EventEmitter {
  constructor() {
    super();
    this.broadcastPort = 41234;
    this.socket = null;
    this.peers = new Map();
  }

  startBroadcast() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        
        if (data.type === 'announce') {
          this.peers.set(rinfo.address, {
            ...data,
            address: rinfo.address,
            port: rinfo.port,
            lastSeen: Date.now()
          });
          console.log(`[UDP] 收到实例 ${data.instanceId} 的广播 from ${rinfo.address}:${rinfo.port}`);
          this.emit('peerDiscovered', data);
          
          // 响应广播
          this.sendResponse(rinfo.address, rinfo.port);
        } else if (data.type === 'response') {
          this.peers.set(rinfo.address, {
            ...data,
            address: rinfo.address,
            lastSeen: Date.now()
          });
          this.emit('peerResponse', data);
        }
      } catch (e) {
        console.error('[UDP] 解析消息失败:', e);
      }
    });

    this.socket.bind(this.broadcastPort, () => {
      this.socket.setBroadcast(true);
      console.log(`[UDP] UDP广播服务启动在端口 ${this.broadcastPort}`);
      
      // 定期发送广播
      this.broadcastInterval = setInterval(() => {
        this.broadcastAnnounce();
      }, 5000);
    });

    return this.socket;
  }

  broadcastAnnounce() {
    const message = Buffer.from(JSON.stringify({
      type: 'announce',
      instanceId: INSTANCE_CONFIG.id,
      timestamp: Date.now(),
      status: 'alive'
    }));

    this.socket.send(message, 0, message.length, this.broadcastPort, '255.255.255.255');
    console.log('[UDP] 发送广播到 255.255.255.255');
  }

  sendResponse(targetAddress, targetPort) {
    const message = Buffer.from(JSON.stringify({
      type: 'response',
      instanceId: INSTANCE_CONFIG.id,
      timestamp: Date.now()
    }));

    this.socket.send(message, 0, message.length, targetPort, targetAddress);
  }

  getActivePeers() {
    const now = Date.now();
    const active = [];
    this.peers.forEach((peer, addr) => {
      if (now - peer.lastSeen < 10000) {
        active.push(peer);
      }
    });
    return active;
  }

  stop() {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.socket) this.socket.close();
  }
}

// ============================================================
// 方法6: 数据库状态表轮询
// ============================================================
class DatabaseDetector extends EventEmitter {
  constructor() {
    super();
    // 模拟数据库表
    this.instanceTable = new Map();
  }

  // 模拟更新状态到数据库
  async updateStatus(instanceId, status) {
    // 实际使用时: 
    // await db.query('UPDATE instances SET status = ?, last_heartbeat = NOW() WHERE id = ?', [status, instanceId]);
    
    const record = {
      id: instanceId,
      status,
      lastHeartbeat: new Date(),
      updatedAt: new Date()
    };
    
    this.instanceTable.set(instanceId, record);
    console.log(`[Database] 更新实例 ${instanceId} 状态: ${status}`);
    
    return record;
  }

  // 模拟查询所有实例状态
  async getAllInstances() {
    // 实际使用时:
    // const rows = await db.query('SELECT * FROM instances WHERE last_heartbeat > DATE_SUB(NOW(), INTERVAL 30 SECOND)');
    
    const now = Date.now();
    const activeInstances = [];
    
    this.instanceTable.forEach((record, id) => {
      const diff = now - record.lastHeartbeat.getTime();
      if (diff < 30000) { // 30秒内有心跳视为活跃
        activeInstances.push({ ...record, isActive: true };
      } else {
        this.emit('instanceStale', id);
      }
    });

    console.log(`[Database] 查询到 ${activeInstances.length} 个活跃实例`);
    return activeInstances;
  }

  // 模拟清理超时实例
  async cleanupStaleInstances(timeout = 60000) {
    const now = Date.now();
    const staleIds = [];
    
    this.instanceTable.forEach((record, id) => {
      if (now - record.lastHeartbeat.getTime() > timeout) {
        staleIds.push(id);
        this.instanceTable.delete(id);
      }
    });

    if (staleIds.length > 0) {
      console.log(`[Database] 清理 ${staleIds.length} 个超时实例:`, staleIds);
      this.emit('instancesCleaned', staleIds);
    }
    
    return staleIds;
  }
}

// ============================================================
// 方法7: gRPC 健康检查（模拟）
// ============================================================
class GRPCDetector extends EventEmitter {
  constructor() {
    super();
  }

  // 模拟gRPC健康检查服务定义
  getHealthServiceDefinition() {
    // 实际使用时使用 @grpc/grpc-js
    return {
      name: 'Health',
      methods: {
        Check: {
          path: '/grpc.health.v1.Health/Check',
          requestStream: false,
          responseStream: false,
          responseType: 'HealthCheckResponse'
        },
        Watch: {
          path: '/grpc.health.v1.Health/Watch',
          requestStream: false,
          responseStream: true,
          responseType: 'HealthCheckResponse'
        }
      }
    };
  }

  // 模拟健康检查请求
  async performHealthCheck(target) {
    // 实际使用时:
    // const client = new HealthClient(target, credentials);
    // const response = await client.check({ service: '' });
    
    const mockResponse = {
      status: Math.random() > 0.1 ? 'SERVING' : 'NOT_SERVING',
      target,
      timestamp: Date.now()
    };

    console.log(`[gRPC] 健康检查结果 for ${target}:`, mockResponse.status);
    this.emit('healthCheckResult', mockResponse);
    
    return mockResponse;
  }

  // 模拟流式健康监控
  startStreamingHealthCheck(target, interval = 5000) {
    console.log(`[gRPC] 启动流式健康检查 for ${target}`);
    
    const stream = {
      target,
      interval,
      active: true,
      check: () => {
        if (stream.active) {
          this.performHealthCheck(target);
        }
      }
    };

    stream.timer = setInterval(() => stream.check(), interval);
    return stream;
  }
}

// ============================================================
// 综合演示
// ============================================================
async function runDemo() {
  console.log('\n' + '='.repeat(60));
  console.log('开始综合演示各种检测方式');
  console.log('='.repeat(60) + '\n');

  // 1. TCP 检测演示
  console.log('--- 1. TCP Socket 连接检测 ---');
  const tcpDetector = new TCPDetector();
  tcpDetector.startServer(3001);
  setTimeout(() => {
    tcpDetector.connectToPeer('127.0.0.1', 3001);
  }, 1000);

  // 2. WebSocket 检测演示
  console.log('\n--- 2. WebSocket 长连接检测 ---');
  const wsDetector = new WebSocketDetector();
  wsDetector.startWSServer(3002);
  wsDetector.addClient('instance-001', { socket: {} });
  wsDetector.addClient('instance-002', { socket: {} });
  wsDetector.broadcast({ type: 'ping', from: INSTANCE_CONFIG.id });

  // 3. Redis Pub/Sub 检测演示
  console.log('\n--- 3. Redis Pub/Sub 心跳机制 ---');
  const redisPubSub = new RedisPubSubDetector();
  redisPubSub.publishHeartbeat();
  redisPubSub.handleSubscription({ id: 'sister-instance-1', timestamp: Date.now() };
  redisPubSub.handleSubscription({ id: 'sister-instance-2', timestamp: Date.now() - 5000 };
  redisPubSub.checkTimeouts();

  // 4. Redis Keyspace 检测演示
  console.log('\n--- 4. Redis Keyspace Notifications ---');
  const redisKeyspace = new RedisKeyspaceDetector();
  redisKeyspace.setInstanceStatus(null, 'instance-001', 'healthy');
  redisKeyspace.setInstanceStatus(null, 'instance-002', 'healthy');
  redisKeyspace.handleKeyExpiration('instance:instance-003:status');

  // 5. UDP 广播检测演示
  console.log('\n--- 5. UDP 广播检测 ---');
  const udpDetector = new UDPDetector();
  udpDetector.startBroadcast();
  
  // 模拟收到广播
  setTimeout(() => {
    udpDetector.handleSubscription(Buffer.from(JSON.stringify({
      type: 'announce',
      instanceId: 'sister-instance-1',
      timestamp: Date.now()
    })), { address: '192.168.1.101', port: 41234 });
    
    console.log('[UDP] 当前活跃对等节点:', udpDetector.getActivePeers().length);
  }, 3000);

  // 6. 数据库状态表检测演示
  console.log('\n--- 6. 数据库状态表轮询 ---');
  const dbDetector = new DatabaseDetector();
  await dbDetector.updateStatus('instance-001', 'running');
  await dbDetector.updateStatus('instance-002', 'running');
  await dbDetector.updateStatus('instance-003', 'running');
  await dbDetector.getAllInstances();
  await dbDetector.cleanupStaleInstances(60000);

  // 7. gRPC 健康检查演示
  console.log('\n--- 7. gRPC 健康检查 ---');
  const grpcDetector = new GRPCDetector();
  console.log('[gRPC] 服务定义:', grpcDetector.getHealthServiceDefinition().name);
  await grpcDetector.performHealthCheck('192.168.1.101:50051');
  await grpcDetector.performHealthCheck('192.168.1.102:50051');
  const stream = grpcDetector.startStreamingHealthCheck('192.168.1.103:50051');

  // 清理资源
  setTimeout(() => {
    udpDetector.stop();
    console.log('\n演示完成，资源已清理');
    printSummary();
    process.exit(0);
  }, 8000);
}

// ============================================================
// 总结对比
// ============================================================
function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('实例间状态检测方法总结对比');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────┬──────────┬──────────┬──────────┬────────────────┐
│     方法         │ 实时性   │  复杂度  │  可靠性  │     适用场景    │
├─────────────────┼──────────┼──────────┼──────────┼────────────────┤
│ HTTP Ping       │ 中       │ 低       │ 高       │ 简单健康检查    │
│ TCP Socket      │ 高       │ 中       │ 高       │ 长连接场景      │
│ WebSocket       │ 高       │ 中       │ 高       │ 实时双向通信    │
│ Redis Pub/Sub   │ 高       │ 低       │ 高       │ 分布式集群      │
│ Redis Keyspace  │ 高       │ 中       │ 中       │ 状态过期检测    │
│ UDP 广播        │ 高       │ 低       │ 低       │ 服务发现        │
│ 数据库轮询      │ 低       │ 低       │ 中       │ 简单部署        │
│ gRPC            │ 高       │ 高       │ 高       │ 微服务通信      │
│ Consul/Etcd     │ 高       │ 高       │ 高       │ 生产级集群      │
└─────────────────┴──────────┴──────────┴──────────┴────────────────┘

推荐方案:
1. 小型项目: HTTP Ping + Redis Pub/Sub
2. 中型项目: TCP/WebSocket + Redis Keyspace
3. 大型项目: gRPC + Consul/Etcd
  `;

  console.log(summary);
}

// 运行演示
runDemo().catch(console.error);