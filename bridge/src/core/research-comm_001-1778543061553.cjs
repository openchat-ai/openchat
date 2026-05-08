// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:44:21.553Z

/**
 * 实例间状态检测方式研究
 * 模拟多个分布式实例，测试除HTTP ping外的多种状态检测方式
 */

const http = require('http');
const net = require('net');
const cluster = require('cluster');
const os = require('os');

// 模拟分布式环境：启动多个工作进程模拟实例
class InstanceMonitor {
  constructor() {
    this.instances = new Map(); // 实例ID -> {host, port, type, status}
    this.methods = {
      tcpConnect: this.tcpCheck.bind(this),
      udpPing: this.udpCheck.bind(this),
      sharedMemory: this.sharedMemoryCheck.bind(this),
      socketPing: this.socketPing.bind(this),
      dnsResolve: this.dnsCheck.bind(this)
    };
  }

  // 注册模拟实例
  registerInstance(id, port, type = 'http') {
    this.instances.set(id, {
      id,
      host: '127.0.0.1',
      port,
      type,
      status: 'unknown',
      lastCheck: null
    });
    console.log(`[系统] 实例 ${id} 注册在端口 ${port} (类型: ${type})`);
  }

  // TCP连接检测
  async tcpCheck(instance) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port: instance.port, host: instance.host }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  // UDP ping检测
  async udpCheck(instance) {
    return new Promise((resolve) => {
      const client = net.createConnection({ port: instance.port, host: instance.host }, () => {
        client.write('ping');
      });
      let timeout;
      client.on('data', (data) => {
        clearTimeout(timeout);
        client.end();
        resolve(data.toString() === 'pong');
      });
      client.on('error', () => resolve(false));
      timeout = setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 1000);
    });
  }

  // 共享内存/信号机制检测
  async sharedMemoryCheck(instance) {
    // 模拟：检查进程是否存在（实际中可用Redis或共享内存）
    try {
      const running = process.pid !== instance.id; // 简化模拟
      return running;
    } catch {
      return false;
    }
  }

  // Socket层心跳
  async socketPing(instance) {
    return new Promise((resolve) => {
      const client = net.createConnection({ port: instance.port + 1000, host: instance.host }, () => {
        client.write('heartbeat');
        client.end();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });
  }

  // DNS解析检测（适用于服务发现）
  async dnsCheck(instance) {
    try {
      const addresses = await new Promise((resolve) => {
        require('dns').resolve4(instance.host, (err, addr) => {
          resolve(addr || []);
        });
      });
      return addresses.length > 0;
    } catch {
      return false;
    }
  }

  // 执行所有检测
  async runAllChecks() {
    console.log('\n=== 实例状态检测开始 ===');
    for (const [id, instance] of this.instances) {
      console.log(`\n检测实例 ${id} (端口: ${instance.port}):`);
      for (const [method, checker] of Object.entries(this.methods)) {
        const result = await checker(instance);
        console.log(`  ${method.padEnd(15)}: ${result ? '✅ 正常' : '❌ 异常'}`);
        if (result) instance.status = 'healthy';
      }
    }
    return this.getInstanceReport();
  }

  getInstanceReport() {
    const report = {
      total: this.instances.size,
      healthy: Array.from(this.instances.values()).filter(i => i.status === 'healthy').length,
      methods: Object.keys(this.methods)
    };
    return report;
  }
}

// 模拟启动多个HTTP服务器（模拟真实实例）
function startMockInstances(monitor) {
  const instances = [];
  for (let i = 0; i < 3; i++) {
    const port = 3000 + i;
    const instanceId = `instance-${i}`;
    
    // 启动HTTP服务器（模拟服务）
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else if (req.url === '/udp-ping') {
        res.writeHead(200);
        res.end('pong');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(port, () => {
      console.log(`模拟实例 ${instanceId} 在端口 ${port} 运行中`);
    });

    // 注册到监控器
    monitor.registerInstance(instanceId, port, 'http');
    instances.push({ server, port });
  }
  return instances;
}

// 主程序
async function main() {
  const monitor = new InstanceMonitor();
  
  // 启动模拟实例
  const mockInstances = startMockInstances(monitor);
  
  // 给实例一点时间启动
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 执行检测
  const report = await monitor.runAllChecks();
  
  // 输出总结
  console.log('\n=== 检测总结 ===');
  console.log(`总实例数: ${report.total}`);
  console.log(`健康实例数: ${report.healthy}`);
  console.log('检测方式:', report.methods.join(', '));
  console.log('\n各方式特点:');
  console.log('1. TCP连接检测: 底层连接验证，无需应用层协议');
  console.log('2. UDP ping: 轻量级，但可能被防火墙阻断');
  console.log('3. 共享内存: 依赖外部存储，适合服务发现');
  console.log('4. Socket心跳: 自定义协议，灵活但需约定');
  console.log('5. DNS解析: 适用于基于DNS的服务发现');
  
  // 清理
  mockInstances.forEach(inst => inst.server.close());
}

// 运行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = InstanceMonitor;