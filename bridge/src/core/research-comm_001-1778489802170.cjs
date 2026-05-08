// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:56:42.170Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 作者：居民小明（代码专家）
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');
const os = require('os');

// ============================================
// 1. TCP 端口检测
// ============================================
class TCPScanner {
  static async check(port, host = '127.0.0.1', timeout = 3000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let status = 'DOWN';

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        status = 'UP';
        socket.destroy();
      });

      socket.on('timeout', () => {
        status = 'TIMEOUT';
        socket.destroy();
      });

      socket.on('error', () => {
        status = 'DOWN';
      });

      socket.on('close', () => {
        resolve({ method: 'TCP', host, port, status, timestamp: Date.now() });
      });

      socket.connect(port, host);
    });
  }
}

// ============================================
// 2. HTTP 健康检查
// ============================================
class HTTPScanner {
  static async check(url, timeout = 3000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let status = 'DOWN';

      const req = http.get(url, (res) => {
        status = res.statusCode === 200 ? 'UP' : 'ERROR';
        resolve({
          method: 'HTTP',
          url,
          status,
          statusCode: res.statusCode,
          latency: Date.now() - startTime,
          timestamp: Date.now()
        });
      });

      req.on('error', () => {
        resolve({
          method: 'HTTP',
          url,
          status: 'DOWN',
          latency: Date.now() - startTime,
          timestamp: Date.now()
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          method: 'HTTP',
          url,
          status: 'TIMEOUT',
          latency: Date.now() - startTime,
          timestamp: Date.now()
        });
      });

      req.setTimeout(timeout);
    });
  }
}

// ============================================
// 3. UDP 广播检测
// ============================================
class UDPScanner {
  static async broadcast(port, message, timeout = 3000) {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const responses = [];
      const startTime = Date.now();

      client.bind(() => {
        client.setBroadcast(true);
        client.send(message, port, '255.255.255.255', (err) => {
          if (err) {
            client.close();
            resolve({ method: 'UDP', port, responses: [], error: err.message });
          }
        });
      });

      client.on('message', (msg, rinfo) => {
        responses.push({ address: rinfo.address, port: rinfo.port, data: msg.toString() };
      });

      setTimeout(() => {
        client.close();
        resolve({
          method: 'UDP',
          port,
          responses,
          latency: Date.now() - startTime,
          timestamp: Date.now()
        });
      }, timeout);
    });
  }
}

// ============================================
// 4. 共享状态存储（模拟 Redis/Consul）
// ============================================
class SharedStateRegistry extends EventEmitter {
  constructor() {
    super();
    this.state = new Map();
    this.heartbeatInterval = null;
  }

  // 模拟服务注册
  register(serviceId, metadata = {}) {
    const key = `service:${serviceId}`;
    this.state.set(key, {
      ...metadata,
      lastHeartbeat: Date.now(),
      status: 'ALIVE'
    });
    console.log(`[共享存储] 服务 ${serviceId} 已注册`);
    return this.state.get(key);
  }

  // 模拟心跳
  heartbeat(serviceId) {
    const key = `service:${serviceId}`;
    if (this.state.has(key)) {
      const state = this.state.get(key);
      state.lastHeartbeat = Date.now();
      state.status = 'ALIVE';
      console.log(`[共享存储] 服务 ${serviceId} 发送心跳`);
      return true;
    }
    return false;
  }

  // 检查服务状态
  checkStatus(serviceId, ttl = 5000) {
    const key = `service:${serviceId}`;
    if (!this.state.has(key)) {
      return { status: 'UNKNOWN', serviceId };
    }

    const state = this.state.get(key);
    const isAlive = (Date.now() - state.lastHeartbeat) < ttl;

    return {
      serviceId,
      status: isAlive ? 'ALIVE' : 'DEAD',
      lastHeartbeat: state.lastHeartbeat,
      ttl,
      method: 'SharedState(Redis/Consul/etcd)'
    };
  }

