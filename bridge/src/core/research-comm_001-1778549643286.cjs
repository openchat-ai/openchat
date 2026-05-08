// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:34:03.286Z

/**
 * 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
 * 
 * 本代码将演示以下几种检测方式：
 * 1. TCP Socket 连接检测
 * 2. Redis Pub/Sub 心跳检测
 * 3. UDP 广播心跳
 * 4. gRPC 健康检查
 * 5. 服务发现 (Consul/Etcd 模拟)
 */

const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');
const http = require('http');

// ==================== 模拟服务实例类 ====================
class ServiceInstance extends EventEmitter {
  constructor(instanceId, port) {
    super();
    this.instanceId = instanceId;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = Date.now();
    this.metadata = {
      name: 'demo-service',
      version: '1.0.0',
      region: 'us-east-1'
    };
  }

  updateStatus(status) {
    this.status = status;
    this.lastHeartbeat = Date.now();
    this.emit('statusChange', { instanceId: this.instanceId, status });
  }
}

// ==================== 方式1: TCP Socket 检测 ====================
class TCPServiceDetector {
  constructor() {
    this.instances = new Map();
  }

  addInstance(instance) {
    this.instances.set(instance.instanceId, instance);
  }

  // 检测实例是否可达
  async checkInstance(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: 'Instance not found' };

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        // 发送自定义协议消息
        socket.write(JSON.stringify({ 
          type: 'health_check', 
          timestamp: Date.now() 
        } + '\n');
        
        socket.destroy();
        resolve({ 
          success: true, 
          method: 'TCP',
          instanceId,
          responseTime: Date.now() - instance.lastHeartbeat 
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ 
          success: false, 
          method: 'TCP',
          instanceId,
          error: 'Connection timeout' 
        });
      });

      socket.on('error', (err) => {
        resolve({ 
          success: false, 
          method: 'TCP',
          instanceId,
          error: err.message 
        });
      });

      socket.connect(instance.port, '127.0.0.1');
    });
  }

  // 批量检测所有实例
  async checkAll() {
    const results = [];
    for (const [id] of this.instances) {
      results.push(await this.checkInstance(id));
    }
    return results;
  }
}

// ==================== 方式2: Redis Pub/Sub 心跳检测 ====================
class RedisPubSubHeartbeat extends EventEmitter {
  constructor(redisClient) {
    super();
    this.redis = redisClient;
    this.channel = 'service:heartbeat';
    this.subscribers = new Map(); // instanceId -> lastSeen
    this.checkInterval = null;
  }

  // 模拟发布心跳
  async publishHeartbeat(instanceId, status) {
    const message = JSON.stringify({
      instanceId,
      status,
      timestamp: Date.now(),
      metadata: { cpu: Math.random() * 100, memory: Math.random() * 100 }
    });
    // 模拟发布到Redis
    console.log(`[Redis Pub/Sub] Instance ${instanceId} published heartbeat: ${status}`);
    this.subscribers.set(instanceId, Date.now());
    return message;
  }

  // 模拟订阅心跳
  async subscribe() {
    console.log('[Redis Pub/Sub] Subscribed to heartbeat channel');
    // 模拟接收其他实例的心跳
    setInterval(() => {
      const activeInstances = Array.from(this.subscribers.keys());
      activeInstances.forEach(instanceId => {
        const lastSeen = this.subscribers.get(instanceId);
        const isAlive = Date.now() - lastSeen < 10000; // 10秒内的心跳视为存活
        this.emit('heartbeat', { instanceId, alive: isAlive, lastSeen });
      });
    }, 2000);
  }

  // 获取所有活跃实例
  getActiveInstances() {
    const active = [];
    const now = Date.now();
    for (const [instanceId, lastSeen] of this.subscribers) {
      if (now - lastSeen < 10000) {
        active.push(instanceId);
      }
    }
    return active;
  }
}

// ==================== 方式3: UDP 广播心跳 ====================
class UDPHeartbeat extends EventEmitter {
  constructor(port = 41234) {
    super();
    this.port = port;
    this.server = null;
    this.clients = new Map();
  }

