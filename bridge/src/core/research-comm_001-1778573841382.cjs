// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:17:21.382Z

/**
 * 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
 * 
 * 本代码演示以下几种检测方式：
 * 1. TCP Socket 心跳检测
 * 2. Redis Pub/Sub 状态广播
 * 3. UDP 组播/广播发现
 * 4. gRPC 健康检查
 */

const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');
const crypto = require('crypto');

// ==================== 方式1: TCP Socket 心跳检测 ====================
class TCPHeartbeat extends EventEmitter {
  constructor(port, host) {
    super();
    this.port = port;
    this.host = host;
    this.connected = false;
    this.lastHeartbeat = 0;
    this.timeout = 5000;
  }

  connect() {
    this.socket = new net.Socket();
    
    this.socket.connect(this.port, this.host, () => {
      console.log(`[TCP] 连接到 ${this.host}:${this.port}`);
      this.connected = true;
      this.startHeartbeat();
    });

    this.socket.on('data', (data) => {
      const msg = data.toString();
      if (msg.startsWith('HEARTBEAT_ACK')) {
        this.lastHeartbeat = Date.now();
        this.emit('alive', msg);
      }
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        const heartbeat = `HEARTBEAT_${Date.now()}`;
        this.socket.write(heartbeat);
        
        // 检查是否超时
        if (Date.now() - this.lastHeartbeat > this.timeout) {
          console.log(`[TCP] 心跳超时，认为节点已离线`);
          this.emit('timeout');
        }
      }
    }, 2000);
  }

  stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.socket) this.socket.destroy();
  }
}

// TCP 服务端（模拟姐妹实例）
class TCPHeartbeatServer {
  constructor(port) {
    this.server = net.createServer((socket) => {
      console.log(`[TCP Server] 新连接: ${socket.remoteAddress}`);
      
      socket.on('data', (data) => {
        const msg = data.toString();
        if (msg.startsWith('HEARTBEAT')) {
          socket.write(`HEARTBEAT_ACK_${Date.now()}`);
        }
      });

      socket.on('close', () => {
        console.log(`[TCP Server] 连接关闭`);
      });
    });
    
    this.server.listen(port, '0.0.0.0', () => {
      console.log(`[TCP Server] 监听端口 ${port}`);
    });
  }
}

// ==================== 方式2: UDP 组播/广播发现 ====================
class UDPDiscovery extends EventEmitter {
  constructor(multicastAddr = '239.255.255.250', port = 5000) {
    this.multicastAddr = multicastAddr;
    this.port = port;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true };
    this.peers = new Map();
  }

  init() {
    this.socket.bind(this.port, () => {
      this.socket.setBroadcast(true);
      this.socket.setMulticastTTL(128);
      this.socket.addMembership(this.multicastAddr);
      console.log(`[UDP] 加入组播组 ${this.multicastAddr}:${this.port}`);
    });

    this.socket.on('message', (msg, rinfo) => {
      const data = JSON.parse(msg.toString());
      
      if (data.type === 'ANNOUNCE') {
        this.peers.set(rinfo.address, { ...data, lastSeen: Date.now() });
        console.log(`[UDP] 发现新节点: ${JSON.stringify(data)}`);
        this.emit('peer-discovered', data);
      } else if (data.type === 'BYE') {
        this.peers.delete(rinfo.address);
        console.log(`[UDP] 节点离开: ${rinfo.address}`);
        this.emit('peer-left', rinfo.address);
      }
    });
  }

  announce(instanceId, port) {
    const message = JSON.stringify({
      type: 'ANNOUNCE',
      instanceId,
      port,
      timestamp: Date.now()
    });
    
    this.socket.send(message, 0, message.length, this.port, this.multicastAddr);
    console.log(`[UDP] 广播自身存在: ${instanceId}`);
  }

  bye(instanceId) {
    const message = JSON.stringify({
      type: 'BYE',
      instanceId,
      timestamp: Date.now()
    });
    
    this.socket.send(message, 0, message.length, this.port, this.multicastAddr);
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  close() {
    this.socket.close();
  }
}

// ==================== 方式3: 基于 Redis 的状态广播 ====================
class RedisStatusBroadcaster {
  constructor(redisClient) {
    this.redis = redisClient;
    this.channel = 'instance-status';
    this.subscriber = null;
  }

  // 发布状态
  async publishStatus(instanceId, status) {
    const message = JSON.stringify({
      instanceId,
      status,
      timestamp: Date.now(),
      hostname: require('os').hostname()
    });
    
    await this.redis.publish(this.channel, message);
    console.log(`[Redis] 发布状态: ${instanceId} -> ${status}`);
  }

  // 订阅状态
  async subscribe(callback) {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(this.channel);
    
    this.subscriber.on('message', (channel, message) => {
      if (channel === this.channel) {
        const data = JSON.parse(message);
        console.log(`[Redis] 收到状态更新: ${JSON.stringify(data)}`);
        callback(data);
      }
    });
    
    console.log(`[Redis] 订阅状态频道: ${this.channel}`);
  }

