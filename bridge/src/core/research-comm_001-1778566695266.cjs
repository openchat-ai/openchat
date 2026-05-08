// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:18:15.266Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 检测方式包括：
 * 1. HTTP/HTTPS Ping - 传统方式
 * 2. TCP端口检测 - 底层socket连接
 * 3. WebSocket双向通信 - 持久连接
 * 4. gRPC健康检查 - 高效二进制协议
 * 5. Redis Pub/Sub - 消息队列方式
 * 6. UDP广播 - 无连接检测
 * 7. 数据库心跳 - 共享存储方式
 * 8. 服务发现(Consul) - 集中式健康检查
 */

const net = require('net');
const http = require('http');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================
// 模拟服务实例类
// ============================================
class ServiceInstance {
  constructor(id, port) {
    this.id = id;
    this.port = port;
    this.status = 'unknown';
    this.lastHeartbeat = null;
    this.metadata = {
      name: 'demo-service',
      version: '1.0.0',
      region: 'us-east-1',
      startTime: Date.now()
    };
  }

  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
    this.status = 'healthy';
  }
}

// 模拟多个服务实例
const instances = [
  new ServiceInstance('instance-1', 3001),
  new ServiceInstance('instance-2', 3002),
  new ServiceInstance('instance-3', 3003)
];

// ============================================
// 方式1: HTTP健康检查服务器
// ============================================
function createHttpHealthServer(instance) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/ping') {
      instance.updateHeartbeat();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        instanceId: instance.id,
        timestamp: Date.now(),
        uptime: Date.now() - instance.metadata.startTime
      }));
    } else if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        instance: instance.id,
        status: instance.status,
        lastHeartbeat: instance.lastHeartbeat,
        metadata: instance.metadata
      }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(instance.port, () => {
    console.log(`[HTTP] 实例 ${instance.id} 监听端口 ${instance.port}`);
  });

  return server;
}

// ============================================
// 方式2: TCP端口检测
// ============================================
function createTcpHealthServer(instance) {
  const server = net.createServer((socket) => {
    // 收到连接即认为服务健康
    instance.updateHeartbeat();
    
    const response = JSON.stringify({
      type: 'tcp-health',
      instanceId: instance.id,
      status: 'healthy',
      timestamp: Date.now()
    });
    
    socket.write(response);
    socket.end();
  });

  server.listen(instance.port + 1000, () => {
    console.log(`[TCP] 实例 ${instance.id} TCP健康检查端口 ${instance.port + 1000}`);
  });

  return server;
}