  startServer() {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'heartbeat') {
          this.clients.set(data.instanceId, {
            ...data,
            address: rinfo.address,
            port: rinfo.port,
            lastSeen: Date.now()
          });
          this.emit('heartbeat', data);
        }
      } catch (e) {
        console.error('Invalid UDP message:', e.message);
      }
    });

    this.server.bind(this.port, () => {
      console.log(`[UDP] Heartbeat server listening on port ${this.port}`);
    });
  }

  // 广播心跳
  broadcast(instanceId, status) {
    const message = JSON.stringify({
      type: 'heartbeat',
      instanceId,
      status,
      timestamp: Date.now()
    });
    
    const buffer = Buffer.from(message);
    this.server.send(buffer, 0, buffer.length, this.port, '255.255.255.255', (err) => {
      if (err) console.error('[UDP] Broadcast error:', err);
    });
  }

  // 获取所有活跃客户端
  getActiveClients() {
    const active = [];
    const now = Date.now();
    for (const [instanceId, client] of this.clients) {
      if (now - client.lastSeen < 5000) {
        active.push(client);
      }
    }
    return active;
  }
}

// ==================== 方式4: gRPC 健康检查 (模拟) ====================
class GRPCHealthChecker {
  constructor() {
    this.services = new Map();
  }

  // 模拟gRPC健康检查协议
  async checkHealth(instanceId, address) {
    // 实际生产中会使用 @grpc/health-check 包
    console.log(`[gRPC] Sending health check to ${instanceId} at ${address}`);
    
    // 模拟检查响应
    const mockResponse = {
      status: 'SERVING', // SERVING, NOT_SERVING, UNKNOWN
      version: '1.0.0'
    };

    return {
      success: true,
      method: 'gRPC',
      instanceId,
      healthStatus: mockResponse.status,
      metadata: mockResponse
    };
  }

  // 模拟流式健康监控
  streamHealthCheck(instanceId, callback) {
    const interval = setInterval(() => {
      const health = {
        status: Math.random() > 0.1 ? 'SERVING' : 'NOT_SERVING',
        timestamp: Date.now()
      };
      callback(health);
    }, 2000);

    return () => clearInterval(interval);
  }
}

// ==================== 方式5: 服务发现 (模拟Consul/Etcd) ====================
class ServiceDiscovery {
  constructor() {
    this.registry = new Map();
    this.watchers = [];
  }

  // 注册服务实例
  register(instance) {
    this.registry.set(instance.instanceId, {
      ...instance,
      registeredAt: Date.now(),
      healthCheck: 'passing'
    });
    console.log(`[Service Discovery] Registered: ${instance.instanceId}`);
    this.notifyWatchers();
  }

  // 注销服务实例
  deregister(instanceId) {
    this.registry.delete(instanceId);
    console.log(`[Service Discovery] Deregistered: ${instanceId}`);
    this.notifyWatchers();
  }

  // 获取所有健康实例
  getHealthyInstances() {
    const healthy = [];
    for (const [id, instance] of this.registry) {
      if (instance.healthCheck === 'passing') {
        healthy.push(instance);
      }
    }
    return healthy;
  }

  // 设置健康状态
  setHealthStatus(instanceId, status) {
    const instance = this.registry.get(instanceId);
    if (instance) {
      instance.healthCheck = status;
      this.notifyWatchers();
    }
  }

  // 模拟Watch机制 (类似Consul Watch)
  watch(callback) {
    this.watchers.push(callback);
    return () => {
      this.watchers = this.watchers.filter(w => w !== callback);
    };
  }

  notifyWatchers() {
    const instances = this.getHealthyInstances();
    this.watchers.forEach(cb => cb(instances));
  }
}

