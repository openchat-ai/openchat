// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:32:54.933Z

// 实例间通讯方式研究 - 状态检测方法
// ============================================

const net = require('net');
const http = require('http');
const dgram = require('dgram');
const EventEmitter = require('events');
const { exec } = require('child_process');

// 模拟服务实例类
class ServiceInstance {
  constructor(id, port, protocol = 'http') {
    this.id = id;
    this.port = port;
    this.protocol = protocol;
    this.status = 'unknown';
    this.lastCheck = null;
  }
}

// ============================================
// 方法1: HTTP 健康检查 (作为基准对比)
// ============================================
function httpHealthCheck(port, path = '/health', timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      resolve({
        method: 'HTTP',
        status: res.statusCode === 200 ? 'healthy' : 'unhealthy',
        latency: Date.now() - startTime,
        statusCode: res.statusCode
      });
      req.destroy();
    });

    req.on('error', (err) => {
      resolve({
        method: 'HTTP',
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: err.message
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      resolve({
        method: 'HTTP',
        status: 'timeout',
        latency: timeout
      });
    });
  });
}

// ============================================
// 方法2: TCP 端口检测
// ============================================
function tcpPing(port, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let status = 'unhealthy';

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      status = 'healthy';
      socket.destroy();
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        method: 'TCP',
        port,
        status: 'timeout',
        latency: timeout
      });
    });

    socket.on('error', (err) => {
      resolve({
        method: 'TCP',
        port,
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: err.message
      });
    });

    socket.on('close', () => {
      if (status === 'healthy') {
        resolve({
          method: 'TCP',
          port,
          status: 'healthy',
          latency: Date.now() - startTime
        });
      }
    });

    socket.connect(port, 'localhost');
  });
}

// ============================================
// 方法3: 自定义协议消息交换
// ============================================
function customProtocolCheck(port, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let responseReceived = false;

    socket.setTimeout(timeout);

    // 发送自定义健康检查消息
    const checkMessage = JSON.stringify({
      type: 'HEALTH_CHECK',
      timestamp: Date.now(),
      sender: 'monitor'
    });

    socket.on('connect', () => {
      // 发送检查请求
      socket.write(checkMessage + '\n');
    });

    socket.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.type === 'HEALTH_RESPONSE') {
          responseReceived = true;
          socket.destroy();
          resolve({
            method: 'Custom Protocol',
            port,
            status: response.status || 'healthy',
            latency: Date.now() - startTime,
            response
          });
        }
      } catch (e) {
        // 非JSON响应
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        method: 'Custom Protocol',
        port,
        status: 'timeout',
        latency: timeout
      });
    });

    socket.on('error', (err) => {
      resolve({
        method: 'Custom Protocol',
        port,
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: err.message
      });
    });

    socket.connect(port, 'localhost');
  });
}

// ============================================
// 方法4: UDP 广播检测
// ============================================
function udpBroadcastCheck(broadcastPort, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = dgram.createSocket('udp4');
    let responded = false;

    const checkMessage = Buffer.from(JSON.stringify({
      type: 'HEALTH_QUERY',
      timestamp: Date.now()
    }));

    client.bind(() => {
      client.setBroadcast(true);
      client.send(checkMessage, 0, checkMessage.length, broadcastPort, '255.255.255.255');
    });

    client.on('message', (msg, rinfo) => {
      try {
        const response = JSON.parse(msg.toString());
        if (response.type === 'HEALTH_RESPONSE') {
          responded = true;
          client.close();
          resolve({
            method: 'UDP Broadcast',
            port: broadcastPort,
            status: 'healthy',
            latency: Date.now() - startTime,
            responder: `${rinfo.address}:${rinfo.port}`,
            response
          });
        }
      } catch (e) {
        client.close();
        resolve({
          method: 'UDP Broadcast',
          port: broadcastPort,
          status: 'unhealthy',
          latency: Date.now() - startTime,
          error: 'Invalid response'
        });
      }
    });

    setTimeout(() => {
      if (!responded) {
        client.close();
        resolve({
          method: 'UDP Broadcast',
          port: broadcastPort,
          status: 'no_response',
          latency: timeout
        });
      }
    }, timeout);
  });
}

// ============================================
// 方法5: 基于共享存储的状态检测
// ============================================
class SharedStorageChecker {
  constructor() {
    // 模拟共享存储（实际可用 Redis, etcd, ZooKeeper 等）
    this.storage = new Map();
  }