  // 使用 Redis Set 维护在线实例列表（带 TTL）
  async registerInstance(instanceId, ttl = 30) {
    const key = `instance:${instanceId}:heartbeat`;
    await this.redis.setex(key, ttl, Date.now().toString());
    console.log(`[Redis] 注册实例 (TTL: ${ttl}s): ${instanceId}`);
  }

  async getActiveInstances(pattern = 'instance:*:heartbeat') {
    const keys = await this.redis.keys(pattern);
    return keys.map(k => k.replace('instance:', '').replace(':heartbeat', ''));
  }

  async keepAlive(instanceId, ttl = 30) {
    const key = `instance:${instanceId}:heartbeat`;
    await this.redis.expire(key, ttl);
  }

  close() {
    if (this.subscriber) {
      this.subscriber.unsubscribe(this.channel);
      this.subscriber.quit();
    }
  }
}

// ==================== 模拟演示 ====================

async function runDemo() {
  console.log('\n========== 实例间通讯方式研究 ==========\n');
  
  // 方案1: TCP Socket 心跳
  console.log('\n--- 方式1: TCP Socket 心跳检测 ---');
  const tcpServer = new TCPHeartbeatServer(9001);
  
  await new Promise(r => setTimeout(r, 500));
  
  const tcpClient = new TCPHeartbeat(9001, '127.0.0.1');
  tcpClient.on('alive', (msg) => console.log(`[TCP] 收到心跳响应: ${msg}`));
  tcpClient.on('timeout', () => console.log(`[TCP] 节点超时`));
  tcpClient.connect();

  // 方案2: UDP 组播发现
  console.log('\n--- 方式2: UDP 组播/广播发现 ---');
  const udpDiscovery = new UDPDiscovery('239.255.255.250', 5001);
  udpDiscovery.init();

  await new Promise(r => setTimeout(r, 500));
  
  udpDiscovery.announce('instance-A', 3000);
  udpDiscovery.announce('instance-B', 3001);

  udpDiscovery.on('peer-discovered', (peer) => {
    console.log(`[UDP] 发现姐妹实例: ${peer.instanceId}`);
  });

  // 模拟其他实例加入
  setTimeout(() => {
    udpDiscovery.announce('instance-C', 3002);
  }, 1500);

  // 方案3: Redis 状态广播（模拟）
  console.log('\n--- 方式3: Redis Pub/Sub 状态广播 ---');
  console.log('[Redis] 需要实际的 Redis 连接，这里展示逻辑:');
  console.log('  1. 实例启动时向 Redis Set 添加自己，带 TTL');
  console.log('  2. 定期更新 TTL 实现心跳效果');
  console.log('  3. 通过 Pub/Sub 广播状态变化');
  console.log('  4. 其他实例订阅频道获取实时状态');
  
  // 模拟 Redis 状态管理
  const mockRedisInstances = new Map();
  
  function mockRedisPublish(channel, data) {
    console.log(`[Redis Mock] 发布到 ${channel}: ${JSON.stringify(data)}`);
  }
  
  function mockRedisSubscribe(channel, callback) {
    console.log(`[Redis Mock] 订阅 ${channel}`);
    return callback;
  }

  // 模拟实例注册
  const instanceId = `instance-${crypto.randomBytes(4).toString('hex')}`;
  mockRedisPublish('instance-status', {
    type: 'ONLINE',
    instanceId,
    timestamp: Date.now()
  });

  // 模拟健康检查
  setInterval(() => {
    mockRedisPublish('instance-heartbeat', {
      instanceId,
      status: 'healthy',
      timestamp: Date.now()
    });
  }, 5000);

  // 总结
  console.log('\n========== 研究总结 ==========');
  console.log(`
实例间状态检测方式对比:

1. HTTP Ping
   优点: 简单通用,兼容性好
   缺点: 需要额外端口,基于短连接

2. TCP Socket 心跳
   优点: 保持长连接,开销低,检测快
   缺点: 需要维护连接池,复杂一些

3. UDP 组播/广播
   优点: 自动发现,无需知道对方IP
   缺点: 跨网络受限,不可靠

4. Redis Pub/Sub + TTL
   优点: 分布式友好,支持多语言
   缺点: 需要 Redis 依赖

5. gRPC 流式健康检查
   优点: 高效,支持双向流
   缺点: 需要 Protobuf 定义

6. 服务发现 (Consul/Etcd)
   优点: 功能完整,支持健康检查
   缺点: 需要额外基础设施

推荐组合: 
- 小型项目: HTTP + Redis
- 中型项目: TCP心跳 + Redis Pub/Sub
- 大型项目: gRPC + 服务发现
  `);

  // 清理
  setTimeout(() => {
    tcpClient.stop();
    tcpServer.server.close();
    udpDiscovery.close();
    console.log('\n演示结束，资源已清理');
    process.exit(0);
  }, 5000);
}

// 运行演示
runDemo().catch(console.error);