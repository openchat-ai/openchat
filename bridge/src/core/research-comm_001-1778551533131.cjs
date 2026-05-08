// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:05:33.131Z

/**
 * 实例间通讯方式研究：除了HTTP ping外的状态检测方法
 * 
 * 研究目标：探索多种检测"姐妹实例"(sibling instances)存活状态的方式
 */

const net = require('net');
const dgram = require('dgram');
const http = require('http');
const EventEmitter = require('events');

// =====================================================
// 第一部分：模拟实例类
// =====================================================

class MockInstance extends EventEmitter {
  constructor(id, port) {
    super();
    this.id = id;
    this.port = port;
    this.status = 'unknown'; // unknown, healthy, unhealthy
    this.lastHeartbeat = null;
    this.metadata = {
      startedAt: Date.now(),
      version: '1.0.0'
    };
  }

  setHealthy() {
    this.status = 'healthy';
    this.lastHeartbeat = Date.now();
    this.emit('statusChange', this.status);
  }

  setUnhealthy() {
    this.status = 'unhealthy';
    this.emit('statusChange', this.status);
  }
}

// =====================================================
// 第二部分：多种检测方式实现
// =====================================================

/**
 * 方式1: TCP 端口检测
 * 原理：尝试建立 TCP 连接，如果成功则认为实例存活
 */
class TCPHealthChecker {
  constructor(timeout = 3000) {
    this.timeout = timeout;
  }

  async check(instance) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ 
          method: 'TCP', 
          instanceId: instance.id, 
          healthy: false, 
          reason: 'Connection timeout' 
        });
      }, this.timeout);

      socket.connect(instance.port, '127.0.0.1', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ 
          method: 'TCP', 
          instanceId: instance.id, 
          healthy: true 
        });
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ 
          method: 'TCP', 
          instanceId: instance.id, 
          healthy: false, 
          reason: err.message 
        });
      });
    });
  }
}

/**
 * 方式2: UDP 心跳检测
 * 原理：通过 UDP 广播心跳，接收方检测是否收到心跳
 */
class UDPHeartbeatMonitor extends EventEmitter {
  constructor(port = 41234) {
    super();
    this.port = port;
    this.server = null;
    this.instances = new Map(); // instanceId -> lastSeen
  }

