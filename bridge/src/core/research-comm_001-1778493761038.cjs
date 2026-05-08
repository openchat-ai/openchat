// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T10:02:41.038Z

/**
 * 实例间通讯方式研究
 * 除了HTTP ping外的多种状态检测方法
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

// ============================================
// 方法1: TCP Socket 心跳检测
// ============================================
class TCPHeartbeat extends EventEmitter {
  constructor(port, host) {
    super();
    this.port = port;
    this.host = host;
    this.client = null;
    this.interval = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = new net.Socket();
      
      this.client.connect(this.port, this.host, () => {
        console.log(`[TCP] 连接到 ${this.host}:${this.port}`);
        resolve();
      });

      this.client.on('error', (err) => {
        console.log(`[TCP] 连接错误: ${err.message}`);
        this.emit('down', err);
      });

      this.client.on('close', () => {
        console.log('[TCP] 连接关闭');
        this.emit('down');
      });

      this.client.on('data', (data) => {
        const msg = data.toString();
        if (msg === 'pong') {
          this.emit('pong');
        }
      });
    });
  }

  startHeartbeat(intervalMs = 3000) {
    this.interval = setInterval(() => {
      if (this.client && !this.client.destroyed) {
        this.client.write('ping');
        console.log('[TCP] 发送心跳 ping');
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.client) this.client.destroy();
  }
}

// TCP服务器 - 模拟被检测的实例
function createTCPServer(port) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        if (data.toString().trim() === 'ping') {
          socket.write('pong');
        }
      });
    });
    server.listen(port, () => {
      console.log(`[TCP Server] 监听端口 ${port}`);
      resolve(server);
    });
  });
}

// ============================================
// 方法2: UDP 广播检测
// ============================================
class UDPDiscovery extends EventEmitter {
  constructor(broadcastPort) {
    super();
    this.server = null;
    this.broadcastPort = broadcastPort;
    this.clients = new Map();
  }

  start() {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      const data = JSON.parse(msg.toString());
      
      if (data.type === 'announce') {
        console.log(`[UDP] 收到实例公告: ${rinfo.address}:${data.port}`);
        this.clients.set(rinfo.address, {
          address: rinfo.address,
          port: data.port,
          lastSeen: Date.now()
        });
        this.emit('instanceFound', { address: rinfo.address, port: data.port });
      }
    });

    this.server.bind(this.broadcastPort, () => {
      this.server.setBroadcast(true);
      console.log(`[UDP] 广播服务器启动，端口 ${this.broadcastPort}`);
    });
  }

  broadcast(port) {
    const message = JSON.stringify({
      type: 'announce',
      port: port,
      timestamp: Date.now()
    });
    
    const buffer = Buffer.from(message);
    this.server.send(buffer, 0, buffer.length, this.broadcastPort, '255.255.255.255', (err) => {
      if (err) console.log('[UDP] 广播失败:', err);
      else console.log('[UDP] 发送广播公告');
    });
  }

  getInstances() {
    return Array.from(this.clients.values());
  }

  stop() {
    if (this.server) this.server.close();
  }
}

// ============================================
// 方法3: 基于共享存储的状态检测 (模拟Redis/数据库)
// ============================================
class SharedStateChecker {
  constructor() {
    // 模拟共享存储 (实际使用Redis/Memcached/MySQL)
    this.sharedStore = new Map();
    this.instanceId = `instance-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 模拟实例注册
  register(port, metadata = {}) {
    const status = {
      id: this.instanceId,
      port: port,
      status: 'healthy',
      metadata,
      lastHeartbeat: Date.now(),
      version: '1.0.0'
    };
    
    this.sharedStore.set(this.instanceId, status);
    console.log(`[SharedState] 实例 ${this.instanceId} 注册成功`);
    
    return status;
  }

  // 更新心跳
  heartbeat() {
    const status = this.sharedStore.get(this.instanceId);
    if (status) {
      status.lastHeartbeat = Date.now();
      status.status = 'healthy';
      console.log(`[SharedState] 更新心跳: ${this.instanceId}`);
    }
  }

  // 检查所有实例状态
  checkAllInstances(timeoutMs = 5000) {
    const now = Date.now();
    const instances = [];
    
    for (const [id, status] of this.sharedStore) {
      const isAlive = (now - status.lastHeartbeat) < timeoutMs;
      instances.push({
        id,
        port: status.port,
        status: isAlive ? 'healthy' : 'unhealthy',
        lastHeartbeat: status.lastHeartbeat,
        metadata: status.metadata
      });
    }
    
    return instances;
  }

  // 模拟其他实例的心跳
  simulateOtherInstance(otherId, port) {
    this.sharedStore.set(otherId, {
      id: otherId,
      port: port,
      status: 'healthy',
      lastHeartbeat: Date.now()
    });
  }
}

// ============================================
// 方法4: WebSocket 双向通讯
// ============================================
const WebSocket = require('ws');

class WebSocketHealthCheck {
  constructor(port) {
    this.port = port;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    return new Promise((resolve) => {
      this.wss = new WebSocket.Server({ port: this.port });
      
      this.wss.on('connection', (ws) => {
        console.log('[WebSocket] 新客户端连接');
        this.clients.add(ws);

        ws.on('message', (message) => {
          const data = JSON.parse(message);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() });
          }
        });

        ws.on('close', () => {
          console.log('[WebSocket] 客户端断开');
          this.clients.delete(ws);
        });
      });

      this.wss.on('listening', () => {
        console.log(`[WebSocket] 服务器启动，端口 ${this.port}`);
        resolve();
      });
    });
  }

  broadcastHealthCheck() {
    const message = JSON.stringify({ type: 'health_check', timestamp: Date.now() };
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    console.log('[WebSocket] 广播健康检查');
  }

  stop() {
    this.wss.close();
  }
}

// ============================================
// 主程序 - 演示各种检测方式
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法对比');
  console.log('='.repeat(60));

  // -------------------- 方法1: TCP Socket --------------------
  console.log('\n【方法1】TCP Socket 心跳检测');
  console.log('-'.repeat(40));
  
  const tcpServer = await createTCPServer(9001);
  const tcpClient = new TCPHeartbeat(9001, 'localhost');
  
  await tcpClient.connect();
  tcpClient.startHeartbeat(2000);
  
  tcpClient.on('pong', () => {
    console.log('[TCP] 收到 pong 响应 - 实例存活');
  });

  // -------------------- 方法2: UDP 广播 --------------------
  console.log('\n【方法2】UDP 广播发现');
  console.log('-'.repeat(40));
  
  const udpDiscovery = new UDPDiscovery(9002);
  udpDiscovery.start();
  
  // 模拟其他实例响应广播
  setTimeout(() => {
    udpDiscovery.broadcast(9002);
  }, 500);

  setTimeout(() => {
    const instances = udpDiscovery.getInstances();
    console.log(`[UDP] 发现 ${instances.length} 个实例`);
  }, 1500);

  // -------------------- 方法3: 共享状态存储 --------------------
  console.log('\n【方法3】共享状态存储 (Redis/数据库)');
  console.log('-'.repeat(40));
  
  const stateChecker = new SharedStateChecker();
  stateChecker.register(9001, { name: '主实例', region: 'us-east' });
  stateChecker.simulateOtherInstance('sister-instance-1', 9002);
  stateChecker.simulateOtherInstance('sister-instance-2', 9003);
  
  setTimeout(() => {
    const instances = stateChecker.checkAllInstances(5000);
    console.log('[SharedState] 当前存活的实例:');
    instances.forEach(inst => {
      console.log(`  - ${inst.id}: ${inst.status} (port: ${inst.port})`);
    });
  }, 1000);

  // -------------------- 方法4: WebSocket --------------------
  console.log('\n【方法4】WebSocket 双向通讯');
  console.log('-'.repeat(40));
  
  const wsServer = new WebSocketHealthCheck(9003);
  await wsServer.start();
  
  // 模拟WebSocket客户端连接
  const wsClient = new WebSocket('ws://localhost:9003');
  wsClient.on('open', () => {
    console.log('[WebSocket Client] 已连接');
    wsClient.send(JSON.stringify({ type: 'ping' });
  });
  wsClient.on('message', (data) => {
    console.log('[WebSocket Client] 收到:', JSON.parse(data));
  });

  // -------------------- 研究总结 --------------------
  console.log('\n' + '='.repeat(60));
  console.log('研究总结: 实例间状态检测方式对比');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────┬──────────┬──────────┬──────────┬────────────────┐
│     方式        │  延迟    │  可靠性  │  复杂度  │     适用场景    │
├─────────────────┼──────────┼──────────┼──────────┼────────────────┤
│ HTTP/HTTPS      │ 中等     │ 高       │ 低       │ 通用,跨语言    │
│ TCP Socket      │ 低       │ 高       │ 中       │ 高性能,内网    │
│ WebSocket       │ 低       │ 高       │ 中       │ 实时双向通讯   │
│ UDP 广播        │ 最低     │ 低       │ 中       │ 局域网发现     │
│ Redis Pub/Sub   │ 低       │ 高       │ 中       │ 分布式系统     │
│ gRPC            │ 低       │ 高       │ 中       │ 微服务,高性   │
│ Consul/Etcd    │ 低       │ 很高     │ 高       │ 服务发现       │
│ 消息队列        │ 中等     │ 很高     │ 高       │ 异步任务       │
└─────────────────┴──────────┴──────────┴──────────┴────────────────┘

推荐方案:
1. 简单场景: HTTP 健康检查端点
2. 高性能: TCP Socket + 自定义协议
3. 实时应用: WebSocket 长连接
4. 分布式集群: Redis + Pub/Sub 或 Consul
5. Kubernetes: 使用 Service Mesh (Istio)
  `;
  
  console.log(summary);

  // 清理资源
  setTimeout(() => {
    console.log('\n[清理] 关闭所有连接...');
    tcpClient.stop();
    tcpServer.close();
    udpDiscovery.stop();
    wsServer.stop();
    wsClient.close();
    console.log('演示完成!');
    process.exit(0);
  }, 5000);
}

main().catch(console.error);