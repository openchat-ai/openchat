// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:08:08.892Z

/**
 * 实例间通讯方式研究
 * 除了HTTP ping外的其他状态检测方式
 */

const net = require('net');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const os = require('os');

// ============================================
// 方式1: TCP Socket 心跳检测
// ============================================
class TcpHeartbeat {
  constructor(port, instanceId) {
    this.port = port;
    this.instanceId = instanceId;
    this.server = null;
    this.clients = new Map();
    this.emitter = new EventEmitter();
  }

  // 启动TCP服务器
  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`[TCP] 新连接: ${clientId}`);

      this.clients.set(clientId, { socket, lastHeartbeat: Date.now() });

      socket.on('data', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            // 响应pong
            socket.write(JSON.stringify({
              type: 'pong',
              instanceId: this.instanceId,
              timestamp: Date.now()
            }));
            const client = this.clients.get(clientId);
            if (client) client.lastHeartbeat = Date.now();
          }
        } catch (e) {}
      });

      socket.on('close', () => {
        console.log(`[TCP] 断开连接: ${clientId}`);
        this.clients.delete(clientId);
      });

      socket.on('error', (err) => {
        console.log(`[TCP] 错误: ${err.message}`);
        this.clients.delete(clientId);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[TCP] 服务器启动于端口 ${this.port}`);
    });
  }

  // 连接到其他实例并检测状态
  connectToPeer(address, port) {
    const socket = net.createConnection({ port, host: address }, () => {
      console.log(`[TCP] 已连接到 ${address}:${port}`);
    });

    const peerId = `${address}:${port}`;
    this.clients.set(peerId, { socket, lastHeartbeat: Date.now() });

    // 定时发送ping
    setInterval(() => {
      if (socket.writable) {
        socket.write(JSON.stringify({ type: 'ping', instanceId: this.instanceId });
      }
    }, 3000);

    socket.on('data', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pong') {
        console.log(`[TCP] 收到 ${peerId} 的pong响应: 实例${msg.instanceId}`);
        const client = this.clients.get(peerId);
        if (client) client.lastHeartbeat = Date.now();
      }
    });

    return socket;
  }

  // 检查连接状态
  checkStatus() {
    const now = Date.now();
    const status = {};
    for (const [clientId, client] of this.clients) {
      const isAlive = now - client.lastHeartbeat < 10000;
      status[clientId] = isAlive ? 'alive' : 'dead';
      console.log(`[TCP] 状态: ${clientId} -> ${isAlive ? '在线' : '离线'}`);
    }
    return status;
  }

  stop() {
    if (this.server) this.server.close();
    for (const [, client] of this.clients) {
      client.socket.end();
    }
  }
}

// ============================================
// 方式2: UDP 广播发现 (适用于局域网)
// ============================================
class UdpDiscovery {
  constructor(broadcastPort, instanceId) {
    this.broadcastPort = broadcastPort;
    this.instanceId = instanceId;
    this.socket = null;
    this.peers = new Map();
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'announce') {
          console.log(`[UDP] 发现新实例: ${rinfo.address}:${data.port} (${data.instanceId})`);
          this.peers.set(rinfo.address, {
            ...data,
            address: rinfo.address,
            lastSeen: Date.now()
          });
        }
      } catch (e) {}
    });

    this.socket.bind(this.broadcastPort, () => {
      this.socket.setBroadcast(true);
      console.log(`[UDP] 监听端口 ${this.broadcastPort}`);
    });
  }

  // 广播自己的存在
  announce(port) {
    const message = JSON.stringify({
      type: 'announce',
      instanceId: this.instanceId,
      port: port,
      timestamp: Date.now()
    });

    // 广播到255.255.255.255
    const broadcastAddr = '255.255.255.255';
    this.socket.send(message, this.broadcastPort, broadcastAddr, (err) => {
      if (err) console.log(`[UDP] 广播错误: ${err.message}`);
      else console.log(`[UDP] 已广播实例 ${this.instanceId}`);
    });
  }

  // 定期广播
  startBroadcasting(port) {
    this.announce(port);
    setInterval(() => this.announce(port), 5000);
  }

  // 获取所有发现的 peers
  getPeers() {
    const now = Date.now();
    const activePeers = {};
    for (const [addr, peer] of this.peers) {
      if (now - peer.lastSeen < 15000) {
        activePeers[addr] = peer;
      }
    }
    return activePeers;
  }

  stop() {
    if (this.socket) this.socket.close();
  }
}

// ============================================
// 方式3: 基于 Redis 的状态同步 (Pub/Sub + 键过期)
// ============================================
class RedisStatusSync {
  constructor(redisClient, instanceId) {
    this.client = redisClient;
    this.instanceId = instanceId;
    this.channel = 'instance_heartbeat';
  }

  // 模拟: 发布心跳
  async publishHeartbeat(status = 'alive') {
    const message = JSON.stringify({
      instanceId: this.instanceId,
      status,
      timestamp: Date.now(),
      hostname: os.hostname(),
      pid: process.pid
    });
    // 实际使用: await this.client.publish(this.channel, message);
    console.log(`[Redis] 发布心跳: ${message}`);
    return message;
  }

  // 模拟: 更新状态键 (带TTL)
  async updateStatusKey(ttlSeconds = 10) {
    const key = `instance:${this.instanceId}:status`;
    const value = JSON.stringify({
      status: 'alive',
      updatedAt: Date.now()
    });
    // 实际使用: 
    // await this.client.setex(key, ttlSeconds, value);
    // await this.client.hset('instances:status', this.instanceId, value);
    console.log(`[Redis] 更新状态键 ${key}, TTL: ${ttlSeconds}s`);
    return key;
  }

  // 模拟: 获取所有实例状态
  async getAllInstanceStatus() {
    // 实际使用: 
    // return await this.client.hgetall('instances:status');
    console.log(`[Redis] 获取所有实例状态`);
    return {
      'instance-1': JSON.stringify({ status: 'alive', updatedAt: Date.now() },
      'instance-2': JSON.stringify({ status: 'alive', updatedAt: Date.now() - 5000 },
      'instance-3': JSON.stringify({ status: 'dead', updatedAt: Date.now() - 30000 }
    };
  }

  // 模拟: 订阅状态变化
  subscribe() {
    console.log(`[Redis] 订阅频道: ${this.channel}`);
    // 实际使用:
    // const subscriber = this.client.duplicate();
    // subscriber.subscribe(this.channel);
    // subscriber.on('message', (ch, msg) => { ... });
  }
}

// ============================================
// 方式4: 服务发现 (Consul/Etcd 风格)
// ============================================
class ServiceRegistry {
  constructor() {
    this.registry = new Map();
  }

  // 模拟注册服务
  register(instanceId, metadata) {
    this.registry.set(instanceId, {
      ...metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    });
    console.log(`[Registry] 注册实例: ${instanceId}`);
  }

  // 模拟心跳
  heartbeat(instanceId) {
    const instance = this.registry.get(instanceId);
    if (instance) {
      instance.lastHeartbeat = Date.now();
      console.log(`[Registry] 收到心跳: ${instanceId}`);
    }
  }

  // 获取健康实例
  getHealthyInstances(maxAgeMs = 15000) {
    const now = Date.now();
    const healthy = [];
    for (const [id, instance] of this.registry) {
      if (now - instance.lastHeartbeat < maxAgeMs) {
        healthy.push({ id, ...instance };
      }
    }
    return healthy;
  }

  // 获取所有实例状态
  getAllStatus() {
    const now = Date.now();
    const status = {};
    for (const [id, instance] of this.registry) {
      const age = now - instance.lastHeartbeat;
      status[id] = {
        healthy: age < 15000,
        lastHeartbeat: instance.lastHeartbeat,
        ageMs: age
      };
    }
    return status;
  }
}

// ============================================
// 主程序: 演示各种检测方式
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法');
  console.log('='.repeat(60));

  // ----------------------------------------
  // 1. TCP Socket 心跳检测
  // ----------------------------------------
  console.log('\n【方式1】TCP Socket 心跳检测');
  console.log('-'.repeat(40));
  
  const tcpServer = new TcpHeartbeat(9001, 'instance-1');
  tcpServer.start();

  // 模拟连接到其他实例
  setTimeout(() => {
    tcpServer.connectToPeer('127.0.0.1', 9002);
  }, 1000);

  // 定期检查状态
  setInterval(() => {
    tcpServer.checkStatus();
  }, 8000);

  // ----------------------------------------
  // 2. UDP 广播发现
  // ----------------------------------------
  console.log('\n【方式2】UDP 广播发现 (局域网)');
  console.log('-'.repeat(40));

  const udpDiscovery = new UdpDiscovery(9003, 'instance-1');
  udpDiscovery.start();
  udpDiscovery.startBroadcasting(9001);

  // 模拟收到其他实例的广播
  setTimeout(() => {
    console.log('[UDP] 模拟收到其他实例的广播');
    udpDiscovery.peers.set('192.168.1.101', {
      instanceId: 'instance-2',
      port: 9002,
      lastSeen: Date.now()
    });
  }, 2000);

  // ----------------------------------------
  // 3. Redis 状态同步 (模拟)
  // ----------------------------------------
  console.log('\n【方式3】Redis 状态同步 (Pub/Sub + Key TTL)');
  console.log('-'.repeat(40));

  const redisSync = new RedisStatusSync({}, 'instance-1');
  
  // 发布心跳
  await redisSync.publishHeartbeat();
  
  // 更新状态键
  await redisSync.updateStatusKey(10);
  
  // 获取所有实例状态
  const allStatus = await redisSync.getAllInstanceStatus();
  console.log('[Redis] 所有实例状态:', allStatus);
  
  // 订阅状态变化
  redisSync.subscribe();

  // ----------------------------------------
  // 4. 服务注册中心 (模拟 Consul/Etcd)
  // ----------------------------------------
  console.log('\n【方式4】服务注册中心 (Consul/Etcd 风格)');
  console.log('-'.repeat(40));

  const registry = new ServiceRegistry();

  // 注册多个实例
  registry.register('instance-1', { ip: '192.168.1.100', port: 9001 });
  registry.register('instance-2', { ip: '192.168.1.101', port: 9002 });
  registry.register('instance-3', { ip: '192.168.1.102', port: 9003 });

  // 模拟心跳
  registry.heartbeat('instance-1');
  registry.heartbeat('instance-2');

  // 获取健康实例
  const healthyInstances = registry.getHealthyInstances();
  console.log('[Registry] 健康实例:', healthyInstances);

  // 获取所有状态
  const allRegistryStatus = registry.getAllStatus();
  console.log('[Registry] 所有实例状态:', allRegistryStatus);

  // ----------------------------------------
  // 研究总结
  // ----------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('研究总结: 实例间状态检测方式');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────────────────────────────────────────────────┐
│ 检测方式              │ 优点                    │ 适用场景         │
├─────────────────────────────────────────────────────────────┤
│ 1. HTTP/HTTPS Ping   │ 简单易用,兼容性好       │ 通用,跨语言    │
│ 2. TCP Socket        │ 更轻量,无需HTTP开销    │ 高性能场景      │
│ 3. UDP 广播/多播     │ 自动发现,局域网高效    │ 服务发现        │
│ 4. Redis Pub/Sub     │ 分布式,无需直接连接    │ 多实例协调      │
│ 5. Redis Key TTL     │ 简单状态,故障自动过期  │ 健康检查        │
│ 6. Consul/Etcd       │ 专业服务发现,高可用    │ 生产环境        │
│ 7. gRPC              │ 高效,双向流,多语言     │ 微服务          │
│ 8. MQTT              │ 轻量,低带宽,QoS       │ IoT/移动端      │
│ 9. 数据库状态表      │ 简单,可靠              │ 小规模部署      │
│ 10. WebSocket        │ 双向,实时              │ 需要实时通信    │
└─────────────────────────────────────────────────────────────┘

推荐方案:
- 小型项目: HTTP + Redis Key TTL
- 中型项目: TCP心跳 + Redis Pub/Sub
- 大型项目: Consul/Etcd + gRPC
- 容器环境: Kubernetes健康检查 + Service Mesh
  `;

  console.log(summary);

  // 清理资源
  setTimeout(() => {
    tcpServer.stop();
    udpDiscovery.stop();
    console.log('\n演示完成,资源已清理');
    process.exit(0);
  }, 5000);
}

// 运行主程序
main().catch(console.error);