  // 获取所有存活服务
  getAliveServices(ttl = 5000) {
    const alive = [];
    for (const [key, state] of this.state) {
      if ((Date.now() - state.lastHeartbeat) < ttl) {
        alive.push({ serviceId: key.replace('service:', ''), ...state };
      }
    }
    return alive;
  }
}

// ============================================
// 5. WebSocket 心跳检测
// ============================================
class WebSocketHeartbeat {
  constructor(serverPort) {
    this.port = serverPort;
    this.clients = new Map();
    this.server = null;
  }

  start() {
    this.server = http.createServer();
    const { Server } = require('ws');
    const wss = new Server({ server: this.server });

    wss.on('connection', (ws, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      this.clients.set(clientId, { ws, lastPing: Date.now() });
      console.log(`[WebSocket] 客户端 ${clientId} 连接`);

      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'pong') {
          const client = this.clients.get(clientId);
          if (client) client.lastPing = Date.now();
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WebSocket] 客户端 ${clientId} 断开`);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[WebSocket] 心跳服务器启动在端口 ${this.port}`);
    });
  }

  // 发送 ping 检查客户端
  pingClients() {
    const results = [];
    const now = Date.now();

    for (const [clientId, client] of this.clients) {
      client.ws.send(JSON.stringify({ type: 'ping' });
      const isAlive = (now - client.lastPing) < 10000;
      results.push({ clientId, status: isAlive ? 'ALIVE' : 'UNRESPONSIVE', lastPing: client.lastPing });
    }

    return results;
  }

  stop() {
    if (this.server) this.server.close();
  }
}

// ============================================
// 6. 服务发现系统（模拟 Consul/etcd）
// ============================================
class ServiceDiscovery {
  constructor() {
    this.nodes = new Map();
  }

  // 模拟节点注册
  registerNode(nodeId, endpoint, metadata = {}) {
    this.nodes.set(nodeId, {
      endpoint,
      metadata,
      registeredAt: Date.now(),
      healthCheckPassing: true
    });
    console.log(`[服务发现] 节点 ${nodeId} 注册到 ${endpoint}`);
  }

  // 模拟健康检查更新
  updateHealth(nodeId, passing) {
    if (this.nodes.has(nodeId)) {
      this.nodes.get(nodeId).healthCheckPassing = passing;
      console.log(`[服务发现] 节点 ${nodeId} 健康状态: ${passing ? 'PASSING' : 'FAILING'}`);
    }
  }

  // 获取健康节点
  getHealthyNodes() {
    const healthy = [];
    for (const [nodeId, node] of this.nodes) {
      if (node.healthCheckPassing) {
        healthy.push({ nodeId, ...node });
      }
    }
    return healthy;
  }

  // 模拟 DNS SRV 记录查询
  getSrvRecords() {
    return this.getHealthyNodes().map(node => ({
      target: node.endpoint,
      port: parseInt(node.endpoint.split(':').pop()),
      priority: 1,
      weight: 100
    }));
  }
}