  // 模拟实例注册
  registerInstance(instanceId, metadata = {}) {
    const key = `instance:${instanceId}`;
    this.storage.set(key, {
      ...metadata,
      lastHeartbeat: Date.now(),
      status: 'active'
    });
  }

  // 模拟实例心跳
  heartbeat(instanceId) {
    const key = `instance:${instanceId}`;
    const data = this.storage.get(key);
    if (data) {
      data.lastHeartbeat = Date.now();
      data.status = 'active';
      this.storage.set(key, data);
      return true;
    }
    return false;
  }

  // 检查实例状态
  checkInstanceHealth(instanceId, timeoutMs = 5000) {
    const key = `instance:${instanceId}`;
    const data = this.storage.get(key);
    
    if (!data) {
      return {
        method: 'Shared Storage',
        instanceId,
        status: 'not_registered'
      };
    }

    const timeSinceHeartbeat = Date.now() - data.lastHeartbeat;
    const isHealthy = timeSinceHeartbeat < timeoutMs;

    return {
      method: 'Shared Storage',
      instanceId,
      status: isHealthy ? 'healthy' : 'stale',
      lastHeartbeat: data.lastHeartbeat,
      timeSinceHeartbeat,
      metadata: data
    };
  }

  // 获取所有实例状态
  getAllInstances() {
    const instances = [];
    for (const [key, value] of this.storage.entries()) {
      if (key.startsWith('instance:')) {
        const instanceId = key.replace('instance:', '');
        instances.push(this.checkInstanceHealth(instanceId));
      }
    }
    return instances;
  }
}

// ============================================
// 方法6: 基于 DNS 的服务发现检测
// ============================================
function dnsServiceDiscoveryCheck(serviceName, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 使用系统 dns 模块
    const dns = require('dns');
    
    // 模拟 SRV 记录查询 (服务发现)
    // 实际生产中会查询 _service._protocol.domain.com
    dns.resolve4(serviceName, (err, addresses) => {
      if (err) {
        resolve({
          method: 'DNS SD',
          service: serviceName,
          status: 'unhealthy',
          latency: Date.now() - startTime,
          error: err.message
        });
      } else {
        resolve({
          method: 'DNS SD',
          service: serviceName,
          status: addresses && addresses.length > 0 ? 'healthy' : 'no_instances',
          latency: Date.now() - startTime,
          addresses
        });
      }
    });
  });
}

// ============================================
// 方法7: gRPC 健康检查
// ============================================
function grpcHealthCheck(port, timeout = 3000) {
  // 注意: 实际需要 @grpc/grpc-js 包
  // 这里模拟实现
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 模拟 gRPC 健康检查协议
    const socket = new net.Socket();
    
    socket.setTimeout(timeout);
    
    // gRPC 使用 HTTP/2, 这里简化为 TCP 连接测试
    socket.on('connect', () => {
      // 尝试发送 gRPC 健康检查帧 (简化版)
      const healthCheckFrame = Buffer.from([0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01]);
      socket.write(healthCheckFrame);
    });
    
    socket.on('data', (data) => {
      socket.destroy();
      resolve({
        method: 'gRPC',
        port,
        status: 'healthy',
        latency: Date.now() - startTime,
        note: 'Simulated gRPC health check'
      });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        method: 'gRPC',
        port,
        status: 'timeout',
        latency: timeout
      });
    });
    
    socket.on('error', (err) => {
      resolve({
        method: 'gRPC',
        port,
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: err.message
      });
    });
    
    socket.connect(port, 'localhost');
  });
}

// ============================================
// 方法8: WebSocket 健康检测
// ============================================
function websocketHealthCheck(port, timeout = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 使用 net 模拟 WebSocket 握手
    const socket = new net.Socket();
    
    socket.setTimeout(timeout);
    
    const WebSocketKey = 'dGhlIHNhbXBsZSBub25jZQ=='; // 示例 key
    
    socket.on('connect', () => {
      // 发送 WebSocket 握手请求
      const handshake = `GET /ws HTTP/1.1\r
Host: localhost:${port}\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Key: ${WebSocketKey}\r
Sec-WebSocket-Version: 13\r
\r\n`;
      
      socket.write(handshake);
    });
    
    socket.on('data', (data) => {
      const response = data.toString();
      if (response.includes('101 Switching Protocols')) {
        socket.destroy();
        resolve({
          method: 'WebSocket',
          port,
          status: 'healthy',
          latency: Date.now() - startTime
        });
      } else {
        socket.destroy();
        resolve({
          method: 'WebSocket',
          port,
          status: 'unhealthy',
          latency: Date.now() - startTime,
          error: 'Handshake failed'
        });
      }
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        method: 'WebSocket',
        port,
        status: 'timeout',
        latency: timeout
      });
    });
    
    socket.on('error', (err) => {
      resolve({
        method: 'WebSocket',
        port,
        status: 'unhealthy',
        latency: Date.now() - startTime,
        error: err.message
      });
    });
    
    socket.connect(port, 'localhost');
  });
}

