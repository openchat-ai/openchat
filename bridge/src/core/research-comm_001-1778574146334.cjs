// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:22:26.334Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的检测方法
 * 作者：小红（代码专家）
 */

// ============================================================
// 第一部分：模拟服务实例和数据结构
// ============================================================

const EventEmitter = require('events');

// 模拟服务实例
class ServiceInstance {
  constructor(id, port) {
    this.id = id;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = Date.now();
    this.metadata = {
      name: 'demo-service',
      version: '1.0.0',
      region: 'us-east-1'
    };
  }

  setStatus(status) {
    this.status = status;
    this.lastHeartbeat = Date.now();
  }
}

// 服务注册中心（模拟Consul/Etcd）
class ServiceRegistry extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
    this.healthCheckInterval = null;
  }

  register(instance) {
    this.instances.set(instance.id, instance);
    console.log(`📝 [注册] 实例 ${instance.id} 已注册 (端口: ${instance.port})`);
    this.emit('registered', instance);
  }

  deregister(instanceId) {
    const instance = this.instances.get(instanceId);
    if (instance) {
      this.instances.delete(instanceId);
      console.log(`🗑️ [注销] 实例 ${instanceId} 已注销`);
      this.emit('deregistered', instanceId);
    }
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId);
  }

  getAllInstances() {
    return Array.from(this.instances.values());
  }

  getHealthyInstances() {
    return this.getAllInstances().filter(i => i.status === 'healthy');
  }

  // 模拟健康检查
  startHealthCheck(intervalMs = 5000) {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      this.instances.forEach((instance, id) => {
        const timeSinceHeartbeat = now - instance.lastHeartbeat;
        if (timeSinceHeartbeat > intervalMs * 2) {
          instance.setStatus('unhealthy');
          console.log(`⚠️ [超时] 实例 ${id} 已超时 (${timeSinceHeartbeat}ms)`);
          this.emit('instanceUnhealthy', instance);
        }
      });
    }, intervalMs);
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}

// ============================================================
// 第二部分：不同的检测方式实现
// ============================================================

// 方式1: TCP Socket 检测
class TCPHealthChecker {
  static async check(host, port, timeout = 3000) {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      let status = 'unhealthy';

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        status = 'healthy';
        socket.destroy();
      });

      socket.on('timeout', () => {
        socket.destroy();
      });

      socket.on('error', (err) => {
        status = 'unhealthy';
      });

      socket.on('close', () => {
        resolve({
          method: 'TCP Socket',
          host,
          port,
          status,
          timestamp: Date.now()
        });
      });

      socket.connect(port, host);
    });
  }
}

// 方式2: Redis Pub/Sub 心跳检测
class RedisHeartbeatSimulator {
  constructor(registry) {
    this.registry = registry;
    this.heartbeatInterval = null;
  }

  // 模拟发布心跳
  startHeartbeat(instanceId, intervalMs = 2000) {
    const instance = this.registry.getInstance(instanceId);
    if (!instance) return;

    console.log(`💓 [Redis Pub/Sub] 实例 ${instanceId} 开始发送心跳`);

    this.heartbeatInterval = setInterval(() => {
      // 模拟Redis PUBLISH
      const heartbeatData = {
        instanceId,
        timestamp: Date.now(),
        status: 'healthy',
        // 模拟Redis key TTL检测
        ttl: 10
      };

      instance.setStatus('healthy');

      // 模拟Redis订阅者收到消息
      console.log(`📨 [Redis] 收到心跳: instance=${instanceId}, ts=${heartbeatData.timestamp}`);
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}

// 方式3: WebSocket 双向通信检测
class WebSocketHealthSimulator {
  constructor() {
    this.connections = new Map();
    this.messageHandlers = [];
  }

  // 模拟WebSocket连接
  simulateConnection(instanceId) {
    const connection = {
      id: instanceId,
      state: 'connected',
      lastPing: Date.now(),
      lastPong: Date.now()
    };
    this.connections.set(instanceId, connection);
    console.log(`🔌 [WebSocket] 实例 ${instanceId} 已连接`);
    return connection;
  }

  // 模拟Ping/Pong机制
  ping(instanceId) {
    const conn = this.connections.get(instanceId);
    if (!conn) return null;

    conn.lastPing = Date.now();

    // 模拟Pong响应
    setTimeout(() => {
      conn.lastPong = Date.now();
      console.log(`🏓 [WebSocket] 实例 ${instanceId} 响应 Pong`);
    }, 100);

    return {
      method: 'WebSocket Ping/Pong',
      instanceId,
      latency: conn.lastPong - conn.lastPing,
      status: 'healthy'
    };
  }

  // 广播消息到所有实例
  broadcast(message) {
    console.log(`📢 [WebSocket] 广播: ${message}`);
    this.connections.forEach((conn, id) => {
      console.log(`  -> 实例 ${id} 收到消息`);
    });
  }

  closeConnection(instanceId) {
    this.connections.delete(instanceId);
    console.log(`🔌 [WebSocket] 实例 ${instanceId} 已断开`);
  }
}

// 方式4: gRPC 健康检查协议
class GRPCHealthChecker {
  static async check(serviceName) {
    // 模拟gRPC健康检查响应
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          method: 'gRPC Health Check',
          service: serviceName,
          status: 'SERVING', // gRPC健康状态: SERVING, NOT_SERVING, UNKNOWN
          timestamp: Date.now()
        });
      }, Math.random() * 100);
    });
  }

  // 模拟gRPC流式健康检查
  static *streamHealthCheck(serviceName, count = 3) {
    for (let i = 0; i < count; i++) {
      yield {
        method: 'gRPC Stream Health',
        service: serviceName,
        status: 'SERVING',
        sequence: i + 1,
        timestamp: Date.now()
      };
    }
  }
}