// ============================================
// 主程序：综合演示
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法');
  console.log('='.repeat(60));

  // 创建模拟服务
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() });
  });

  await new Promise(resolve => server.listen(3000, resolve));
  console.log('\n[模拟服务] HTTP 服务启动在端口 3000\n');

  // ============================================
  // 测试 1: TCP 端口检测
  // ============================================
  console.log('--- 测试 1: TCP 端口检测 ---');
  const tcpResult = await TCPScanner.check(3000, '127.0.0.1');
  console.log('结果:', tcpResult);
  console.log('原理: 尝试建立 TCP 连接，成功即表示服务存活\n');

  // ============================================
  // 测试 2: HTTP 健康检查
  // ============================================
  console.log('--- 测试 2: HTTP 健康检查 ---');
  const httpResult = await HTTPScanner.check('http://127.0.0.1:3000/');
  console.log('结果:', httpResult);
  console.log('原理: 发送 HTTP 请求，检查响应状态码\n');

  // ============================================
  // 测试 3: 共享状态存储
  // ============================================
  console.log('--- 测试 3: 共享状态存储 (Redis/Consul/etcd) ---');
  const registry = new SharedStateRegistry();
  
  registry.register('service-A', { ip: '192.168.1.10', port: 8080 });
  registry.register('service-B', { ip: '192.168.1.11', port: 8081 });
  
  console.log('  模拟 service-A 发送心跳...');
  registry.heartbeat('service-A');
  
  // 模拟 service-B 崩溃（不发送心跳）
  setTimeout(() => {
    const statusA = registry.checkStatus('service-A');
    const statusB = registry.checkStatus('service-B');
    console.log('  service-A 状态:', statusA);
    console.log('  service-B 状态:', statusB);
    console.log('  原理: 通过共享存储（如 Redis）记录心跳，超时则认为死亡\n');
  }, 100);

  // ============================================
  // 测试 4: WebSocket 心跳
  // ============================================
  console.log('--- 测试 4: WebSocket 心跳 ---');
  const wsHeartbeat = new WebSocketHeartbeat(3001);
  wsHeartbeat.start();

  // 模拟客户端连接（这里简单模拟）
  await new Promise(r => setTimeout(r, 500));
  console.log('  模拟客户端连接...');
  console.log('  发送 ping 检测...');
  const wsResults = wsHeartbeat.pingClients();
  console.log('  结果:', wsResults);
  console.log('  原理: 保持长连接，通过定期 ping/pong 维持状态\n');
  wsHeartbeat.stop();

  // ============================================
  // 测试 5: 服务发现系统
  // ============================================
  console.log('--- 测试 5: 服务发现系统 (Consul/etcd/Zookeeper) ---');
  const sd = new ServiceDiscovery();
  
  sd.registerNode('node-1', '192.168.1.10:8080', { version: '1.0.0' });
  sd.registerNode('node-2', '192.168.1.11:8080', { version: '1.0.0' });
  sd.registerNode('node-3', '192.168.1.12:8080', { version: '1.0.0' });
  
  // 模拟 node-2 故障
  sd.updateHealth('node-2', false);
  
  const healthyNodes = sd.getHealthyNodes();
  const srvRecords = sd.getSrvRecords();
  
  console.log('  健康节点:', healthyNodes.length);
  console.log('  SRV 记录:', srvRecords);
  console.log('  原理: 服务注册中心维护健康检查状态，客户端查询可用节点\n');

  // ============================================
  // 研究结果总结
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('研究结果总结');
  console.log('='.repeat(60));

  const methods = [
    { name: 'HTTP/HTTPS Ping', pros: '简单通用,支持认证', cons: '需要 HTTP 栈,有延迟', 适用: 'Web 服务' },
    { name: 'TCP 端口检测', pros: '轻量快速,无需 HTTP', cons: '只能检测端口,不能检测应用状态', 适用: '任何 TCP 服务' },
    { name: 'WebSocket 心跳', pros: '实时性强,双向通信', cons: '需要保持连接,资源消耗大', 适用: '需要实时推送的服务' },
    { name: '共享存储 (Redis/Consul)', pros: '去中心化,支持分布式', cons: '需要额外组件', 适用: '微服务架构' },
    { name: 'UDP 广播', pros: '无需建立连接,速度快', cons: '不可靠,可能被防火墙阻止', 适用: '局域网服务发现' },
    { name: 'gRPC 健康检查', pros: '高性能,支持多语言', cons: '需要 gRPC', 适用: 'gRPC 服务' },
    { name: '服务发现 (Consul/etcd)', pros: '完整解决方案,支持 DNS', cons: '架构复杂', 适用: '生产环境微服务' },
    { name: '数据库状态', pros: '简单直接', cons: '增加数据库压力', 适用: '简单应用' }
  ];

  console.log('\n| 方法 | 优点 | 缺点 | 适用场景 |');
  console.log('|------|------|------|----------|');
  for (const m of methods) {
    console.log(`| ${m.name} | ${m.pros} | ${m.cons} | ${m.适用} |`);
  }

  console.log('\n推荐组合策略:');
  console.log('1. 小型应用: HTTP + TCP 端口检测');
  console.log('2. 中型应用: HTTP + 共享存储 (Redis)');
  console.log('3. 大型微服务: 服务发现 (Consul/etcd) + 健康检查');

  // 清理
  server.close();
  console.log('\n[完成] 所有测试完成，服务已关闭');
}

// 运行主程序
main().catch(console.error);