// ==================== 主程序：综合演示 ====================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究：多种状态检测方法演示');
  console.log('='.repeat(60));

  // 创建模拟实例
  const instances = [
    new ServiceInstance('instance-1', 3001),
    new ServiceInstance('instance-2', 3002),
    new ServiceInstance('instance-3', 3003)
  ];

  // 方式1: TCP Socket 检测
  console.log('\n--- 方式1: TCP Socket 连接检测 ---');
  const tcpDetector = new TCPServiceDetector();
  instances.forEach(i => tcpDetector.addInstance(i));
  
  // 模拟TCP检测结果
  console.log('[模拟] 尝试TCP连接到各实例...');
  const tcpResults = await tcpDetector.checkAll();
  tcpResults.forEach(r => {
    console.log(`  ${r.instanceId}: ${r.success ? '可达' : '不可达'} (${r.method})`);
  });

  // 方式2: Redis Pub/Sub 心跳
  console.log('\n--- 方式2: Redis Pub/Sub 心跳检测 ---');
  const redisHeartbeat = new RedisPubSubHeartbeat({});
  
  // 模拟各实例发布心跳
  for (const instance of instances) {
    await redisHeartbeat.publishHeartbeat(instance.instanceId, 'healthy');
  }
  
  // 订阅并监听
  await redisHeartbeat.subscribe();
  setTimeout(() => {
    console.log(`  活跃实例: ${redisHeartbeat.getActiveInstances().join(', ')}`);
  }, 2500);

  // 方式3: UDP 广播心跳
  console.log('\n--- 方式3: UDP 广播心跳 ---');
  const udpHeartbeat = new UDPHeartbeat(41234);
  udpHeartbeat.startServer();

  // 模拟各实例发送UDP心跳
  instances.forEach(instance => {
    udpHeartbeat.broadcast(instance.instanceId, 'healthy');
  });

  setTimeout(() => {
    const activeClients = udpHeartbeat.getActiveClients();
    console.log(`  UDP检测到的活跃实例: ${activeClients.length} 个`);
    activeClients.forEach(c => console.log(`    - ${c.instanceId}: ${c.status}`));
  }, 1000);

  // 方式4: gRPC 健康检查
  console.log('\n--- 方式4: gRPC 健康检查 ---');
  const grpcChecker = new GRPCHealthChecker();
  
  for (const instance of instances) {
    const result = await grpcChecker.checkHealth(instance.instanceId, `127.0.0.1:${instance.port}`);
    console.log(`  ${result.instanceId}: ${result.healthStatus} (${result.method})`);
  }

  // 方式5: 服务发现 (Consul/Etcd)
  console.log('\n--- 方式5: 服务发现 (Consul/Etcd模式) ---');
  const serviceDiscovery = new ServiceDiscovery();
  
  // 注册实例
  instances.forEach(i => serviceDiscovery.register(i));
  
  // 设置Watch监听变化
  const unwatch = serviceDiscovery.watch((healthyInstances) => {
    console.log(`  [Watch通知] 健康实例更新: ${healthyInstances.map(i => i.instanceId).join(', ')}`);
  });

  // 模拟状态变化
  setTimeout(() => {
    serviceDiscovery.setHealthStatus('instance-2', 'critical');
  }, 3000);

  // 演示完成
  setTimeout(() => {
    unwatch();
    console.log('\n' + '='.repeat(60));
    console.log('研究总结：实例间状态检测方式对比');
    console.log('='.repeat(60));
    
    console.log(`
┌─────────────────┬──────────┬──────────┬────────────┐
│ 检测方式        │ 延迟     │ 资源消耗  │ 可靠性      │
├─────────────────┼──────────┼──────────┼────────────┤
│ HTTP Ping       │ 中等     │ 中等      │ 高          │
│ TCP Socket      │ 低       │ 低       │ 高          │
│ Redis Pub/Sub   │ 低       │ 中等      │ 高          │
│ UDP 广播        │ 最低     │ 最低      │ 中等(可能丢包)│
│ gRPC            │ 低       │ 中等      │ 高          │
│ 服务发现(Consul)│ 低       │ 中等      │ 最高        │
└─────────────────┴──────────┴──────────┴────────────┘

推荐方案组合:
1. 生产环境: 服务发现(Consul/Etcd) + gRPC 健康检查
2. 容器环境: 服务发现 + HTTP健康检查
3. 低延迟场景: UDP广播 + TCP确认
4. 简单场景: Redis Pub/Sub 心跳
    `);
    
    console.log('\n✓ 研究演示完成！');
    process.exit(0);
  }, 4000);
}

// 运行主程序
main().catch(console.error);