// 方式5: UDP 多播/广播检测（局域网发现）
class UDPDiscoverySimulator {
  constructor() {
    this.discoveredServices = [];
  }

  // 模拟UDP广播
  broadcastDiscovery() {
    console.log(`📡 [UDP] 发送广播到 255.255.255.255:9999`);
    return {
      method: 'UDP Broadcast',
      address: '255.255.255.255',
      port: 9999,
      timestamp: Date.now()
    };
  }

  // 模拟收到响应
  simulateResponses(instances) {
    instances.forEach(instance => {
      this.discoveredServices.push({
        id: instance.id,
        address: `192.168.1.${Math.floor(Math.random() * 255)}`,
        port: instance.port,
        method: 'UDP Response'
      });
      console.log(`📡 [UDP] 发现服务: ${instance.id} at 192.168.1.x:${instance.port}`);
    });
    return this.discoveredServices;
  }
}

// 方式6: 服务注册中心（类似Consul/Etcd）
class ServiceDiscoveryClient {
  constructor(registry) {
    this.registry = registry;
  }

  async getHealthyNodes(serviceName) {
    // 模拟从Consul/Etcd获取健康节点
    const healthyInstances = this.registry.getHealthyInstances();
    return healthyInstances.map(i => ({
      Service: serviceName,
      Node: i.id,
      Address: `10.0.0.${Math.floor(Math.random() * 10)}`,
      Port: i.port,
      Status: 'passing', // Consul健康状态: passing, warning, critical
      Checks: ['serfHealth', 'grpc', 'http']
    }));
  }

  async registerService(instance) {
    // 模拟注册到Consul
    console.log(`🏷️ [Consul] 注册服务: ${instance.id}`);
    return { ID: instance.id, Status: 'success' };
  }

  async deregisterService(instanceId) {
    console.log(`🏷️ [Consul] 注销服务: ${instanceId}`);
    return { ID: instanceId, Status: 'success' };
  }
}

