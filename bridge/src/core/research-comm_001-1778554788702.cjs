// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:59:48.702Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究目标：探索多种检测"姐妹实例"状态的方式
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

// ============================================
// 方式1: TCP Socket 心跳检测
// ============================================
class TCPHeartbeat extends EventEmitter {
  constructor(port, host) {
    super();
    this.port = port;
    this.host = host;
    this.server = null;
    this.clients = new Map();
  }

  startServer() {
    this.server = net.createServer((socket) => {
      console.log(`[TCP] 新连接: ${socket.remoteAddress}:${socket.remotePort}`);
      
      // 发送心跳响应
      socket.write(JSON.stringify({ type: 'heartbeat', status: 'alive', timestamp: Date.now() });
      
      socket.on('data', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            socket.write(JSON.stringify({ 
              type: 'pong', 
              status: 'alive', 
              timestamp: Date.now() 
            }));
          }
        } catch (e) {}
      });

      socket.on('close', () => {
        console.log(`[TCP] 连接关闭: ${socket.remoteAddress}`);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[TCP] 心跳服务器启动在端口 ${this.port}`);
    });
  }

  // 连接到其他实例并检测状态
  checkPeer(host, port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host }, () => {
        socket.write(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      });

      socket.setTimeout(3000);
      
      socket.on('data', (data) => {
        try {
          const response = JSON.parse(data.toString());
          console.log(`[TCP] 收到 ${host}:${port} 响应:`, response);
          resolve({ online: true, response, latency: Date.now() - (response.timestamp || Date.now()) };
        } catch (e) {
          resolve({ online: false, error: e.message };
        }
        socket.end();
      });

      socket.on('timeout', () => {
        console.log(`[TCP] ${host}:${port} 连接超时`);
        socket.destroy();
        resolve({ online: false, error: 'timeout' });
      });

      socket.on('error', (err) => {
        console.log(`[TCP] ${host}:${port} 连接错误:`, err.message);
        resolve({ online: false, error: err.message });
      });
    });
  }
}

// ============================================
// 方式2: UDP 广播发现
// ============================================
class UDPDiscovery extends EventEmitter {
  constructor(port = 41234) {
    super();
    this.port = port;
    this.server = null;
    this.client = null;
  }

  startServer() {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log(`[UDP] 收到来自 ${rinfo.address}:${rinfo.port} 的消息:`, data);
        
        if (data.type === 'discovery') {
          // 响应发现请求
          const response = Buffer.from(JSON.stringify({
            type: 'discovery-response',
            address: '192.168.1.100',
            port: 3000,
            status: 'alive',
            services: ['api', 'worker']
          }));
          
          this.server.send(response, rinfo.port, rinfo.address);
        }
      } catch (e) {
        console.log('[UDP] 解析消息失败:', e.message);
      }
    });

    this.server.bind(this.port, () => {
      this.server.setBroadcast(true);
      console.log(`[UDP] 发现服务启动在端口 ${this.port}`);
    });
  }

  // 广播发现请求
  broadcast() {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const message = Buffer.from(JSON.stringify({
        type: 'discovery',
        timestamp: Date.now(),
        from: 'instance-1'
      }));

      client.bind(() => {
        client.setBroadcast(true);
        client.send(message, 0, message.length, this.port, '255.255.255.255');
      });

      const responses = [];
      const timeout = setTimeout(() => {
        console.log(`[UDP] 发现完成，收到 ${responses.length} 个响应`);
        client.close();
        resolve(responses);
      }, 3000);

      client.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'discovery-response') {
            responses.push({ ...data, from: `${rinfo.address}:${rinfo.port}` };
            console.log(`[UDP] 发现实例:`, data);
          }
        } catch (e) {}
      });
    });
  }
}

// ============================================
// 方式3: 模拟 Redis Pub/Sub 状态同步
// ============================================
class RedisStatusSync extends EventEmitter {
  constructor() {
    super();
    // 模拟 Redis 连接
    this.subscriptions = new Map();
    this.instanceStatus = new Map();
  }

  // 模拟发布状态
  publishStatus(instanceId, status) {
    const message = JSON.stringify({
      type: 'status-update',
      instanceId,
      status,
      timestamp: Date.now(),
      cpu: Math.random() * 100,
      memory: Math.random() * 1024
    });
    
    console.log(`[Redis] 发布状态: ${instanceId} -> ${status}`);
    console.log(`[Redis] 消息内容:`, message);
    
    // 模拟订阅者收到消息
    this.subscriptions.forEach((callback, channel) => {
      if (channel === 'instance-status') {
        callback(message);
      }
    });
    
    this.instanceStatus.set(instanceId, JSON.parse(message));
    return message;
  }

  // 模拟订阅状态频道
  subscribe(channel, callback) {
    console.log(`[Redis] 订阅频道: ${channel}`);
    this.subscriptions.set(channel, callback);
  }

  // 获取所有实例状态
  getAllStatus() {
    const status = {};
    this.instanceStatus.forEach((value, key) => {
      status[key] = value;
    });
    return status;
  }
}

// ============================================
// 方式4: 服务注册中心模拟 (Consul/Etcd 风格)
// ============================================
class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.heartbeats = new Map();
  }

  // 注册服务
  register(serviceName, instanceId, address, port, metadata = {}) {
    const service = {
      serviceName,
      instanceId,
      address,
      port,
      metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'healthy'
    };
    
    this.services.set(instanceId, service);
    console.log(`[Registry] 注册服务: ${instanceId} at ${address}:${port}`);
    return service;
  }

  // 心跳
  heartbeat(instanceId) {
    const service = this.services.get(instanceId);
    if (service) {
      service.lastHeartbeat = Date.now();
      service.status = 'healthy';
      this.heartbeats.set(instanceId, Date.now());
      console.log(`[Registry] 收到心跳: ${instanceId}`);
      return true;
    }
    return false;
  }

  // 获取健康实例
  getHealthyInstances(serviceName) {
    const now = Date.now();
    const healthy = [];
    
    this.services.forEach((service, instanceId) => {
      if (service.serviceName === serviceName) {
        // 检查心跳是否超时 (10秒)
        if (now - service.lastHeartbeat < 10000) {
          healthy.push(service);
        } else {
          service.status = 'unhealthy';
        }
      }
    });
    
    return healthy;
  }

  // 标记不健康实例
  checkHealth(timeoutMs = 10000) {
    const now = Date.now();
    const unhealthy = [];
    
    this.services.forEach((service, instanceId) => {
      if (now - service.lastHeartbeat > timeoutMs) {
        service.status = 'unhealthy';
        unhealthy.push(instanceId);
      }
    });
    
    if (unhealthy.length > 0) {
      console.log(`[Registry] 检测到不健康实例:`, unhealthy);
    }
    
    return unhealthy;
  }
}

// ============================================
// 方式5: HTTP 长轮询状态
// ============================================
class HTTPLongPolling {
  constructor(port) {
    this.port = port;
    this.server = null;
    this.pendingRequests = [];
    this.status = { instances: new Map() };
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/status') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          status: 'ok',
          instances: Object.fromEntries(this.status.instances),
          timestamp: Date.now()
        }));
      } 
      else if (req.url === '/long-poll') {
        // 长轮询端点
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Connection': 'close'
        });
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const data = JSON.parse(body || '{}');
          this.status.instances.set(data.instanceId, {
            ...data,
            lastUpdate: Date.now()
          });
          
          res.end(JSON.stringify({
            acknowledged: true,
            allInstances: Object.fromEntries(this.status.instances)
          }));
        });
      }
      else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[HTTP] 状态服务器启动在端口 ${this.port}`);
    });
  }
}

