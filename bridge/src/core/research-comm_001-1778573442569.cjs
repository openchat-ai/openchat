// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:10:42.569Z

/**
 * 实例间通讯方式研究
 * 探索除了 HTTP ping 之外的其他状态检测方法
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

// ============================================================
// 方式1: TCP 端口检测
// ============================================================
class TCPHealthCheck {
  constructor(port) {
    this.port = port;
    this.server = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        // 收到连接即认为服务健康
        socket.write('OK');
        socket.end();
      });
      
      this.server.listen(this.port, () => {
        console.log(`[TCP] 服务器监听端口 ${this.port}`);
        resolve();
      });
    });
  }

  // 检测远程实例的 TCP 端口是否开放
  async checkRemote(host, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;
      
      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({ alive: true, method: 'TCP' };
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ alive: false, method: 'TCP' });
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve({ alive: false, method: 'TCP' });
      });
      
      socket.connect(port, host);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}

// ============================================================
// 方式2: UDP 心跳/广播
// ============================================================
class UDPHeartbeat extends EventEmitter {
  constructor(port, instanceId) {
    super();
    this.port = port;
    this.instanceId = instanceId;
    this.server = null;
    this.clients = new Map(); // 记录已发现的实例
  }

  start() {
    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true };
    
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'heartbeat') {
          this.clients.set(data.instanceId, {
            ...data,
            lastSeen: Date.now()
          });
          this.emit('instanceFound', data);
        }
      } catch (e) {
        console.log('[UDP] 收到无效消息');
      }
    });

    this.server.bind(this.port, () => {
      this.server.setBroadcast(true);
      console.log(`[UDP] 服务器监听端口 ${this.port}`);
      
      // 开始定期广播自己的存在
      this.broadcastInterval = setInterval(() => {
        this.broadcast();
      }, 2000);
    });
  }

  broadcast() {
    const message = JSON.stringify({
      type: 'heartbeat',
      instanceId: this.instanceId,
      timestamp: Date.now(),
      status: 'healthy'
    });
    
    const buffer = Buffer.from(message);
    // 广播到同一网络的所有设备
    this.server.send(buffer, 0, buffer.length, this.port, '255.255.255.255');
  }

  getInstances() {
    const now = Date.now();
    const instances = [];
    
    for (const [id, data] of this.clients) {
      // 10秒内没有收到心跳认为离线
      if (now - data.lastSeen < 10000) {
        instances.push({
          instanceId: id,
          status: 'alive',
          lastSeen: data.lastSeen,
          method: 'UDP Heartbeat'
        });
      }
    }
    
    return instances;
  }

  stop() {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.server) this.server.close();
  }
}

// ============================================================
// 方式3: 基于 Redis Pub/Sub 的状态同步
// ============================================================
class RedisStatusSync extends EventEmitter {
  // 注意：需要安装 redis 包
  // 此处使用模拟实现演示原理
  
  constructor(instanceId) {
    super();
    this.instanceId = instanceId;
    this.status = 'starting';
    this.subscribers = new Map(); // 模拟其他实例
  }

  // 模拟发布状态
  publish(channel, message) {
    const msg = JSON.stringify({
      instanceId: this.instanceId,
      channel,
      message,
      timestamp: Date.now()
    });
    
    // 模拟广播给所有订阅者
    for (const [id, callback] of this.subscribers) {
      callback(msg);
    }
  }

  // 模拟订阅
  subscribe(channel, callback) {
    this.subscribers.set(`${this.instanceId}_${channel}`, callback);
  }

  // 更新自己的状态
  updateStatus(newStatus) {
    this.status = newStatus;
    this.publish('instance_status', {
      status: newStatus,
      instanceId: this.instanceId
    });
    console.log(`[Redis] 实例 ${this.instanceId} 状态更新: ${newStatus}`);
  }

  // 获取所有实例状态
  getAllStatus() {
    // 在真实场景中，会查询 Redis 中的 key-value
    // 这里返回模拟数据
    return [
      { instanceId: 'instance-1', status: 'healthy', method: 'Redis Pub/Sub' },
      { instanceId: 'instance-2', status: 'healthy', method: 'Redis Pub/Sub' },
      { instanceId: this.instanceId, status: this.status, method: 'Redis Pub/Sub' }
    ];
  }
}

// ============================================================
// 方式4: gRPC 健康检查协议
// ============================================================
class GRPCHealthCheck {
  constructor() {
    // gRPC 使用 Protocol Buffers 定义健康检查服务
    // 这里是概念演示
    this.healthCheckService = {
      // 标准 gRPC 健康检查协议
      Check: (call, callback) => {
        callback(null, { status: 'SERVING' });
      },
      Watch: (call) => {
        // 流式返回健康状态
        call.on('data', (request) => {
          call.write({ status: 'SERVING' });
        });
      }
    };
  }

  // 模拟 gRPC 健康检查请求
  async checkRemote(host, port) {
    // 在真实场景中使用 @grpc/grpc-js
    // 这里模拟返回
    console.log(`[gRPC] 发送健康检查到 ${host}:${port}`);
    
    return {
      alive: true,
      status: 'SERVING',
      method: 'gRPC Health Check'
    };
  }
}

// ============================================================
// 方式5: WebSocket 长连接
// ============================================================
class WebSocketStatus extends EventEmitter {
  constructor(port, instanceId) {
    super();
    this.port = port;
    this.instanceId = instanceId;
    this.connections = new Set();
    this.server = null;
  }

  start() {
    // 使用 Node.js 原生 http 模块模拟 WebSocket
    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          instanceId: this.instanceId, 
          status: 'healthy',
          connections: this.connections.size
        });
      }
    });

    // 简单的 WebSocket 升级处理（简化版）
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url === '/ws') {
        this.handleConnection(socket);
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[WebSocket] 服务器监听端口 ${this.port}`);
    });
  }

  handleConnection(socket) {
    this.connections.add(socket);
    console.log(`[WebSocket] 新连接加入，当前连接数: ${this.connections.size}`);

    // 发送欢迎消息
    socket.write(JSON.stringify({
      type: 'welcome',
      instanceId: this.instanceId,
      timestamp: Date.now()
    }));

    socket.on('close', () => {
      this.connections.delete(socket);
      console.log(`[WebSocket] 连接断开，当前连接数: ${this.connections.size}`);
    });

    socket.on('data', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.emit('message', msg);
        
        // 广播给所有连接
        this.broadcast({ type: 'instance_update', ...msg });
      } catch (e) {}
    });
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const socket of this.connections) {
      socket.write(data);
    }
  }

  // 检测所有连接状态
  getConnectedInstances() {
    return {
      count: this.connections.size,
      method: 'WebSocket'
    };
  }

  stop() {
    for (const socket of this.connections) {
      socket.destroy();
    }
    if (this.server) this.server.close();
  }
}

// ============================================================
// 方式6: 服务注册中心（模拟 Consul/etcd）
// ============================================================
class ServiceRegistry {
  constructor() {
    // 模拟服务注册表
    this.services = new Map();
  }

  // 注册服务
  register(instanceId, metadata) {
    this.services.set(instanceId, {
      ...metadata,
      instanceId,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    });
    console.log(`[Registry] 实例 ${instanceId} 注册成功`);
  }

  // 心跳
  heartbeat(instanceId) {
    const service = this.services.get(instanceId);
    if (service) {
      service.lastHeartbeat = Date.now();
      service.status = 'healthy';
    }
  }

  // 获取所有健康实例
  getHealthyInstances() {
    const now = Date.now();
    const healthy = [];
    
    for (const [id, service] of this.services) {
      // 10秒内有心跳认为健康
      if (now - service.lastHeartbeat < 10000) {
        healthy.push({
          ...service,
          method: 'Service Registry (Consul/etcd)'
        });
      }
    }
    
    return healthy;
  }

  // 模拟发现服务
  discover(serviceName) {
    console.log(`[Registry] 发现服务: ${serviceName}`);
    return this.getHealthyInstances();
  }
}

// ============================================================
// 主程序 - 综合演示
// ============================================================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 多种状态检测方法演示');
  console.log('='.repeat(60));
  console.log('');

  // 1. TCP 端口检测演示
  console.log('【方式1: TCP 端口检测】');
  console.log('-'.repeat(40));
  const tcpServer = new TCPHealthCheck(9001);
  await tcpServer.start();
  
  // 模拟检测远程实例
  const tcpResult = await tcpServer.checkRemote('127.0.0.1', 9001);
  console.log('检测结果:', tcpResult);
  console.log('');

  // 2. UDP 心跳演示
  console.log('【方式2: UDP 广播/心跳】');
  console.log('-'.repeat(40));
  const udpServer = new UDPHeartbeat(9002, 'instance-A');
  udpServer.start();
  
  // 模拟接收到其他实例的心跳
  setTimeout(() => {
    const instances = udpServer.getInstances();
    console.log('发现的实例:', instances);
  }, 3000);
  console.log('');

  // 3. Redis 状态同步（模拟）
  console.log('【方式3: Redis Pub/Sub 状态同步】');
  console.log('-'.repeat(40));
  const redisSync = new RedisStatusSync('instance-B');
  redisSync.subscribe('instance_status', (msg) => {
    console.log('[Redis] 收到状态更新:', msg);
  });
  
  redisSync.updateStatus('running');
  console.log('所有实例状态:', redisSync.getAllStatus());
  console.log('');

  // 4. gRPC 健康检查（模拟）
  console.log('【方式4: gRPC 健康检查协议】');
  console.log('-'.repeat(40));
  const grpcCheck = new GRPCHealthCheck();
  const grpcResult = await grpcCheck.checkRemote('localhost', 50051);
  console.log('gRPC 检测结果:', grpcResult);
  console.log('');

  // 5. WebSocket 长连接
  console.log('【方式5: WebSocket 长连接】');
  console.log('-'.repeat(40));
  const wsServer = new WebSocketStatus(9003, 'instance-C');
  wsServer.start();
  
  const wsStatus = wsServer.getConnectedInstances();
  console.log('WebSocket 连接状态:', wsStatus);
  console.log('');

  // 6. 服务注册中心
  console.log('【方式6: 服务注册中心 (Consul/etcd)】');
  console.log('-'.repeat(40));
  const registry = new ServiceRegistry();
  
  registry.register('instance-1', { ip: '192.168.1.10', port: 8080 });
  registry.register('instance-2', { ip: '192.168.1.11', port: 8080 });
  
  // 模拟心跳
  setTimeout(() => {
    registry.heartbeat('instance-1');
    const healthy = registry.discover('my-service');
    console.log('健康实例列表:', healthy);
  }, 1000);
  console.log('');

  // 研究总结
  console.log('='.repeat(60));
  console.log('研究总结: 实例间状态检测方法对比');
  console.log('='.repeat(60));
  
  const summary = `
┌─────────────┬──────────┬──────────┬────────────┐
│   方法       │ 实时性   │ 资源消耗 │   适用场景  │
├─────────────┼──────────┼──────────┼────────────┤
│ HTTP Ping    │ 中等     │ 中等     │ 通用场景    │
│ TCP 端口     │ 高       │ 低       │ 快速检测    │
│ UDP 广播     │ 高       │ 低       │ 局域网发现  │
│ WebSocket    │ 很高     │ 中等     │ 实时通讯    │
│ Redis Pub/Sub│ 高       │ 中等     │ 状态同步    │
│ gRPC         │ 高       │ 中等     │ 微服务      │
│ 服务注册中心  │ 高       │ 高       │ 分布式系统  │
│ 数据库状态   │ 中等     │ 中等     │ 持久化状态  │
│ DNS SRV      │ 低       │ 低       │ 服务发现    │
└─────────────┴──────────┴──────────┴────────────┘
  `;
  console.log(summary);

  console.log('\n【关键发现】');
  console.log('1. 没有"最佳"方案，只有"最适合"的方案');
  console.log('2. 生产环境通常组合使用多种方法');
  console.log('3. 考虑因素: 延迟要求、网络环境、复杂度、可靠性');
  console.log('4. 现代云原生推荐: 服务网格( Istio ) + 服务注册中心');

  // 清理资源
  setTimeout(() => {
    tcpServer.stop();
    udpServer.stop();
    wsServer.stop();
    console.log('\n演示完成，资源已清理');
    process.exit(0);
  }, 5000);
}

main().catch(console.error);