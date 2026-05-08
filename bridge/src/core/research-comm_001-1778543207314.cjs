// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:46:47.314Z

/**
 * 实例间通讯方式研究
 * 除了HTTP ping外的其他检测姐妹状态的方式
 */

const net = require('net');
const http = require('http');
const EventEmitter = require('events');
const { createClient } = require('redis');

// ==================== 模拟实例类 ====================
class ServiceInstance {
  constructor(id, port) {
    this.id = id;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = Date.now();
    this.peers = new Map(); // 存储姐妹实例状态
  }

  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
  }

  setPeerStatus(peerId, status) {
    this.peers.set(peerId, { status, lastUpdate: Date.now() });
  }
}

// ==================== 方式1: TCP Socket 心跳 ====================
class TCPHeartbeat extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.server = null;
    this.connections = new Map();
  }

  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`[TCP] 新连接: ${clientId}`);

      // 发送心跳
      socket.write(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() });

      // 接收心跳响应
      socket.on('data', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ack') {
            this.emit('peerAlive', msg.instanceId);
          }
        } catch (e) {
          console.error('[TCP] 解析错误:', e.message);
        }
      });

      socket.on('close', () => {
        console.log(`[TCP] 连接关闭: ${clientId}`);
        this.emit('peerDead', clientId);
      });

      socket.on('error', (err) => {
        console.error(`[TCP] 错误: ${err.message}`);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[TCP] 心跳服务器启动在端口 ${this.port}`);
    });
  }

  connectToPeer(host, port) {
    const socket = net.createConnection({ port, host };
    const peerId = `${host}:${port}`;

    socket.on('connect', () => {
      console.log(`[TCP] 已连接到姐妹实例 ${peerId}`);
    });

    // 定期发送心跳
    setInterval(() => {
      if (socket.writable) {
        socket.write(JSON.stringify({ 
          type: 'heartbeat', 
          timestamp: Date.now(),
          instanceId: 'self'
        });
      }
    }, 2000);

    socket.on('data', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'heartbeat') {
          socket.write(JSON.stringify({ type: 'ack', instanceId: 'self' });
          this.emit('peerAlive', peerId);
        }
      } catch (e) {
        console.error('[TCP] 解析错误:', e.message);
      }
    });

    return socket;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

// ==================== 方式2: Redis Pub/Sub 心跳 ====================
class RedisHeartbeat extends EventEmitter {
  constructor(instanceId, redisUrl) {
    super();
    this.instanceId = instanceId;
    this.redisUrl = redisUrl;
    this.client = null;
    this.subscriber = null;
    this.heartbeatChannel = 'instance-heartbeat';
    this.statusChannel = 'instance-status';
  }

  async start() {
    try {
      this.client = createClient({ url: this.redisUrl });
      this.subscriber = this.client.duplicate();

      await this.client.connect();
      await this.subscriber.connect();

      console.log('[Redis] 已连接到 Redis');

      // 订阅状态更新
      await this.subscriber.subscribe(this.statusChannel, (message) => {
        try {
          const status = JSON.parse(message);
          this.emit('peerUpdate', status);
        } catch (e) {
          console.error('[Redis] 解析错误:', e.message);
        }
      });

      // 定期发布心跳状态
      setInterval(async () => {
        const status = {
          instanceId: this.instanceId,
          status: 'alive',
          timestamp: Date.now(),
          port: 3000 + Math.floor(Math.random() * 1000)
        };
        await this.client.publish(this.statusChannel, JSON.stringify(status));
      }, 3000);

      console.log('[Redis] 心跳发布已启动');
    } catch (e) {
      console.error('[Redis] 连接失败:', e.message);
    }
  }

  async stop() {
    if (this.client) await this.client.quit();
    if (this.subscriber) await this.subscriber.quit();
  }
}

// ==================== 方式3: UDP 多播发现 ====================
const dgram = require('dgram');
const MULTICAST_GROUP = '239.255.255.250';
const DISCOVERY_PORT = 41234;

class UDPDiscovery extends EventEmitter {
  constructor(instanceId) {
    super();
    this.instanceId = instanceId;
    this.socket = null;
  }

  start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.instanceId !== this.instanceId) {
          console.log(`[UDP] 发现姐妹实例: ${data.instanceId} @ ${rinfo.address}:${rinfo.port}`);
          this.emit('discovered', data);
        }
      } catch (e) {
        console.error('[UDP] 解析错误:', e.message);
      }
    });

    this.socket.bind(DISCOVERY_PORT, () => {
      this.socket.setBroadcast(true);
      this.socket.setMulticastTTL(128);
      this.socket.addMembership(MULTICAST_GROUP);
      console.log(`[UDP] 发现服务启动，监听端口 ${DISCOVERY_PORT}`);
    });

    // 定期广播自己的存在
    setInterval(() => {
      const message = JSON.stringify({
        instanceId: this.instanceId,
        status: 'alive',
        timestamp: Date.now()
      });
      this.socket.send(message, DISCOVERY_PORT, MULTICAST_GROUP);
    }, 5000);
  }

  stop() {
    if (this.socket) {
      this.socket.close();
    }
  }
}

// ==================== 方式4: 基于共享存储的状态检测 ====================
class SharedStoreHealthCheck extends EventEmitter {
  constructor(instanceId, redisUrl) {
    super();
    this.instanceId = instanceId;
    this.redisUrl = redisUrl;
    this.client = null;
    this.healthKey = 'instances:health';
    this.ttl = 10; // 10秒超时认为实例死亡
  }

  async start() {
    try {
      this.client = createClient({ url: this.redisUrl });
      await this.client.connect();
      console.log('[SharedStore] 已连接到 Redis');

      // 定期更新自己的健康状态
      setInterval(async () => {
        await this.client.hSet(this.healthKey, this.instanceId, JSON.stringify({
          status: 'healthy',
          timestamp: Date.now()
        }));
      }, 2000);

      // 定期检查所有实例的健康状态
      setInterval(async () => {
        const allInstances = await this.client.hGetAll(this.healthKey);
        const now = Date.now();

        for (const [instanceId, data] of Object.entries(allInstances)) {
          if (instanceId === this.instanceId) continue;

          try {
            const info = JSON.parse(data);
            const age = (now - info.timestamp) / 1000;

            if (age > this.ttl) {
              console.log(`[SharedStore] 实例 ${instanceId} 已死亡 (离线 ${age.toFixed(1)}秒)`);
              this.emit('peerDead', instanceId);
            } else {
              console.log(`[SharedStore] 实例 ${instanceId} 存活 (在线 ${age.toFixed(1)}秒)`);
              this.emit('peerAlive', instanceId, info);
            }
          } catch (e) {
            console.error(`[SharedStore] 解析错误: ${e.message}`);
          }
        }
      }, 3000);

    } catch (e) {
      console.error('[SharedStore] 错误:', e.message);
    }
  }

  async stop() {
    if (this.client) {
      await this.client.hDel(this.healthKey, this.instanceId);
      await this.client.quit();
    }
  }
}

// ==================== 主程序 - 演示各种方式 ====================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法对比');
  console.log('='.repeat(60));

  const instanceId = `instance-${process.pid}`;
  const results = [];

  // 方式1: TCP Socket 心跳
  console.log('\n--- 方式1: TCP Socket 心跳 ---');
  console.log('原理: 建立TCP长连接，定期交换心跳包');
  console.log('优点: 可靠、低延迟、支持双向通信');
  console.log('缺点: 需要维护连接、扩展性一般');
  results.push({ 方式: 'TCP Socket', 可靠性: '高', 延迟: '低', 复杂度: '中' });

  // 方式2: Redis Pub/Sub
  console.log('\n--- 方式2: Redis Pub/Sub 心跳 ---');
  console.log('原理: 通过发布/订阅模式广播状态变化');
  console.log('优点: 支持多订阅者、解耦、适合分布式');
  console.log('缺点: 需要Redis基础设施、可能有延迟');
  results.push({ 方式: 'Redis Pub/Sub', 可靠性: '高', 延迟: '低', 复杂度: '中' });

  // 方式3: UDP 多播
  console.log('\n--- 方式3: UDP 多播/广播发现 ---');
  console.log('原理: 在局域网内广播/多播发现其他实例');
  console.log('优点: 自动发现、无需配置地址、适合容器环境');
  console.log('缺点: 跨网络受限、不可靠(UDP)');
  results.push({ 方式: 'UDP多播', 可靠性: '中', 延迟: '低', 复杂度: '低' });

  // 方式4: 共享存储
  console.log('\n--- 方式4: 共享存储 (Redis/数据库) ---');
  console.log('原理: 所有实例向共享存储写入状态，其他实例读取');
  console.log('优点: 简单、可靠、适合Kubernetes等环境');
  console.log('缺点: 依赖外部存储、有一定延迟');
  results.push({ 方式: '共享存储', 可靠性: '高', 延迟: '中', 复杂度: '低' });

  // 方式5: gRPC
  console.log('\n--- 方式5: gRPC 流式心跳 ---');
  console.log('原理: 使用HTTP/2和Protocol Buffers进行高效通信');
  console.log('优点: 高性能、多语言支持、双向流');
  console.log('缺点: 需要定义proto、配置复杂');
  results.push({ 方式: 'gRPC', 可靠性: '高', 延迟: '低', 复杂度: '高' });

  // 方式6: 服务发现 (Consul/Etcd)
  console.log('\n--- 方式6: 服务发现系统 (Consul/Etcd) ---');
  console.log('原理: 使用专门的服务发现工具管理实例健康');
  console.log('优点: 功能全面、支持健康检查、服务注册');
  console.log('缺点: 需要额外基础设施、学习曲线');
  results.push({ 方式: 'Consul/Etcd', 可靠性: '高', 延迟: '低', 复杂度: '高' });

  // 打印对比表格
  console.log('\n' + '='.repeat(60));
  console.log('对比总结表:');
  console.log('='.repeat(60));
  console.table(results);

  // 实际演示 - 启动 TCP 心跳服务器
  console.log('\n--- 实际演示: TCP 心跳 ---');
  const tcpHeartbeat = new TCPHeartbeat(9000);
  tcpHeartbeat.start();

  // 模拟连接到姐妹实例
  setTimeout(() => {
    console.log('\n模拟启动姐妹实例连接...');
    const peerSocket = tcpHeartbeat.connectToPeer('127.0.0.1', 9001);
  }, 1000);

  // 演示 UDP 发现
  console.log('\n--- 实际演示: UDP 多播发现 ---');
  const udpDiscovery = new UDPDiscovery(instanceId);
  udpDiscovery.start();

  udpDiscovery.on('discovered', (data) => {
    console.log(`发现新姐妹实例: ${data.instanceId}`);
  });

  // 尝试 Redis 方式 (需要Redis服务器)
  console.log('\n--- 实际演示: Redis 共享存储 (需要Redis服务器) ---');
  try {
    const sharedStore = new SharedStoreHealthCheck(instanceId, 'redis://localhost:6379');
    await sharedStore.start();

    sharedStore.on('peerAlive', (peerId, info) => {
      console.log(`检测到存活姐妹: ${peerId}`);
    });

    sharedStore.on('peerDead', (peerId) => {
      console.log(`检测到死亡姐妹: ${peerId}`);
    });
  } catch (e) {
    console.log('Redis 未运行，跳过共享存储演示');
    console.log('如需测试，请启动 Redis: docker run -d -p 6379:6379 redis');
  }

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n\n正在关闭...');
    tcpHeartbeat.stop();
    udpDiscovery.stop();
    process.exit(0);
  });
}

// 运行主程序
main().catch(console.error);