// ============================================
// 方法9: 心跳机制 (Heartbeat)
// ============================================
class HeartbeatMonitor extends EventEmitter {
  constructor(intervalMs = 1000) {
    super();
    this.intervalMs = intervalMs;
    this.instances = new Map();
    this.running = false;
  }

  registerInstance(instanceId, port) {
    this.instances.set(instanceId, {
      port,
      lastHeartbeat: null,
      missedHeartbeats: 0,
      status: 'unknown'
    });
  }

  async start() {
    this.running = true;
    console.log('🔔 心跳监控器已启动');
    
    this.timer = setInterval(async () => {
      for (const [instanceId, info] of this.instances.entries()) {
        await this.checkInstance(instanceId, info);
      }
    }, this.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
    }
    console.log('🔔 心跳监控器已停止');
  }

  async checkInstance(instanceId, info) {
    const result = await tcpPing(info.port, 1000);
    const isHealthy = result.status === 'healthy';
    
    if (isHealthy) {
      info.missedHeartbeats = 0;
      info.status = 'healthy';
      info.lastHeartbeat = Date.now();
    } else {
      info.missedHeartbeats++;
      if (info.missedHeartbeats >= 3) {
        info.status = 'unhealthy';
        this.emit('instanceDown', { instanceId, info });
      }
    }
    
    this.instances.set(instanceId, info);
  }

  getInstanceStatus(instanceId) {
    return this.instances.get(instanceId);
  }

  getAllStatus() {
    const status = {};
    for (const [id, info] of this.instances.entries()) {
      status[id] = info;
    }
    return status;
  }
}

