// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:24:15.941Z

/**
 * 实例间通讯方式研究
 * 探索除了HTTP ping之外的其他状态检测方式
 */

const net = require('net');
const http = require('http');
const EventEmitter = require('events');
const { Server: WebSocketServer } = require('ws');

// 模拟服务实例类
class ServiceInstance extends EventEmitter {
  constructor(id, port) {
    super();
    this.id = id;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = null;
  }

  start() {
    this.status = 'online';
    this.lastHeartbeat = Date.now();
    console.log(`[${this.id}] 实例启动，端口: ${this.port}`);
  }

  stop() {
    this.status = 'offline';
    console.log(`[${this.id}] 实例停止`);
  }

  heartbeat() {
    this.lastHeartbeat = Date.now();
    this.status = 'online';
  }
}

// ==================== 方式1: TCP端口检测 ====================
class TCPPing {
  constructor(port) {
    this.port = port;
  }

  async check(ip = '127.0.0.1') {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve({ method: 'TCP', status: 'online', responseTime: 0 });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ method: 'TCP', status: 'timeout', responseTime: timeout });
      });

      socket.on('error', (err) => {
        resolve({ method: 'TCP', status: 'offline', error: err.message });
      });

      socket.connect(this.port, ip);
    });
  }
}

// ==================== 方式2: HTTP健康检查 ====================
class HTTPPing {
  constructor(port, path = '/health') {
    this.port = port;
    this.path = path;
  }

  async check(ip = '127.0.0.1') {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const req = http.request({
        hostname: ip,
        port: this.port,
        path: this.path,
        method: 'GET',
        timeout: 3000
      }, (res) => {
        const responseTime = Date.now() - startTime;
        resolve({
          method: 'HTTP',
          status: res.statusCode === 200 ? 'online' : 'error',
          statusCode: res.statusCode,
          responseTime
        });
      });

      req.on('error', (err) => {
        resolve({ method: 'HTTP', status: 'offline', error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ method: 'HTTP', status: 'timeout', responseTime: 3000 });
      });

      req.end();
    });
  }
}

// ==================== 方式3: WebSocket长连接心跳 ====================
class WebSocketHeartbeat extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.clients = new Set();
    this.server = null;
  }

  start() {
    this.server = new WebSocketServer({ port: this.port };

    this.server.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[WebSocket] 新客户端连接，当前连接数: ${this.clients.size}`);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] 客户端断开，剩余连接数: ${this.clients.size}`);
      });
    });

    console.log(`[WebSocket] 心跳服务器启动在端口 ${this.port}`);
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() };
    this.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    });
  }

  stop() {
    this.clients.forEach(client => client.close());
    this.server?.close();
  }
}

// ==================== 方式4: 共享存储检测 (模拟Redis/数据库) ====================
class SharedStoreHealthCheck {
  constructor() {
    // 模拟一个内存中的共享存储（实际可替换为Redis/MySQL）
    this.store = new Map();
    this.TTL = 5000; // 5秒过期
  }

  // 实例注册/更新状态
  register(instanceId, data = {}) {
    const key = `instance:${instanceId}`;
    this.store.set(key, {
      data,
      timestamp: Date.now()
    });
    console.log(`[SharedStore] 实例 ${instanceId} 注册/更新状态`);
  }

  // 获取实例状态
  getStatus(instanceId) {
    const key = `instance:${instanceId}`;
    const record = this.store.get(key);
    
    if (!record) {
      return { status: 'not_found' };
    }

    const age = Date.now() - record.timestamp;
    const isAlive = age < this.TTL;

    return {
      status: isAlive ? 'online' : 'stale',
      age,
      data: record.data
    };
  }

  // 获取所有实例状态
  getAllStatuses() {
    const result = {};
    for (const [key, value] of this.store) {
      const instanceId = key.replace('instance:', '');
      result[instanceId] = this.getStatus(instanceId);
    }
    return result;
  }

  // 清理过期记录
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.store) {
      if (now - value.timestamp > this.TTL) {
        this.store.delete(key);
        console.log(`[SharedStore] 清理过期实例: ${key}`);
      }
    }
  }
}

// ==================== 方式5: 进程间信号检测 ====================
class IPCSignalCheck {
  constructor() {
    this.processes = new Map();
  }

  // 发送信号给另一个进程
  sendSignal(pid, signal = 'SIGUSR1') {
    return new Promise((resolve) => {
      try {
        process.kill(pid, signal);
        resolve({ method: 'IPC', status: 'signal_sent', signal });
      } catch (err) {
        resolve({ method: 'IPC', status: 'error', error: err.message });
      }
    });
  }