  start() {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'heartbeat') {
          this.instances.set(data.instanceId, {
            lastSeen: Date.now(),
            address: rinfo.address,
            port: rinfo.port
          });
          this.emit('heartbeat', data);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    this.server.bind(this.port, () => {
      console.log(`[UDP] 心跳监控启动，监听端口 ${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }

  checkInstanceHealth(instanceId, timeout = 5000) {
    const lastSeen = this.instances.get(instanceId);
    if (!lastSeen) {
      return { method: 'UDP', instanceId, healthy: false, reason: 'No heartbeat received' };
    }
    
    const age = Date.now() - lastSeen.lastSeen;
    return {
      method: 'UDP',
      instanceId,
      healthy: age < timeout,
      lastHeartbeatAge: age
    };
  }
}

/**
 * 方式3: 共享存储检测 (模拟 Redis/数据库)
 * 原理：实例定期更新存储中的心跳时间，其他实例检查该时间
 */
class SharedStoreHealthChecker {
  constructor() {
    // 模拟共享存储 (实际可用 Redis)
    this.store = new Map();
  }

  // 模拟实例注册和心跳
  registerInstance(instance) {
    this.store.set(`instance:${instance.id}`, {
      ...instance.metadata,
      lastHeartbeat: Date.now()
    });
  }

  updateHeartbeat(instanceId) {
    const key = `instance:${instanceId}`;
    if (this.store.has(key)) {
      const data = this.store.get(key);
      data.lastHeartbeat = Date.now();
      this.store.set(key, data);
    }
  }

  // 检查实例健康状态
  async check(instanceId, timeout = 5000) {
    const key = `instance:${instanceId}`;
    const data = this.store.get(key);
    
    if (!data) {
      return { method: 'SharedStore', instanceId, healthy: false, reason: 'Not registered' };
    }

    const age = Date.now() - data.lastHeartbeat;
    return {
      method: 'SharedStore',
      instanceId,
      healthy: age < timeout,
      lastHeartbeatAge: age,
      metadata: data
    };
  }
}

/**
 * 方式4: 自定义二进制协议检测
 * 原理：使用自定义的协议进行状态交换
 */
class BinaryProtocolChecker {
  constructor() {
    this.server = null;
  }

  start(port = 41235) {
    this.server = net.createServer((socket) => {
      // 响应固定格式的数据包
      const response = Buffer.alloc(8);
      response.writeUInt32BE(0xDEADBEEF, 0); // 魔数
      response.writeUInt32BE(1, 4); // 状态: 1 = healthy
      
      socket.write(response);
    });

    this.server.listen(port, () => {
      console.log(`[Binary] 协议服务器启动，端口 ${port}`);
    });
  }

  async check(port = 41235) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timer = setTimeout(() => {
        client.destroy();
        resolve({ method: 'Binary', healthy: false, reason: 'Timeout' });
      }, 3000);

      client.connect(port, '127.0.0.1', () => {
        // 发送探测请求
        const request = Buffer.alloc(4);
        request.writeUInt32BE(0xCAFEBABE, 0);
        client.write(request);
      });

      client.on('data', (data) => {
        clearTimeout(timer);
        if (data.length >= 8) {
          const magic = data.readUInt32BE(0);
          const status = data.readUInt32BE(4);
          client.destroy();
          resolve({
            method: 'Binary',
            healthy: magic === 0xDEADBEEF && status === 1,
            protocol: 'custom-binary'
          });
        }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        client.destroy();
        resolve({ method: 'Binary', healthy: false, reason: err.message });
      });
    });
  }
}

/**
 * 方式5: HTTP 长轮询/Server-Sent Events
 * 原理：通过 HTTP 长连接获取实时状态更新
 */
class SSEHealthMonitor extends EventEmitter {
  constructor() {
    this.instances = new Map();
    this.server = null;
  }

  start(port = 41236) {
    this.server = http.createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // 发送初始数据
        this.sendUpdate(res);

        // 定期发送更新
        const interval = setInterval(() => {
          this.sendUpdate(res);
        }, 2000);

        req.on('close', () => {
          clearInterval(interval);
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server.listen(port, () => {
      console.log(`[SSE] 事件流服务器启动，端口 ${port}`);
    });
  }

  sendUpdate(res) {
    const data = {
      timestamp: Date.now(),
      instances: Array.from(this.instances.entries())
    };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  registerInstance(instanceId, status) {
    this.instances.set(instanceId, status);
    this.emit('update', { instanceId, status });
  }
}

// =====================================================
// 第三部分：主程序 - 综合演示
// =====================================================

async function main() {
  console.log('='.repeat(60));
  console.log('实例间通讯方式研究 - 状态检测方法对比');
  console.log('='.repeat(60));

  // 创建模拟实例
  const instances = [
    new MockInstance('instance-1', 3001),
    new MockInstance('instance-2', 3002),
    new MockInstance('instance-3', 3003)
  ];

  console.log('\n📋 模拟实例列表:');
  instances.forEach(i => console.log(`  - ${i.id}: port ${i.port}`));

  // 方式1: TCP 检测演示
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 方式1: TCP 端口检测');
  console.log('-'.repeat(60));
  
  const tcpChecker = new TCPHealthChecker();
  // 注意：这些端口实际上没有服务，所以会失败，这是正常的演示
  for (const instance of instances) {
    const result = await tcpChecker.check(instance);
    console.log(`  检测 ${result.instanceId}: ${result.healthy ? '✅ 存活' : '❌ 不可达'}`);
    if (result.reason) console.log(`    原因: ${result.reason}`);
  }

  // 方式2: UDP 心跳检测演示
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 方式2: UDP 心跳检测');
  console.log('-'.repeat(60));
  
  const udpMonitor = new UDPHeartbeatMonitor(41234);
  udpMonitor.start();

  // 模拟接收心跳
  setTimeout(() => {
    const socket = dgram.createSocket('udp4');
    const heartbeat = JSON.stringify({
      type: 'heartbeat',
      instanceId: 'instance-1',
      status: 'healthy'
    });
    socket.send(heartbeat, 41234, '127.0.0.1');
    console.log('  📤 模拟发送心跳: instance-1');
  }, 100);

  await new Promise(r => setTimeout(r, 500));
  
  const udpResult = udpMonitor.checkInstanceHealth('instance-1');
  console.log(`  检测结果: ${udpResult.healthy ? '✅ 存活' : '❌ 不可达'}`);
  udpMonitor.stop();

  // 方式3: 共享存储检测演示
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 方式3: 共享存储检测 (模拟 Redis)');
  console.log('-'.repeat(60));
  
  const storeChecker = new SharedStoreHealthChecker();
  
  // 注册实例
  instances.forEach(i => storeChecker.registerInstance(i));
  console.log('  📝 已注册 3 个实例到共享存储');

  // 模拟心跳更新
  storeChecker.updateHeartbeat('instance-1');
  await new Promise(r => setTimeout(r, 100));
  storeChecker.updateHeartbeat('instance-2');
  await new Promise(r => setTimeout(r, 100));
  // instance-3 没有更新心跳

  // 检查健康状态
  for (const id of ['instance-1', 'instance-2', 'instance-3']) {
    const result = await storeChecker.check(id);
    const status = result.healthy ? '✅ 存活' : '❌ 离线';
    console.log(`  ${id}: ${status} (心跳间隔: ${result.lastHeartbeatAge}ms)`);
  }

  // 方式4: 自定义二进制协议检测
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 方式4: 自定义二进制协议检测');
  console.log('-'.repeat(60));
  
  const binaryChecker = new BinaryProtocolChecker();
  binaryChecker.start(41235);
  
  await new Promise(r => setTimeout(r, 100));
  const binaryResult = await binaryChecker.check(41235);
  console.log(`  检测结果: ${binaryResult.healthy ? '✅ 存活' : '❌ 不可达'}`);
  console.log(`  协议类型: ${binaryResult.protocol}`);
  binaryChecker.server.close();

  // 方式5: SSE 长连接检测
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 方式5: Server-Sent Events (SSE) 检测');
  console.log('-'.repeat(60));
  
  const sseMonitor = new SSEHealthMonitor();
  sseMonitor.start(41236);

  // 模拟注册实例状态
  sseMonitor.registerInstance('instance-1', 'healthy');
  sseMonitor.registerInstance('instance-2', 'healthy');
  sseMonitor.registerInstance('instance-3', 'unhealthy');

  console.log('  📡 SSE 服务已启动，可通过 /events 端点获取实时状态');
  console.log('  实例状态:');
  console.log('    - instance-1: healthy');
  console.log('    - instance-2: healthy');
  console.log('    - instance-3: unhealthy');
  
  sseMonitor.server.close();

  // 研究总结
  console.log('\n' + '='.repeat(60));
  console.log('📊 研究总结: 实例状态检测方式对比');
  console.log('='.repeat(60));

  const summary = `
┌─────────────────┬──────────┬──────────┬────────────────────────────┐
│ 检测方式        │ 延迟     │ 资源消耗 │ 适用场景                     │
├─────────────────┼──────────┼──────────┼────────────────────────────┤
│ HTTP Ping       │ 中等     │ 中等     │ 通用方案，跨语言/跨平台      │
│ TCP 端口        │ 低       │ 低       │ 快速检测，不需要应用层响应   │
│ UDP 心跳        │ 很低     │ 很低     │ 高性能场景，支持广播        │
│ 共享存储(Redis) │ 中等     │ 中等     │ 分布式系统，需要持久化      │
│ gRPC 健康检查   │ 低       │ 低       │ 微服务架构，TypeScript生态   │
│ 自定义协议      │ 低       │ 低       │ 对性能有特殊要求的场景       │
│ SSE/WebSocket   │ 实时     │ 中等     │ 需要实时状态推送的场景       │
└─────────────────┴──────────┴──────────┴────────────────────────────┘

💡 关键洞察:
1. 没有"最佳"方案，只有最适合的方案
2. 生产环境通常组合使用多种方式 (如: HTTP + 共享存储)
3. 考虑因素: 延迟要求、资源消耗、可靠性、实现复杂度
4. 云原生时代推荐: 配合 Kubernetes Liveness/Readiness Probes
  `;

  console.log(summary);
}

// 运行主程序
main().catch(console.error);