// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:20:17.932Z

/**
 * 实例间通讯方式研究
 * 除了HTTP ping外的其他检测姐妹状态的方式
 */

const net = require('net');
const dgram = require('dgram');
const { EventEmitter } = require('events');

// ============================================
// 方式1: TCP 连接检测
// ============================================
class TCPDetector {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.clients = new Map();
  }

  startServer() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[TCP] 新连接: ${clientId}`);
        
        this.clients.set(clientId, { socket, lastHeartbeat: Date.now() });
        
        socket.on('data', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'heartbeat') {
              this.clients.set(clientId, { 
                socket, 
                lastHeartbeat: Date.now() 
              });
              console.log(`[TCP] 收到心跳 from ${clientId}`);
            }
          } catch (e) {}
        });

        socket.on('close', () => {
          console.log(`[TCP] 连接关闭: ${clientId}`);
          this.clients.delete(clientId);
        });
      });

      this.server.listen(this.port, () => {
        console.log(`[TCP] 检测服务启动在端口 ${this.port}`);
        resolve();
      });
    });
  }

  checkClients() {
    const now = Date.now();
    const timeout = 5000;
    console.log(`[TCP] 当前连接数: ${this.clients.size}`);
    for (const [id, client] of this.clients) {
      const status = now - client.lastHeartbeat > timeout ? '不活跃' : '活跃';
      console.log(`[TCP] 客户端 ${id}: ${status}`);
    }
  }

  stop() {
    if (this.server) this.server.close();
  }
}

// ============================================
// 方式2: UDP 广播/多播检测
// ============================================
class UDPMulticastDetector {
  constructor(multicastAddr = '239.255.255.250', port = 41234) {
    this.multicastAddr = multicastAddr;
    this.port = port;
    this.socket = null;
    this.peers = new Map();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true };

      this.socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'announce') {
            this.peers.set(rinfo.address, {
              ...data,
              lastSeen: Date.now(),
              port: rinfo.port
            });
            console.log(`[UDP] 收到来自 ${rinfo.address} 的公告`);
          }
        } catch (e) {}
      });

      this.socket.bind(this.port, () => {
        this.socket.addMembership(this.multicastAddr);
        console.log(`[UDP] 多播监听启动: ${this.multicastAddr}:${this.port}`);
        resolve();
      });
    });
  }

  announce(instanceId, metadata = {}) {
    const message = Buffer.from(JSON.stringify({
      type: 'announce',
      instanceId,
      metadata,
      timestamp: Date.now()
    }));
    
    this.socket.send(message, 0, message.length, this.port, this.multicastAddr);
    console.log(`[UDP] 发送公告: ${instanceId}`);
  }

  getPeers() {
    const now = Date.now();
    const activePeers = [];
    
    for (const [addr, peer] of this.peers) {
      if (now - peer.lastSeen < 10000) {
        activePeers.push(peer);
      }
    }
    
    return activePeers;
  }

  stop() {
    if (this.socket) {
      this.socket.dropMembership(this.multicastAddr);
      this.socket.close();
    }
  }
}

// ============================================
// 方式3: 基于 Redis 的状态检测
// ============================================
class RedisStatusDetector {
  constructor(redisClient = null) {
    this.redis = redisClient;
    this.instanceId = `instance-${process.pid}`;
  }

  // 模拟 Redis 操作 (不依赖真实Redis连接)
  async registerStatus(status = 'healthy') {
    const key = `instance:status:${this.instanceId}`;
    const expiry = 10; // 10秒过期
    console.log(`[Redis] 设置状态: ${this.instanceId} = ${status}, TTL=${expiry}s`);
    // 真实实现: await this.redis.setex(key, expiry, status);
    return true;
  }

  async getAllStatuses() {
    const allStatus = {
      'instance-1': 'healthy',
      'instance-2': 'healthy',
      'instance-3': 'unhealthy',
    };
    console.log('[Redis] 获取所有实例状态:', allStatus);
    return allStatus;
  }

  async publishHeartbeat() {
    const channel = 'instance heartbeat';
    const payload = JSON.stringify({
      instanceId: this.instanceId,
      status: 'healthy',
      timestamp: Date.now()
    });
    console.log(`[Redis] 发布心跳到 ${channel}`);
    // 真实实现: await this.redis.publish(channel, payload);
    return true;
  }

  async subscribeToHeartbeats(callback) {
    console.log('[Redis] 订阅心跳频道...');
    // 真实实现: const subscriber = this.redis.duplicate();
    // await subscriber.subscribe('instance heartbeat');
    // subscriber.on('message', (ch, msg) => callback(JSON.parse(msg)));
    setInterval(() => {
      callback({ instanceId: 'sister-instance', timestamp: Date.now() };
    }, 2000);
  }
}

// ============================================
// 方式4: 数据库状态表
// ============================================
class DatabaseStatusDetector {
  constructor() {
    this.statusTable = new Map();
  }

  async updateStatus(instanceId, status) {
    const record = {
      instanceId,
      status,
      updatedAt: new Date().toISOString(),
      leader: false
    };
    this.statusTable.set(instanceId, record);
    console.log(`[DB] 更新状态: ${instanceId} -> ${status}`);
    return record;
  }

  async getActiveInstances() {
    const now = Date.now();
    const activeInstances = [];
    
    for (const [id, record] of this.statusTable) {
      const lastUpdate = new Date(record.updatedAt).getTime();
      if (now - lastUpdate < 10000) {
        activeInstances.push(record);
      }
    }
    
    console.log(`[DB] 活跃实例数: ${activeInstances.length}`);
    return activeInstances;
  }

  async electLeader() {
    const active = await this.getActiveInstances();
    if (active.length > 0) {
      active.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      const leader = active[0];
      leader.leader = true;
      console.log(`[DB] 选出的Leader: ${leader.instanceId}`);
      return leader;
    }
    return null;
  }
}

// ============================================
// 方式5: 服务发现 (DNS SRV 记录)
// ============================================
class DNSServiceDiscovery {
  constructor() {
    // 模拟 DNS 记录
    this.dnsRecords = [
      { target: 'instance1.local', port: 3000, priority: 1, weight: 10 },
      { target: 'instance2.local', port: 3001, priority: 1, weight: 10 },
      { target: 'instance3.local', port: 3002, priority: 2, weight: 5 },
    ];
  }

  async lookup(serviceName) {
    console.log(`[DNS] 查询服务: ${serviceName}`);
    // 真实实现: 使用 dns.resolveSrv 或第三方库
    return this.dnsRecords.sort((a, b) => a.priority - b.priority);
  }

  async healthCheck(record) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;
      
      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        console.log(`[DNS] ${record.target}:${record.port} 可达`);
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(record.port, record.target);
    });
  }

  async getHealthyInstances() {
    const records = await this.lookup('my-service');
    const results = await Promise.all(
      records.map(async (r) => ({
        ...r,
        healthy: await this.healthCheck(r)
      }))
    );
    
    console.log('[DNS] 健康检查结果:', results);
    return results.filter(r => r.healthy);
  }
}

// ============================================
// 主研究程序
// ============================================
async function runResearch() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 姐妹状态检测');
  console.log('='.repeat(60));

  // 研究结果总结
  const methods = [
    {
      name: 'HTTP Ping/REST',
      description: '通过HTTP请求检测状态',
      pros: '简单通用,易于调试',
      cons: '需要HTTP服务,开销相对较大',
      complexity: '低'
    },
    {
      name: 'TCP 心跳',
      description: '保持TCP长连接,定期发送心跳',
      pros: '开销小,无需HTTP层',
      cons: '需要维护连接池',
      complexity: '中'
    },
    {
      name: 'UDP 多播/广播',
      description: '通过UDP多播公告状态',
      pros: '无需中心节点,发现快',
      cons: '不可靠,局域网限定',
      complexity: '中'
    },
    {
      name: 'Redis Pub/Sub',
      description: '通过Redis发布订阅机制',
      pros: '支持跨机器,消息可靠',
      cons: '需要Redis基础设施',
      complexity: '中'
    },
    {
      name: 'Redis Keyspace',
      description: '利用键空间通知',
      pros: '自动过期检测',
      cons: '需要Redis支持',
      complexity: '中'
    },
    {
      name: '数据库状态表',
      description: '共享数据库记录状态',
      pros: '持久化,可查询历史',
      cons: '有单点依赖',
      complexity: '低'
    },
    {
      name: 'DNS SRV记录',
      description: '通过DNS服务发现',
      pros: '标准协议,客户端透明',
      cons: '更新延迟,功能有限',
      complexity: '中'
    },
    {
      name: 'gRPC 流',
      description: 'gRPC双向流',
      pros: '高效,支持多语言',
      cons: '需要gRPC基础设施',
      complexity: '高'
    },
    {
      name: '消息队列',
      description: 'RabbitMQ/Kafka等',
      pros: '可靠,支持复杂场景',
      cons: '运维复杂',
      complexity: '高'
    },
    {
      name: 'mDNS/Bonjour',
      description: '局域网零配置发现',
      pros: '无需配置,自动发现',
      cons: '仅限局域网',
      complexity: '中'
    }
  ];

  console.log('\n📊 状态检测方式对比:\n');
  console.table(methods.map(m => ({
    方式: m.name,
    描述: m.description,
    复杂度: m.complexity,
    优点: m.pros.split(',')[0],
    缺点: m.cons.split(',')[0]
  })));

  // 演示各种检测方式
  console.log('\n' + '='.repeat(60));
  console.log('实际演示各种检测方式');
  console.log('='.repeat(60));

  // 1. TCP 检测演示
  console.log('\n--- 方式1: TCP 心跳检测 ---');
  const tcpDetector = new TCPDetector(3001);
  await tcpDetector.startServer();
  tcpDetector.checkClients();

  // 2. UDP 多播演示
  console.log('\n--- 方式2: UDP 多播检测 ---');
  const udpDetector = new UDPMulticastDetector();
  await udpDetector.start();
  udpDetector.announce('my-instance-1', { role: 'worker' });
  udpDetector.announce('my-instance-2', { role: 'api' });
  console.log('发现的对等节点:', udpDetector.getPeers());

  // 3. Redis 模拟
  console.log('\n--- 方式3: Redis 状态检测 ---');
  const redisDetector = new RedisStatusDetector();
  await redisDetector.registerStatus('healthy');
  await redisDetector.getAllStatuses();
  redisDetector.subscribeToHeartbeats((msg) => {
    console.log('[Redis] 收到姐妹实例心跳:', msg);
  });

  // 4. 数据库状态表
  console.log('\n--- 方式4: 数据库状态表 ---');
  const dbDetector = new DatabaseStatusDetector();
  await dbDetector.updateStatus('instance-A', 'healthy');
  await dbDetector.updateStatus('instance-B', 'healthy');
  await dbDetector.updateStatus('instance-C', 'unhealthy');
  await dbDetector.getActiveInstances();
  await dbDetector.electLeader();

  // 5. DNS 服务发现
  console.log('\n--- 方式5: DNS 服务发现 ---');
  const dnsDiscovery = new DNSServiceDiscovery();
  await dnsDiscovery.lookup('my-service');
  await dnsDiscovery.getHealthyInstances();

  // 清理
  tcpDetector.stop();
  udpDetector.stop();

  // 最终建议
  console.log('\n' + '='.repeat(60));
  console.log('💡 建议');
  console.log('='.repeat(60));
  console.log(`
1. 小规模/开发环境: 使用 HTTP ping 最简单直接
2. 中等规模: 推荐 Redis Pub/Sub 或 TCP 心跳
3. 大规模/生产环境: 
   - 需要服务发现用: DNS SRV / mDNS
   - 需要高可靠性用: Redis + Keyspace Notifications
   - 需要跨区域用: 数据库状态表 + 消息队列

4. 最佳实践:
   - 组合多种方式 (如: UDP发现 + TCP心跳 + Redis状态)
   - 设置合理的超时和重试机制
   - 实现自动故障转移 (Leader Election)
   - 监控告警及时发现异常
  `);
}

// 运行研究
runResearch().catch(console.error);