// HTTP检测客户端
async function checkHttpHealth(port) {
  return new Promise((resolve) => {
    const start = Date.now();
    http.get(`http://localhost:${port}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          method: 'HTTP',
          success: res.statusCode === 200,
          responseTime: Date.now() - start,
          data: JSON.parse(data)
        });
      });
    }).on('error', (err) => {
      resolve({
        method: 'HTTP',
        success: false,
        error: err.message,
        responseTime: Date.now() - start
      });
    });
  });
}

// TCP检测客户端
async function checkTcpHealth(port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    
    socket.setTimeout(3000);
    
    socket.connect(port, 'localhost', () => {
      instance = instances.find(i => i.port + 1000 === port);
      if (instance) instance.updateHeartbeat();
    });
    
    socket.on('data', (data) => {
      const responseTime = Date.now() - start;
      socket.destroy();
      resolve({
        method: 'TCP',
        success: true,
        responseTime,
        data: JSON.parse(data.toString())
      });
    });
    
    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        method: 'TCP',
        success: false,
        error: err.message,
        responseTime: Date.now() - start
      });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        method: 'TCP',
        success: false,
        error: 'timeout',
        responseTime: Date.now() - start
      });
    });
  });
}

// ============================================
// 方式3: WebSocket双向通信
// ============================================
class WebSocketHealthMonitor extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.server = null;
  }

  start(port) {
    this.server = new WebSocketServer({ port };
    
    this.server.on('connection', (ws, req) => {
      const clientId = `client-${Date.now()}`;
      this.clients.set(clientId, ws);
      
      console.log(`[WebSocket] 新客户端连接: ${clientId}`);
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'ping') {
            // 响应pong
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now(),
              serverTime: Date.now()
            }));
          }
        } catch (e) {
          console.error('消息解析错误:', e);
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WebSocket] 客户端断开: ${clientId}`);
      });
    });

    console.log(`[WebSocket] 健康检查服务器启动端口 ${port}`);
  }

  // 向所有客户端广播心跳
  broadcastHeartbeat(instanceId) {
    const message = JSON.stringify({
      type: 'heartbeat',
      instanceId,
      timestamp: Date.now(),
      status: 'healthy'
    });
    
    this.clients.forEach((ws) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
      }
    });
  }

  // 客户端检测
  async checkHealth(port) {
    return new Promise((resolve) => {
      const start = Date.now();
      const ws = new (require('ws'))(`ws://localhost:${port}`);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' });
      });
      
      ws.on('message', (data) => {
        const response = JSON.parse(data);
        if (response.type === 'pong') {
          ws.close();
          resolve({
            method: 'WebSocket',
            success: true,
            responseTime: Date.now() - start,
            data: response
          });
        }
      });
      
      ws.on('error', (err) => {
        resolve({
          method: 'WebSocket',
          success: false,
          error: err.message,
          responseTime: Date.now() - start
        });
      });
      
      setTimeout(() => {
        ws.close();
        if (!resolve.called) {
          resolve({
            method: 'WebSocket',
            success: false,
            error: 'timeout',
            responseTime: Date.now() - start
          });
        }
      }, 3000);
    });
  }
}

// ============================================
// 方式4: UDP广播检测
// ============================================
class UdpHealthChecker {
  constructor() {
    this.server = null;
    this.clients = new Map();
  }

  start(port) {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        
        if (data.type === 'probe') {
          // 响应探测请求
          const response = JSON.stringify({
            type: 'probe-response',
            instanceId: 'instance-1',
            status: 'healthy',
            timestamp: Date.now()
          });
          
          this.server.send(response, rinfo.port, rinfo.address);
        } else if (data.type === 'heartbeat') {
          // 接收心跳
          this.clients.set(rinfo.address, {
            lastSeen: Date.now(),
            data
          });
        }
      } catch (e) {
        console.error('UDP消息解析错误:', e);
      }
    });

    this.server.bind(port, () => {
      console.log(`[UDP] 健康检查服务器启动端口 ${port}`);
      this.server.setBroadcast(true);
    });
  }

  // 发送UDP广播探测
  async probe(broadcastAddress, port) {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const start = Date.now();
      
      const message = JSON.stringify({
        type: 'probe',
        clientId: 'monitor',
        timestamp: Date.now()
      });

      client.bind(() => {
        client.setBroadcast(true);
        client.send(message, port, broadcastAddress, (err) => {
          if (err) {
            client.close();
            resolve({
              method: 'UDP',
              success: false,
              error: err.message,
              responseTime: Date.now() - start
            });
          }
        });
      });

      client.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'probe-response') {
            client.close();
            resolve({
              method: 'UDP',
              success: true,
              responseTime: Date.now() - start,
              from: rinfo.address,
              data
            });
          }
        } catch (e) {
          // ignore
        }
      });

      client.on('error', (err) => {
        client.close();
        resolve({
          method: 'UDP',
          success: false,
          error: err.message,
          responseTime: Date.now() - start
        });
      });

      setTimeout(() => {
        client.close();
        resolve({
          method: 'UDP',
          success: false,
          error: 'timeout',
          responseTime: Date.now() - start
        });
      }, 3000);
    });
  }
}

