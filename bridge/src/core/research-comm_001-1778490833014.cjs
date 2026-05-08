// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:13:53.014Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究的检测方式：
 * 1. TCP Socket 心跳检测
 * 2. Redis Pub/Sub 发布订阅
 * 3. UDP 广播发现
 * 4. 共享数据库轮询
 * 5. gRPC 流式健康检查
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

// ============================================================
// 模拟工具类
// ============================================================

class Instance extends EventEmitter {
  constructor(id, port) {
    super();
    this.id = id;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = null;
    this.neighbors = new Map();
  }

  updateStatus(status) {
    this.status = status;
    this.lastHeartbeat = Date.now();
    this.emit('statusChange', { id: this.id, status, time: this.lastHeartbeat });
  }
}

// ============================================================
// 方式1: TCP Socket 心跳检测
// ============================================================

class TCPHeartbeatDetector {
  constructor() {
    this.server = null;
    this.clients = new Map();
    this.instances = new Map();
  }

  // 启动TCP服务器
  start(port) {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[TCP] 新连接: ${clientId}`);
        
        socket.on('data', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'heartbeat') {
              this.handleHeartbeat(msg.instanceId, socket);
            }
          } catch (e) {
            console.error('[TCP] 解析错误:', e.message);
          }
        });

        socket.on('close', () => {
          console.log(`[TCP] 连接关闭: ${clientId}`);
          this.clients.delete(clientId);
        });

        socket.on('error', (err) => {
          console.error(`[TCP] 错误: ${err.message}`);
        });
      });

      this.server.listen(port, () => {
        console.log(`[TCP] 心跳服务器启动在端口 ${port}`);
        resolve();
      });
    });
  }

  handleHeartbeat(instanceId, socket) {
    if (!this.instances.has(instanceId)) {
      this.instances.set(instanceId, new Instance(instanceId, 0));
    }
    const instance = this.instances.get(instanceId);
    instance.updateStatus('alive');
    instance.lastHeartbeat = Date.now();
    
    // 响应心跳
    socket.write(JSON.stringify({ type: 'ack', timestamp: Date.now() });
  }

  // 模拟实例发送心跳
  simulateInstanceHeartbeat(instanceId, targetPort) {
    const socket = net.createConnection({ port: targetPort }, () => {
      console.log(`[TCP] 实例 ${instanceId} 连接到心跳服务器`);
      
      // 定期发送心跳
      const interval = setInterval(() => {
        socket.write(JSON.stringify({
          type: 'heartbeat',
          instanceId: instanceId,
          timestamp: Date.now(),
          status: 'healthy'
        }));
      }, 1000);

      socket.on('data', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ack') {
          console.log(`[TCP] 实例 ${instanceId} 收到心跳确认`);
        }
      });

      socket.on('close', () => clearInterval(interval));
    });
  }

  // 检测实例状态（超时则认为离线）
  checkStatus(instanceId, timeout = 5000) {
    const instance = this.instances.get(instanceId);
    if (!instance) return 'unknown';
    
    if (Date.now() - instance.lastHeartbeat > timeout) {
      return 'offline';
    }
    return 'alive';
  }

  close() {
    if (this.server) this.server.close();
    this.clients.forEach(s => s.destroy());
  }
}

// ============================================================
// 方式2: Redis Pub/Sub 状态同步（模拟）
// ============================================================

class RedisPubSubDetector extends EventEmitter {
  constructor() {
    super();
    this.subscribed = false;
    this.instanceStates = new Map();
    // 模拟Redis连接
    this模拟Redis连接();
  }

  模拟Redis连接() {
    console.log('[Redis Pub/Sub] 模拟Redis连接建立');
  }

  // 订阅状态主题
  subscribe(channel) {
    this.subscribed = true;
    console.log(`[Redis Pub/Sub] 订阅频道: ${channel}`);
    
    // 模拟接收其他实例的消息
    setInterval(() => {
      this.emit('message', {
        channel,
        message: JSON.stringify({
          type: 'heartbeat',
          instanceId: `instance-${Math.floor(Math.random() * 3)}`,
          status: 'alive',
          timestamp: Date.now()
        })
      });
    }, 2000);
  }

  // 发布状态
  publish(channel, message) {
    console.log(`[Redis Pub/Sub] 发布到 ${channel}:`, message);
    // 模拟发布成功
    return true;
  }

  // 处理接收到的消息
  handleMessage(data) {
    try {
      const msg = JSON.parse(data.message);
      this.instanceStates.set(msg.instanceId, {
        status: msg.status,
        lastUpdate: msg.timestamp
      });
      console.log(`[Redis Pub/Sub] 更新实例 ${msg.instanceId} 状态: ${msg.status}`);
    } catch (e) {
      console.error('[Redis Pub/Sub] 消息解析错误:', e.message);
    }
  }

  getInstanceStatus(instanceId) {
    return this.instanceStates.get(instanceId) || { status: 'unknown' };
  }
}

// ============================================================
// 方式3: UDP 广播发现
// ============================================================

class UDPDiscovery extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.knownInstances = new Map();
  }

  start(port) {
    return new Promise((resolve) => {
      this.server = dgram.createSocket('udp4');
      
      this.server.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'announce') {
            console.log(`[UDP] 发现新实例: ${data.instanceId} from ${rinfo.address}:${rinfo.port}`);
            this.knownInstances.set(data.instanceId, {
              address: rinfo.address,
              port: rinfo.port,
              lastSeen: Date.now()
            });
            this.emit('instanceFound', data);
          }
        } catch (e) {
          console.error('[UDP] 消息解析错误:', e.message);
        }
      });

      this.server.on('listening', () => {
        const address = this.server.address();
        console.log(`[UDP] 发现服务启动在 ${address.address}:${address.port}`);
        this.server.setBroadcast(true);
        resolve();
      });

      this.server.bind(port);
    });
  }

  // 广播自身存在
  broadcast(instanceId, port) {
    const message = JSON.stringify({
      type: 'announce',
      instanceId: instanceId,
      port: port,
      timestamp: Date.now()
    });
    
    const buffer = Buffer.from(message);
    // 广播到本地网络
    this.server.send(buffer, 0, buffer.length, port, '255.255.255.255', (err) => {
      if (err) console.error('[UDP] 广播错误:', err.message);
      else console.log(`[UDP] 广播: ${instanceId}`);
    });
  }

  // 直接发送UDP消息给特定实例
  sendTo(targetAddress, targetPort, data) {
    const message = JSON.stringify(data);
    const buffer = Buffer.from(message);
    
    this.server.send(buffer, 0, buffer.length, targetPort, targetAddress, (err) => {
      if (err) console.error('[UDP] 发送错误:', err.message);
    });
  }

  getKnownInstances() {
    return Array.from(this.knownInstances.entries()).map(([id, info]) => ({
      id,
      ...info,
      status: Date.now() - info.lastSeen < 10000 ? 'alive' : 'offline'
    }));
  }

  close() {
    if (this.server) this.server.close();
  }
}

// ============================================================
// 方式4: 共享数据库轮询
// ============================================================

class DatabasePollingDetector {
  constructor() {
    this.instanceRegistry = new Map();
    // 模拟数据库表
    this.模拟数据库表();
  }

  模拟数据库表() {
    console.log('[Database] 初始化实例注册表');
    // 预填充一些实例
    this.instanceRegistry.set('instance-1', { 
      status: 'alive', 
      lastHeartbeat: Date.now() - 2000 
    });
    this.instanceRegistry.set('instance-2',{ 
      status: 'alive', 
      lastHeartbeat: Date.now() - 5000 
    });
  }

  // 模拟实例更新自己的状态
  async updateHeartbeat(instanceId) {
    this.instanceRegistry.set(instanceId, {
      status: 'alive',
      lastHeartbeat: Date.now()
    });
    console.log(`[Database] 实例 ${instanceId} 更新心跳`);
  }

  // 轮询所有实例状态
  async pollAllInstances(timeout = 10000) {
    const results = [];
    const now = Date.now();
    
    for (const [id, info] of this.instanceRegistry) {
      const isAlive = (now - info.lastHeartbeat) < timeout;
      results.push({
        instanceId: id,
        status: isAlive ? 'alive' : 'offline',
        lastHeartbeat: info.lastHeartbeat,
        method: 'database_polling'
      });
    }
    
    console.log('[Database] 轮询结果:', results.map(r => `${r.instanceId}:${r.status}`).join(', '));
    return results;
  }

  // 乐观锁更新（防止并发问题）
  async atomicUpdate(instanceId) {
    // 模拟CAS操作
    const current = this.instanceRegistry.get(instanceId);
    if (current) {
      current.lastHeartbeat = Date.now();
      current.status = 'alive';
      console.log(`[Database] 实例 ${instanceId} 原子更新成功`);
      return true;
    }
    return false;
  }
}

// ============================================================
// 方式5: gRPC 健康检查流（模拟）
// ============================================================

class GRPCHealthChecker extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map();
    this.instanceHealth = new Map();
  }

  // 模拟gRPC健康检查流
  createHealthStream(instanceId) {
    console.log(`[gRPC] 为实例 ${instanceId} 创建健康检查流`);
    
    // 模拟双向流
    const stream = {
      instanceId,
      write: (data) => {
        console.log(`[gRPC] 发送健康检查请求到 ${instanceId}`);
      },
      on: (event, callback) => {
        if (event === 'data') {
          // 模拟定期收到健康响应
          setInterval(() => {
            callback({
              instanceId,
              status: 'SERVING',
              timestamp: Date.now()
            });
          }, 1500);
        }
        if (event === 'end') {
          callback();
        }
      },
      end: () => {
        console.log(`[gRPC] 流关闭: ${instanceId}`);
        this.streams.delete(instanceId);
      }
    };

    this.streams.set(instanceId, stream);
    return stream;
  }

  // 处理健康检查响应
  handleHealthResponse(response) {
    this.instanceHealth.set(response.instanceId, {
      status: response.status,
      lastUpdate: response.timestamp
    });
    console.log(`[gRPC] 实例 ${response.instanceId} 健康状态: ${response.status}`);
  }

  // 获取所有实例健康状态
  getHealthStatus() {
    const status = {};
    for (const [id, info] of this.instanceHealth) {
      status[id] = info.status === 'SERVING' ? 'healthy' : 'unhealthy';
    }
    return status;
  }

  closeStream(instanceId) {
    const stream = this.streams.get(instanceId);
    if (stream) stream.end();
  }
}

// ============================================================
// 主程序：综合演示
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法对比');
  console.log('='.repeat(60));
  console.log('');

  // 1. TCP Socket 心跳检测
  console.log('\n--- 方式1: TCP Socket 心跳检测 ---');
  const tcpDetector = new TCPHeartbeatDetector();
  await tcpDetector.start(9999);
  
  // 模拟实例连接
  tcpDetector.simulateInstanceHeartbeat('app-instance-1', 9999);
  tcpDetector.simulateInstanceHeartbeat('app-instance-2', 9999);
  
  await new Promise(r => setTimeout(r, 3000));
  console.log(`[TCP] 实例状态检查: app-instance-1 = ${tcpDetector.checkStatus('app-instance-1')}`);
  console.log(`[TCP] 实例状态检查: app-instance-2 = ${tcpDetector.checkStatus('app-instance-2')}`);

  // 2. Redis Pub/Sub
  console.log('\n--- 方式2: Redis Pub/Sub 发布订阅 ---');
  const redisDetector = new RedisPubSubDetector();
  redisDetector.subscribe('instance-health');
  
  // 模拟发布消息
  setInterval(() => {
    redisDetector.publish('instance-health', {
      type: 'heartbeat',
      instanceId: 'app-instance-3',
      status: 'alive',
      timestamp: Date.now()
    });
  }, 3000);

  redisDetector.on('message', (data) => redisDetector.handleMessage(data));
  
  await new Promise(r => setTimeout(r, 3000));
  console.log(`[Redis] 实例状态: app-instance-1 = ${redisDetector.getInstanceStatus('app-instance-1').status}`);

  // 3. UDP 广播发现
  console.log('\n--- 方式3: UDP 广播发现 ---');
  const udpDiscovery = new UDPDiscovery();
  await udpDiscovery.start(8888);
  
  // 模拟广播
  udpDiscovery.broadcast('app-instance-1', 8888);
  udpDiscovery.broadcast('app-instance-2', 8888);
  
  await new Promise(r => setTimeout(r, 2000));
  console.log('[UDP] 已发现实例:', udpDiscovery.getKnownInstances());

  // 4. 数据库轮询
  console.log('\n--- 方式4: 共享数据库轮询 ---');
  const dbDetector = new DatabasePollingDetector();
  
  await dbDetector.updateHeartbeat('app-instance-1');
  await dbDetector.updateHeartbeat('app-instance-2');
  
  const pollResults = await dbDetector.pollAllInstances(10000);
  console.log('[Database] 轮询结果:', pollResults);

  // 5. gRPC 健康检查流
  console.log('\n--- 方式5: gRPC 流式健康检查 ---');
  const grpcChecker = new GRPCHealthChecker();
  
  const stream1 = grpcChecker.createHealthStream('app-instance-1');
  stream1.on('data', (response) => grpcChecker.handleHealthResponse(response));
  
  await new Promise(r => setTimeout(r, 3000));
  console.log('[gRPC] 健康状态:', grpcChecker.getHealthStatus());

  // 总结对比
  console.log('\n' + '='.repeat(60));
  console.log('研究总结：实例间状态检测方式对比');
  console.log('='.repeat(60));
  
  const summary = `
┌─────────────────┬──────────┬──────────┬────────────┬─────────┐
│ 检测方式        │ 实时性   │ 资源消耗 │ 可靠性     │ 适用场景 │
├─────────────────┼──────────┼──────────┼────────────┼─────────┤
│ HTTP Ping       │ 中       │ 中       │ 高         │ 通用    │
│ TCP Socket      │ 高       │ 低       │ 高         │ 高性能  │
│ Redis Pub/Sub   │ 高       │ 低       │ 高         │ 分布式  │
│ UDP 广播        │ 高       │ 低       │ 中         │ 局域网  │
│ 数据库轮询      │ 低       │ 中       │ 高         │ 持久化  │
│ gRPC 流         │ 高       │ 中       │ 高         │ 微服务  │
│ mDNS/Bonjour    │ 高       │ 低       │ 中         │ 局域网  │
│ Consul/Etcd     │ 高       │ 中       │ 极高       │ 生产环境│
└─────────────────┴──────────┴──────────┴────────────┴─────────┘

关键发现：
1. TCP Socket 相比 HTTP 更轻量，无需完整的 HTTP 头部
2. Redis Pub/Sub 适合多实例状态同步，不仅能检测存活还能传递状态
3. UDP 广播适合服务发现阶段，但不适合持续心跳
4. 数据库轮询适合需要持久化状态的场景
5. gRPC 流式检查效率最高，适合大规模微服务架构
  `;
  console.log(summary);

  // 清理
  setTimeout(() => {
    tcpDetector.close();
    udpDiscovery.close();
    console.log('\n演示完成，资源已清理');
    process.exit(0);
  }, 1000);
}

// 运行主程序
main().catch(console.error);