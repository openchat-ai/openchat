// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:59:47.577Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 创建一个简单的实例状态管理器
class InstanceCommunicator {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.status = 'idle';
    this.peers = new Map();
  }

  // 方法1: TCP Socket 心跳检测
  async tcpHeartbeatCheck(peerAddress) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        resolve({ method: 'TCP', status: 'timeout' });
      }, 3000);

      client.connect(9876, peerAddress, () => {
        clearTimeout(timeout);
        client.write(JSON.stringify({ type: 'ping', from: this.instanceId }));
      });

      client.on('data', (data) => {
        const response = JSON.parse(data.toString());
        if (response.type === 'pong') {
          this.peers.set(response.from, { status: 'alive', lastSeen: Date.now() });
          resolve({ method: 'TCP', status: 'alive', latency: response.timestamp - response.pingTime });
        }
        client.destroy();
      });

      client.on('error', () => {
        clearTimeout(timeout);
        resolve({ method: 'TCP', status: 'unreachable' });
      });
    });
  }

  // 方法2: UDP 广播发现
  udpBroadcastDiscovery() {
    const client = dgram.createSocket('udp4');
    const message = Buffer.from(JSON.stringify({
      type: 'discovery',
      from: this.instanceId,
      timestamp: Date.now()
    }));

    client.bind(() => {
      client.setBroadcast(true);
      client.send(message, 9875, '255.255.255.255', () => {
        client.close();
      });
    });
  }

  // 方法3: 文件状态标记
  fileBasedStatus(method, status) {
    const statusDir = path.join(os.tmpdir(), 'instance-status');
    if (!fs.existsSync(statusDir)) {
      fs.mkdirSync(statusDir, { recursive: true });
    }
    
    const statusFile = path.join(statusDir, `${this.instanceId}.status`);
    fs.writeFileSync(statusFile, JSON.stringify({
      method,
      status,
      timestamp: Date.now(),
      pid: process.pid
    }));
    
    // 读取所有实例状态
    const files = fs.readdirSync(statusDir);
    const statuses = {};
    files.forEach(file => {
      const content = fs.readFileSync(path.join(statusDir, file), 'utf8');
      const data = JSON.parse(content);
      statuses[path.basename(file, '.status')] = data;
    });
    
    return statuses;
  }

  // 方法4: 共享内存模拟 (使用文件作为共享存储)
  sharedMemoryPing(targetInstanceId) {
    const sharedFile = path.join(os.tmpdir(), 'shared-memory.json');
    const myState = {
      instanceId: this.instanceId,
      timestamp: Date.now(),
      alive: true
    };

    // 写入自己的状态
    let shared = {};
    if (fs.existsSync(sharedFile)) {
      shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    }
    shared[this.instanceId] = myState;
    fs.writeFileSync(sharedFile, JSON.stringify(shared));

    // 检查目标实例
    if (shared[targetInstanceId]) {
      const age = Date.now() - shared[targetInstanceId].timestamp;
      return { method: 'SharedMemory', status: age < 5000 ? 'alive' : 'stale', age };
    }
    return { method: 'SharedMemory', status: 'not_found' };
  }
}

// 运行演示
async function demonstrateCommunication() {
  console.log('=== 实例间通讯方式研究 ===\n');
  
  const comm = new InstanceCommunicator('instance-1');
  
  console.log('1. TCP Socket 心跳检测:');
  console.log('   - 适用于长连接、低延迟场景');
  console.log('   - 需维护持久化连接');
  console.log('   - 防火墙穿透需要特殊配置\n');

  console.log('2. UDP 广播发现:');
  console.log('   - 适用于局域网内快速发现');
  console.log('   - 广播包可能被路由器过滤');
  console.log('   - 适合服务发现场景\n');

  console.log('3. 文件状态标记:');
  const fileStatuses = comm.fileBasedStatus('file', 'active');
  console.log('   - 跨平台兼容');
  console.log('   - 适合批处理任务或低频通信');
  console.log('   - 当前所有实例状态:', JSON.stringify(fileStatuses, null, 2), '\n');

  console.log('4. 共享内存/文件存储:');
  const sharedResult = comm.sharedMemoryPing('instance-2');
  console.log('   - 模拟结果:', JSON.stringify(sharedResult), '\n');

  console.log('5. 其他通信方式:');
  console.log('   - Redis Pub/Sub: 适合分布式系统');
  console.log('   - WebSocket: 双向实时通信');
  console.log('   - gRPC: 高性能RPC框架');
  console.log('   - 消息队列 (RabbitMQ/Kafka): 解耦合异步通信');
  console.log('   - Unix Domain Sockets: 本地进程间通信');
  console.log('   - 数据库轮询: 使用共享数据库作为通信媒介');
}

demonstrateCommunication();