// ============================================
// 综合测试与演示
// ============================================
async function runComprehensiveTest() {
  console.log('\n' + '='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法对比');
  console.log('='.repeat(60));

  // 创建模拟服务实例
  const instances = [
    new ServiceInstance('service-a', 3000, 'http'),
    new ServiceInstance('service-b', 3001, 'tcp'),
    new ServiceInstance('service-c', 3002, 'grpc')
  ];

  // 启动测试服务器
  const testServers = await startTestServers();
  
  console.log('\n📡 测试服务器已启动');
  console.log('='.repeat(60));

  // 测试各种检测方法
  console.log('\n🔬 开始测试各种检测方法...\n');

  // 1. HTTP 健康检查
  console.log('【1】HTTP 健康检查');
  const httpResult = await httpHealthCheck(3000);
  console.log('   结果:', JSON.stringify(httpResult));

  // 2. TCP 端口检测
  console.log('\n【2】TCP 端口检测');
  const tcpResult = await tcpPing(3001);
  console.log('   结果:', JSON.stringify(tcpResult));

  // 3. 自定义协议
  console.log('\n【3】自定义协议消息交换');
  const customResult = await customProtocolCheck(3003);
  console.log('   结果:', JSON.stringify(customResult));

  // 4. UDP 广播
  console.log('\n【4】UDP 广播检测');
  const udpResult = await udpBroadcastCheck(3004);
  console.log('   结果:', JSON.stringify(udpResult));

  // 5. 共享存储
  console.log('\n【5】基于共享存储的状态检测');
  const storage = new SharedStorageChecker();
  storage.registerInstance('instance-1', { ip: '10.0.0.1', region: 'us-east' });
  storage.registerInstance('instance-2', { ip: '10.0.0.2', region: 'us-west' });
  
  // 模拟心跳
  setTimeout(() => storage.heartbeat('instance-1'), 100);
  
  await new Promise(r => setTimeout(r, 200));
  
  const storageResults = storage.getAllInstances();
  console.log('   结果:', JSON.stringify(storageResults, null, 2));

  // 6. DNS 服务发现
  console.log('\n【6】DNS 服务发现检测');
  const dnsResult = await dnsServiceDiscoveryCheck('google.com');
  console.log('   结果:', JSON.stringify(dnsResult));

  // 7. gRPC 健康检查
  console.log('\n【7】gRPC 健康检查');
  const grpcResult = await grpcHealthCheck(3005);
  console.log('   结果:', JSON.stringify(grpcResult));

  // 8. WebSocket 检测
  console.log('\n【8】WebSocket 健康检测');
  const wsResult = await websocketHealthCheck(3006);
  console.log('   结果:', JSON.stringify(wsResult));

  // 9. 心跳机制
  console.log('\n【9】心跳机制监控');
  const heartbeatMonitor = new HeartbeatMonitor(2000);
  heartbeatMonitor.registerInstance('service-a', 3000);
  heartbeatMonitor.registerInstance('service-b', 3001);
  
  heartbeatMonitor.on('instanceDown', (data) => {
    console.log(`   ⚠️ 实例 ${data.instanceId} 已离线!`);
  });
  
  await heartbeatMonitor.start();
  await new Promise(r => setTimeout(r, 2500));
  console.log('   状态:', JSON.stringify(heartbeatMonitor.getAllStatus(), null, 2));
  heartbeatMonitor.stop();

  // 关闭测试服务器
  await stopTestServers(testServers);

  // 总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 研究总结: 实例间状态检测方法对比');
  console.log('='.repeat(60));
  
  console.log(`
┌─────────────────┬──────────┬─────────┬──────────────┐
│ 方法            │ 协议     │ 复杂度  │ 适用场景     │
├─────────────────┼──────────┼─────────┼──────────────┤
│ HTTP Ping       │ HTTP     │ 低      │ Web服务      │
│ TCP Port        │ TCP      │ 低      │ 通用服务     │
│ 自定义协议      │ TCP      │ 中      │ 内部系统     │
│ UDP广播         │ UDP      │ 中      │ 局域网发现   │
│ 共享存储        │ 多种    │ 中      │ 分布式系统   │
│ DNS SD          │ DNS      │ 低      │ 服务发现     │
│ gRPC            │ HTTP/2   │ 中      │ 微服务       │
│ WebSocket       │ WS       │ 中      │ 实时通信     │
│ 心跳机制        │ 多种    │ 高      │ 集群监控     │
└─────────────────┴──────────┴─────────┴──────────────┘
  `);

  console.log('✅ 研究完成!\n');
}

// 启动测试服务器
async function startTestServers() {
  const servers = [];

  // HTTP 服务器
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  await new Promise(resolve => httpServer.listen(3000, resolve));
  servers.push(httpServer);

  // TCP Echo 服务器
  const tcpServer = net.createServer((socket) => {
    socket.write(JSON.stringify({ type: 'HEALTH_RESPONSE', status: 'ok' });
    socket.end();
  });
  
  await new Promise(resolve => tcpServer.listen(3001, resolve));
  servers.push(tcpServer);

  // 自定义协议服务器
  const customServer = net.createServer((socket) => {
    socket.on('data', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'HEALTH_CHECK') {
          socket.write(JSON.stringify({
            type: 'HEALTH_RESPONSE',
            status: 'ok',
            timestamp: Date.now()
          }));
        }
      } catch (e) {}
    });
  });
  
  await new Promise(resolve => customServer.listen(3003, resolve));
  servers.push(customServer);

  // UDP 服务器
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'HEALTH_QUERY') {
        const response = Buffer.from(JSON.stringify({
          type: 'HEALTH_RESPONSE',
          status: 'ok'
        }));
        udpServer.send(response, rinfo.port, rinfo.address);
      }
    } catch (e) {}
  });
  
  await new Promise(resolve => udpServer.bind(3004, resolve));
  servers.push(udpServer);

  // gRPC 模拟服务器
  const grpcServer = net.createServer((socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
    socket.end();
  });
  
  await new Promise(resolve => grpcServer.listen(3005, resolve));
  servers.push(grpcServer);

  // WebSocket 服务器
  const wsServer = net.createServer((socket) => {
    let hasUpgrade = false;
    socket.on('data', (data) => {
      if (data.toString().includes('Upgrade: websocket')) {
        hasUpgrade = true;
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
      } else if (hasUpgrade) {
        socket.write(data); // Echo
      }
    });
  });
  
  await new Promise(resolve => wsServer.listen(3006, resolve));
  servers.push(wsServer);

  return servers;
}

async function stopTestServers(servers) {
  for (const server of servers) {
    if (server.close) {
      await new Promise(resolve => server.close(resolve));
    }
  }
}

// 运行测试
runComprehensiveTest().catch(console.error);