// ============================================================
// 第三部分：主程序 - 演示和研究结果
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('🔬 实例间通讯方式研究 - 健康检测方法对比');
  console.log('='.repeat(60));

  // 创建服务注册中心
  const registry = new ServiceRegistry();

  // 创建模拟实例
  const instance1 = new ServiceInstance('instance-1', 3001);
  const instance2 = new ServiceInstance('instance-2', 3002);
  const instance3 = new ServiceInstance('instance-3', 3003);

  // 注册实例
  registry.register(instance1);
  registry.register(instance2);
  registry.register(instance3);

  console.log('\n📊 研究开始...\n');

  // ============================================================
  // 方式1: TCP Socket 检测演示
  // ============================================================
  console.log('--- 方式1: TCP Socket 检测 ---');
  const tcpResults = await Promise.all([
    TCPHealthChecker.check('127.0.0.1', 3001),
    TCPHealthChecker.check('127.0.0.1', 3002),
    TCPHealthChecker.check('127.0.0.1', 9999) // 不存在的端口
  ]);
  tcpResults.forEach(r => {
    console.log(`  ${r.status === 'healthy' ? '✅' : '❌'} ${r.method}: ${r.host}:${r.port} - ${r.status}`);
  });

  // ============================================================
  // 方式2: Redis Pub/Sub 心跳检测演示
  // ============================================================
  console.log('\n--- 方式2: Redis Pub/Sub 心跳检测 ---');
  const redisHeartbeat = new RedisHeartbeatSimulator(registry);
  redisHeartbeat.startHeartbeat('instance-1', 2000);

  // 等待几个心跳周期
  await new Promise(r => setTimeout(r, 4500));
  redisHeartbeat.stopHeartbeat();

  // ============================================================
  // 方式3: WebSocket Ping/Pong 检测演示
  // ============================================================
  console.log('\n--- 方式3: WebSocket Ping/Pong 检测 ---');
  const wsHealth = new WebSocketHealthSimulator();
  wsHealth.simulateConnection('instance-1');
  wsHealth.simulateConnection('instance-2');

  const wsCheck1 = wsHealth.ping('instance-1');
  await new Promise(r => setTimeout(r, 200));
  const wsCheck2 = wsHealth.ping('instance-2');

  wsHealth.broadcast('健康检查广播');

  // 模拟断连
  wsHealth.closeConnection('instance-2');

  // ============================================================
  // 方式4: gRPC 健康检查演示
  // ============================================================
  console.log('\n--- 方式4: gRPC 健康检查协议 ---');
  const grpcResults = await Promise.all([
    GRPCHealthChecker.check('UserService'),
    GRPCHealthChecker.check('PaymentService'),
    GRPCHealthChecker.check('OrderService')
  ]);

  grpcResults.forEach(r => {
    console.log(`  ✅ ${r.method}: ${r.service} - ${r.status}`);
  });

  // gRPC流式检查
  console.log('  流式健康检查:');
  for (const result of GRPCHealthChecker.streamHealthCheck('UserService', 3)) {
    console.log(`    序列${result.sequence}: ${result.status}`);
  }

  // ============================================================
  // 方式5: UDP 广播发现演示
  // ============================================================
  console.log('\n--- 方式5: UDP 多播/广播服务发现 ---');
  const udpDiscovery = new UDPDiscoverySimulator();
  udpDiscovery.broadcastDiscovery();
  const discovered = udpDiscovery.simulateResponses([instance1, instance2, instance3]);
  console.log(`  共发现 ${discovered.length} 个服务`);

  // ============================================================
  // 方式6: 服务注册中心（Consul/Etcd）演示
  // ============================================================
  console.log('\n--- 方式6: 服务注册中心 (Consul/Etcd) ---');
  const discoveryClient = new ServiceDiscoveryClient(registry);

  // 设置一些实例为健康
  instance1.setStatus('healthy');
  instance2.setStatus('healthy');
  instance3.setStatus('unhealthy');

  const healthyNodes = await discoveryClient.getHealthyNodes('demo-service');
  console.log(`  健康节点数量: ${healthyNodes.length}`);
  healthyNodes.forEach(node => {
    console.log(`    ✅ ${node.Node}: ${node.Address}:${node.Port} [${node.Status}]`);
  });

  // ============================================================
  // 研究结果总结
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('📋 研究结果总结');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────────────────────────────────────────────────────┐
│              实例间健康检测方式对比                               │
├──────────────────┬──────────────────────────────────────────────┤
│ 方法              │ 特点                                         │
├──────────────────┼──────────────────────────────────────────────┤
│ 1. HTTP Ping     │ 最简单，但需要HTTP服务器运行                   │
├──────────────────┼──────────────────────────────────────────────┤
│ 2. TCP Socket    │ 更轻量，只需端口可达即可                      │
│                  │ 适用于非HTTP服务                               │
├──────────────────┼──────────────────────────────────────────────┤
│ 3. Redis Pub/Sub │ 支持分布式，带TTL过期检测                      │
│                  │ 适合微服务架构                                 │
├──────────────────┼──────────────────────────────────────────────┤
│ 4. WebSocket     │ 双向通信，支持实时推送                         │
│                  │ 适合需要长连接的场景                           │
├──────────────────┼──────────────────────────────────────────────┤
│ 5. gRPC          │ 高性能，二进制协议                             │
│                  │ 支持流式健康检查                               │
├──────────────────┼──────────────────────────────────────────────┤
│ 6. UDP 广播      │ 局域网自动发现                                 │
│                  │ 适合服务启动时的发现                           │
├──────────────────┼──────────────────────────────────────────────┤
│ 7. Consul/Etcd   │ 完整的服务注册与发现                           │
│                  │ 支持健康检查、心跳、故障转移                   │
└──────────────────┴──────────────────────────────────────────────┘

💡 推荐方案:
   - 简单场景: TCP Socket 检测
   - 微服务: Redis Pub/Sub + Consul/Etcd
   - 高性能: gRPC 健康检查
   - 实时性: WebSocket Ping/Pong
  `;

  console.log(summary;

  // 清理
  registry.stopHealthCheck();
  console.log('\n✅ 研究完成！');
}

// 运行主程序
main().catch(console.error);