  // 监听信号
  listen(signal = 'SIGUSR1') {
    process.on(signal, () => {
      console.log(`[IPC] 收到信号: ${signal}, 时间: ${Date.now()}`);
    });
  }
}

// ==================== 主程序：综合演示 ====================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 多方案演示');
  console.log('='.repeat(60));

  // 创建模拟实例
  const instance1 = new ServiceInstance('service-A', 3001);
  const instance2 = new ServiceInstance('service-B', 3002);
  instance1.start();
  instance2.start();

  // ====== 演示1: TCP端口检测 ======
  console.log('\n--- 方式1: TCP端口检测 ---');
  const tcpPing = new TCPPing(3001);
  const tcpResult = await tcpPing.check();
  console.log('TCP检测结果:', tcpResult);

  // ====== 演示2: HTTP健康检查 ======
  console.log('\n--- 方式2: HTTP健康检查 ---');
  // 创建一个简单的HTTP服务器来测试
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => healthServer.listen(3003, resolve));
  console.log('[HTTP] 测试服务器启动在端口 3003');

  const httpPing = new HTTPPing(3003, '/health');
  const httpResult = await httpPing.check();
  console.log('HTTP检测结果:', httpResult);

  healthServer.close();

  // ====== 演示3: WebSocket心跳 ======
  console.log('\n--- 方式3: WebSocket长连接心跳 ---');
  const wsHeartbeat = new WebSocketHeartbeat(3004);
  wsHeartbeat.start();

  // 模拟客户端连接
  const { WebSocket } = require('ws');
  const wsClient = new WebSocket('ws://127.0.0.1:3004');
  
  wsClient.on('open', () => {
    console.log('[WebSocket] 客户端已连接');
    // 发送ping
    wsClient.send(JSON.stringify({ type: 'ping' });
  });

  wsClient.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('[WebSocket] 收到响应:', msg);
    wsClient.close();
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  wsHeartbeat.stop();

  // ====== 演示4: 共享存储检测 ======
  console.log('\n--- 方式4: 共享存储检测 (Redis/DB模式) ---');
  const sharedStore = new SharedStoreHealthCheck();

  // 注册多个实例
  sharedStore.register('instance-1', { role: 'primary', load: 45 });
  sharedStore.register('instance-2', { role: 'secondary', load: 30 });
  sharedStore.register('instance-3', { role: 'worker', load: 60 });

  // 获取所有状态
  console.log('所有实例状态:', JSON.stringify(sharedStore.getAllStatuses(), null, 2));

  // 模拟实例3崩溃（不更新状态）
  console.log('\n[模拟] instance-3 崩溃，6秒后检测...');
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  // 清理过期
  sharedStore.cleanup();
  
  // 再次获取状态
  console.log('清理后实例状态:', JSON.stringify(sharedStore.getAllStatuses(), null, 2));

  // ====== 演示5: 进程信号 ======
  console.log('\n--- 方式5: 进程间信号检测 ---');
  const ipcCheck = new IPCSignalCheck();
  ipcCheck.listen();
  
  // 发送信号给自己测试
  const signalResult = await ipcCheck.sendSignal(process.pid, 'SIGUSR1');
  console.log('信号检测结果:', signalResult);

  // ====== 研究总结 ======
  console.log('\n' + '='.repeat(60));
  console.log('研究总结: 实例间状态检测方式对比');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────┬──────────┬─────────┬────────────┬─────────────┐
│ 检测方式        │ 实时性   │ 资源消耗 │ 可靠性     │ 适用场景    │
├─────────────────┼──────────┼─────────┼────────────┼─────────────┤
│ HTTP Ping       │ 中       │ 中      │ 高         │ Web服务     │
│ TCP Port        │ 中       │ 低      │ 中         │ 快速检测    │
│ WebSocket       │ 高       │ 中      │ 高         │ 实时监控    │
│ Redis/共享存储  │ 中       │ 低      │ 高         │ 分布式集群  │
│ gRPC            │ 高       │ 低      │ 高         │ 微服务      │
│ ZooKeeper       │ 高       │ 中      │ 极高       │ 分布式协调  │
│ MQTT            │ 高       │ 中      │ 高         │ IoT/移动端  │
│ 数据库轮询      │ 低       │ 中      │ 中         │ 简单场景    │
│ 进程信号        │ 高       │ 极低    │ 中         │ 本地进程    │
└─────────────────┴──────────┴─────────┴────────────┴─────────────┘

推荐方案:
1. 小规模服务: HTTP + TCP 组合
2. 中等规模: WebSocket 心跳 + Redis 状态存储
3. 大规模分布式: gRPC + Consul/Etcd
4. 实时性要求高: WebSocket 长连接
  `;

  console.log(summary);

  console.log('\n[研究完成] 代码执行完毕');
}

main().catch(console.error);