// ============================================
// 方式5: 共享存储/文件心跳
// ============================================
class FileBasedHeartbeat {
  constructor(heartbeatDir) {
    this.heartbeatDir = heartbeatDir;
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.heartbeatDir)) {
      fs.mkdirSync(this.heartbeatDir, { recursive: true });
    }
  }

  // 写入心跳文件
  writeHeartbeat(instanceId) {
    const filePath = path.join(this.heartbeatDir, `${instanceId}.json`);
    const data = {
      instanceId,
      timestamp: Date.now(),
      status: 'healthy',
      hostname: os.hostname(),
      pid: process.pid
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data;
  }

  // 读取所有实例心跳
  readAllHeartbeats() {
    const heartbeats = {};
    const files = fs.readdirSync(this.heartbeatDir);
    
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.heartbeatDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        heartbeats[file.replace('.json', '')] = JSON.parse(content);
      }
    });
    
    return heartbeats;
  }

  // 检查实例是否健康（心跳超时检测）
  checkInstanceHealth(instanceId, timeoutMs = 10000) {
    const filePath = path.join(this.heartbeatDir, `${instanceId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return { healthy: false, reason: 'no heartbeat file' };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const age = Date.now() - data.timestamp;
    
    return {
      healthy: age < timeoutMs,
      age,
      data
    };
  }
}

// ============================================
// 方式6: 服务发现模拟 (类似Consul/Etcd)
// ============================================
class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.watchers = [];
  }

  // 注册服务
  register(instanceId, port, metadata = {}) {
    const service = {
      instanceId,
      port,
      metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      healthStatus: 'healthy'
    };
    
    this.services.set(instanceId, service);
    this.notifyWatchers('register', service);
    
    console.log(`[ServiceRegistry] 注册服务: ${instanceId}`);
    return service;
  }

  // 心跳
  heartbeat(instanceId) {
    const service = this.services.get(instanceId);
    if (service) {
      service.lastHeartbeat = Date.now();
      service.healthStatus = 'healthy';
      this.notifyWatchers('heartbeat', service);
    }
    return service;
  }

  // 注销服务
  deregister(instanceId) {
    const service = this.services.get(instanceId);
    if (service) {
      this.services.delete(instanceId);
      this.notifyWatchers('deregister', service);
    }
  }

  // 获取所有健康服务
  getHealthyServices() {
    const now = Date.now();
    const healthy = [];
    
    this.services.forEach((service, id) => {
      if (now - service.lastHeartbeat < 30000) { // 30秒超时
        healthy.push(service);
      }
    });
    
    return healthy;
  }

  // 监听变化
  watch(callback) {
    this.watchers.push(callback);
  }

  notifyWatchers(event, service) {
    this.watchers.forEach(cb => cb(event, service));
  }
}

// ============================================
// 主程序 - 演示各种检测方式
// ============================================
async function main() {
  console.log('\n========== 实例间通讯方式研究 ==========\n');
  
  // 启动HTTP服务器
  const httpServers = instances.map(inst => createHttpHealthServer(inst));
  
  // 启动TCP服务器
  const tcpServers = instances.map(inst => createTcpHealthServer(inst));
  
  // 启动WebSocket服务器
  const wsMonitor = new WebSocketHealthMonitor();
  wsMonitor.start(3000);
  
  // 启动UDP服务器
  const udpChecker = new UdpHealthChecker();
  udpChecker.start(3001);
  
  // 初始化文件心跳
  const fileHeartbeat = new FileBasedHeartbeat('./heartbeat-files');
  fileHeartbeat.writeHeartbeat('instance-1');
  
  // 初始化服务注册
  const registry = new ServiceRegistry();
  instances.forEach(inst => {
    registry.register(inst.id, inst.port, inst.metadata);
  });

  // 监听服务变化
  registry.watch((event, service) => {
    console.log(`[Registry Event] ${event}: ${service.instanceId}`);
  });

  // 等待服务器启动
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n---------- 开始测试各种检测方式 ----------\n');

  // 测试1: HTTP健康检查
  console.log('【方式1: HTTP健康检查】');
  const httpResult = await checkHttpHealth(3001);
  console.log(`  结果: ${JSON.stringify(httpResult, null, 2)}\n`);

  // 测试2: TCP端口检测
  console.log('【方式2: TCP端口检测】');
  const tcpResult = await checkTcpHealth(3001 + 1000);
  console.log(`  结果: ${JSON.stringify(tcpResult, null, 2)}\n`);

  // 测试3: WebSocket检测
  console.log('【方式3: WebSocket双向通信】');
  const wsResult = await wsMonitor.checkHealth(3000);
  console.log(`  结果: ${JSON.stringify(wsResult, null, 2)}\n`);

  // 测试4: UDP广播检测
  console.log('【方式4: UDP广播检测】');
  const networkInterfaces = os.networkInterfaces();
  let broadcastAddr = '255.255.255.255';
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // 简单计算广播地址
        broadcastAddr = iface.address.split('.').map((octet, i) => {
          return i < 3 ? 255 : octet;
        }).join('.');
      }
    }
  }
  const udpResult = await udpChecker.probe(broadcastAddr, 3001);
  console.log(`  结果: ${JSON.stringify(udpResult, null, 2)}\n`);

  // 测试5: 文件心跳
  console.log('【方式5: 共享存储/文件心跳】');
  const allHeartbeats = fileHeartbeat.readAllHeartbeats();
  const healthCheck = fileHeartbeat.checkInstanceHealth('instance-1', 10000);
  console.log(`  所有心跳: ${JSON.stringify(allHeartbeats, null, 2)}`);
  console.log(`  健康检查: ${JSON.stringify(healthCheck, null, 2)}\n`);

  // 测试6: 服务注册中心
  console.log('【方式6: 服务注册中心(Consul/Etcd)】');
  registry.heartbeat('instance-1');
  const healthyServices = registry.getHealthyServices();
  console.log(`  健康服务列表: ${JSON.stringify(healthyServices.map(s => s.instanceId), null, 2)}\n`);

  // 模拟心跳更新
  setInterval(() => {
    fileHeartbeat.writeHeartbeat('instance-1');
    registry.heartbeat('instance-1');
    wsMonitor.broadcastHeartbeat('instance-1');
  }, 2000);

  // 研究总结
  console.log('\n========== 研究总结 ==========\n');
  console.log('实例间状态检测方式对比:');
  console.log(`
┌──────────────┬────────┬──────────┬────────────┬─────────────┐
│    方式      │  延迟  │  可靠性  │   复杂度   │    适用场景  │
├──────────────┼────────┼──────────┼────────────┼─────────────┤
│ HTTP Ping    │ 中等   │ 高       │ 低         │ 通用场景     │
│ TCP端口      │ 低     │ 高       │ 低         │ 快速检测     │
│ WebSocket    │ 低     │ 很高     │ 中         │ 实时双向通信 │
│ UDP广播      │ 很低   │ 中       │ 中         │ 大规模发现   │
│ 文件心跳     │ 中等   │ 中       │ 低         │ 共享存储环境 │
│ 服务注册中心 │ 中等   │ 高       │ 高         │ 微服务架构   │
│ Redis Pub/Sub│ 低     │ 高       │ 中         │ 分布式系统  │
│ gRPC         │ 很低   │ 高       │ 中         │ 高性能场景  │
└──────────────┴────────┴──────────┴────────────┴─────────────┘
  `);

  console.log('\n关键发现:');
  console.log('1. HTTP是最通用的方案，但开销相对较大');
  console.log('2. TCP更轻量，适合对性能要求高的场景');
  console.log('3. WebSocket适合需要双向实时通信的场景');
  console.log('4. UDP适合大规模服务发现，但需要处理丢包');
  console.log('5. 服务注册中心(如Consul/Etcd)提供集中式健康检查');
  console.log('6. 实际生产环境通常组合使用多种方式\n');

  // 保持运行以便观察
  console.log('(服务器继续运行，按Ctrl+C停止)\n');
}

main().catch(console.error);