// ============================================
// 主程序：综合演示
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法演示');
  console.log('='.repeat(60));

  // 1. TCP 心跳检测
  console.log('\n--- 方式1: TCP Socket 心跳检测 ---');
  const tcpServer = new TCPHeartbeat(3001);
  tcpServer.startServer();
  
  // 模拟检测对端
  setTimeout(async () => {
    const result = await tcpServer.checkPeer('127.0.0.1', 3001);
    console.log('[TCP] 检测结果:', result);
  }, 500);

  // 2. UDP 服务发现
  console.log('\n--- 方式2: UDP 广播发现 ---');
  const udpDiscovery = new UDPDiscovery(41235);
  udpDiscovery.startServer();
  
  setTimeout(() => {
    udpDiscovery.broadcast();
  }, 1000);

  // 3. Redis Pub/Sub 状态同步
  console.log('\n--- 方式3: Redis Pub/Sub 状态同步 ---');
  const redisSync = new RedisStatusSync();
  
  // 订阅状态更新
  redisSync.subscribe('instance-status', (message) => {
    console.log('[Redis] 收到状态更新:', JSON.parse(message));
  });
  
  // 模拟多个实例发布状态
  redisSync.publishStatus('instance-1', 'healthy');
  redisSync.publishStatus('instance-2', 'healthy');
  redisSync.publishStatus('instance-3', 'unhealthy');
  
  console.log('[Redis] 所有实例状态:', redisSync.getAllStatus());

  // 4. 服务注册中心
  console.log('\n--- 方式4: 服务注册中心 (Consul风格) ---');
  const registry = new ServiceRegistry();
  
  // 注册多个实例
  registry.register('api-service', 'instance-1', '192.168.1.10', 3000, { version: '1.0.0' });
  registry.register('api-service', 'instance-2', '192.168.1.11', 3000, { version: '1.0.0' });
  registry.register('api-service', 'instance-3', '192.168.1.12', 3000, { version: '1.0.1' });
  
  // 模拟心跳
  registry.heartbeat('instance-1');
  registry.heartbeat('instance-2');
  
  // 获取健康实例
  console.log('[Registry] 健康实例:', registry.getHealthyInstances('api-service'));
  
  // 模拟 instance-3 宕机 (不发送心跳)
  setTimeout(() => {
    registry.checkHealth(5000); // 5秒超时
    console.log('[Registry] 健康实例 (after check):', registry.getHealthyInstances('api-service'));
  }, 6000);

  // 5. HTTP 长轮询
  console.log('\n--- 方式5: HTTP 长轮询 ---');
  const httpPolling = new HTTPLongPolling(3002);
  httpPolling.start();

  // 总结
  console.log('\n' + '='.repeat(60));
  console.log('研究总结：实例间状态检测方式');
  console.log('='.repeat(60));
  
  const summary = `
┌─────────────────────────────────────────────────────────────┐
│                    状态检测方式对比                          │
├──────────────┬───────────┬──────────┬───────────────────────┤
│ 方式         │ 延迟      │ 可靠性   │ 适用场景               │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ HTTP Ping    │ 中等      │ 高       │ 通用，跨防火墙         │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ TCP Socket   │ 低        │ 高       │ 低延迟要求，内部网络   │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ UDP 广播     │ 很低      │ 低       │ 服务发现，局域网       │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ Redis Pub/Sub│ 低        │ 高       │ 分布式状态同步         │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ 服务注册中心 │ 中等      │ 高       │ 微服务，K8s           │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ WebSocket    │ 很低      │ 高       │ 实时双向通信           │
├──────────────┼───────────┼──────────┼───────────────────────┤
│ gRPC         │ 很低      │ 高       │ 高性能内部通信        │
└──────────────┴───────────┴──────────┴───────────────────────┘

推荐方案:
1. 简单场景: HTTP + 健康检查端点
2. 低延迟: TCP 心跳或 WebSocket
3. 大规模: Redis Pub/Sub 或服务注册中心(Consul/Etcd)
4. 服务发现: UDP 广播 + 注册中心
  `;
  
  console.log(summary);

  // 清理资源
  setTimeout(() => {
    console.log('\n演示完成，程序退出');
    process.exit(0);
  }, 8000);
}

main().catch(console.error);