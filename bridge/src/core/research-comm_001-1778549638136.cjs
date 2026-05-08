// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:33:58.136Z

const http = require('http');
const net = require('net');
const dgram = require('dgram');

// 模拟姐妹实例配置（假设运行在本地不同端口）
const sisters = [
  { name: 'Instance-A', port: 3001, protocol: 'http' },
  { name: 'Instance-B', port: 3002, protocol: 'tcp' },
  { name: 'Instance-C', port: 3003, protocol: 'udp' }
];

// 检测方法1: HTTP Ping (已排除，但作为对比)
function httpPing(host, port) {
  return new Promise((resolve) => {
    const options = { host, port: port, timeout: 2000 };
    const req = http.request(options, (res) => {
      resolve({ success: true, method: 'HTTP Ping', message: `${host}:${port} HTTP/${res.httpVersion}` });
    });
    req.on('error', () => resolve({ success: false, method: 'HTTP Ping', message: 'Connection failed' }));
    req.end();
  });
}

// 检测方法2: TCP Socket 检测
function tcpCheck(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(port, host, () => {
      socket.end();
      resolve({ success: true, method: 'TCP Socket', message: `${host}:${port} TCP connection established` });
    });
    socket.on('error', () => resolve({ success: false, method: 'TCP Socket', message: 'TCP connection failed' }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, method: 'TCP Socket', message: 'TCP timeout' });
    });
  });
}

// 检测方法3: UDP Ping (轻量级广播)
function udpCheck(host, port) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    client.setTimeout(2000);
    client.send('PING', 0, port, host, (err) => {
      if (err) {
        resolve({ success: false, method: 'UDP Ping', message: 'UDP send failed' });
        return;
      }
      client.once('message', (msg) => {
        client.close();
        resolve({ success: true, method: 'UDP Ping', message: `UDP response: ${msg}` });
      });
      client.on('error', () => {
        client.close();
        resolve({ success: false, method: 'UDP Ping', message: 'UDP receive error' });
      });
    });
  });
}

// 检测方法4: 自定义心跳消息（模拟）
function customHeartbeat(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(port, host, () => {
      socket.write('HEARTBEAT\n', () => {
        socket.end();
        resolve({ success: true, method: 'Custom Heartbeat', message: `${host}:${port} responded to heartbeat` });
      });
    });
    socket.on('error', () => resolve({ success: false, method: 'Custom Heartbeat', message: 'Connection failed' }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, method: 'Custom Heartbeat', message: 'Timeout' });
    });
  });
}

// 主检测流程
async function detectSisters() {
  console.log('=== 实例间通讯方式研究 ===\n');
  
  // 定义检测方法数组
  const detectionMethods = [
    { fn: httpPing, name: 'HTTP Ping' },
    { fn: tcpCheck, name: 'TCP Socket' },
    { fn: udpCheck, name: 'UDP Ping' },
    { fn: customHeartbeat, name: 'Custom Heartbeat' }
  ];

  // 对每个姐妹实例进行检测
  for (const sister of sisters) {
    console.log(`检测姐妹实例: ${sister.name} (${sister.protocol})`);
    
    for (const method of detectionMethods) {
      const result = await method.fn('localhost', sister.port);
      console.log(`  [${method.name}] ${result.success ? '✓' : '✗'} ${result.message}`);
    }
    console.log('');
  }

  // 综合分析
  console.log('=== 综合分析 ===');
  console.log('除了HTTP Ping，还有以下方式可检测姐妹状态：');
  console.log('1. TCP Socket连接 - 可靠但资源占用较多');
  console.log('2. UDP Ping - 轻量级，适合广播场景');
  console.log('3. 自定义心跳消息 - 灵活协议，可扩展业务逻辑');
  console.log('\n结论：选择方式取决于网络环境、可靠性和性能要求。');
}

// 运行检测
detectSisters().catch(console.error);