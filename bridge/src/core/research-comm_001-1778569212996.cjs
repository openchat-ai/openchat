// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:00:12.996Z

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const http = require('http');
const { exec } = require('child_process');

// 模拟姐妹节点列表
const sisterNodes = [
  { id: 1, host: '127.0.0.1', port: 3001, name: 'Node Alpha' },
  { id: 2, host: '127.0.0.1', port: 3002, name: 'Node Beta' },
  { id: 3, host: '127.0.0.1', port: 3003', name: 'Node Gamma' },
  // 模拟一个不可达的节点
  { id: 4, host: '192.0.2.1', port: 3000, name: 'Node Delta (Unreachable)' }
];

// 1. TCP 连接检测
function checkTcpConnectivity(node) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ nodeId: node.id, method: 'TCP', status: 'timeout', message: 'Connection timeout' });
    }, 2000);

    socket.connect(node.port, node.host, () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ nodeId: node.id, method: 'TCP', status: 'success', message: 'Connected successfully' });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ nodeId: node.id, method: 'TCP', status: 'failed', message: err.message });
    });
  });
}

// 2. UDP 包检测
function checkUdpConnectivity(node) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      socket.close();
      resolve({ nodeId: node.id, method: 'UDP', status: 'timeout', message: 'Response timeout' });
    }, 2000);

    const message = Buffer.from('ping');
    socket.send(message, 0, message.length, node.port, node.host, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        resolve({ nodeId: node.id, method: 'UDP', status: 'failed', message: err.message });
      }
    });

    socket.on('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      resolve({ 
        nodeId: node.id, 
        method: 'UDP', 
        status: 'success', 
        message: `Received: ${msg.toString()}` 
      });
    });
  });
}

// 3. WebSocket 连接检测
function checkWebSocketConnectivity(node) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ nodeId: node.id, method: 'WebSocket', status: 'timeout', message: 'Connection timeout' });
    }, 2000);

    const ws = new WebSocket(`ws://${node.host}:${node.port}`);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      ws.send('ping');
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      ws.close();
      resolve({ 
        nodeId: node.id, 
        method: 'WebSocket', 
        status: 'success', 
        message: `Received: ${data.toString()}` 
      });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ nodeId: node.id, method: 'WebSocket', status: 'failed', message: err.message });
    });
  });
}

// 4. HTTP ping 检测（作为基准）
function checkHttpPing(node) {
  return new Promise((resolve) => {
    const options = {
      hostname: node.host,
      port: node.port,
      path: '/health',
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ 
          nodeId: node.id, 
          method: 'HTTP', 
          status: res.statusCode === 200 ? 'success' : 'failed',
          message: `Status: ${res.statusCode}, Response: ${data}` 
        });
      });
    });

    req.on('error', (err) => {
      resolve({ nodeId: node.id, method: 'HTTP', status: 'failed', message: err.message });
    });

    req.end();
  });
}

// 5. DNS 检测（通过检查主机名解析）
function checkDnsResolution(node) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(`nslookup ${node.host}`, (error, stdout, stderr) => {
      if (error) {
        resolve({ nodeId: node.id, method: 'DNS', status: 'failed', message: stderr });
      } else {
        resolve({ 
          nodeId: node.id, 
          method: 'DNS', 
          status: 'success', 
          message: 'DNS resolution successful' 
        });
      }
    });
  });
}

// 主函数：运行所有检测方法
async function runConnectivityTests() {
  console.log('开始姐妹节点状态检测...\n');
  
  const methods = [
    checkTcpConnectivity,
    checkUdpConnectivity,
    checkWebSocketConnectivity,
    checkHttpPing,
    checkDnsResolution
  ];
  
  const results = [];
  
  // 对每个节点应用所有方法
  for (const node of sisterNodes) {
    console.log(`检测节点 ${node.name} (${node.host}:${node.port}):`);
    
    const nodeResults = [];
    
    for (const method of methods) {
      try {
        const result = await method(node);
        nodeResults.push(result);
        console.log(`  - ${result.method}: ${result.status} - ${result.message}`);
      } catch (err) {
        nodeResults.push({ 
          nodeId: node.id, 
          method: method.name, 
          status: 'error', 
          message: err.message 
        });
        console.log(`  - ${method.name}: error - ${err.message}`);
      }
    }
    
    results.push({ node, tests: nodeResults });
    console.log('');
  }
  
  // 分析结果
  console.log('检测方法总结:');
  const methodStats = {};
  
  methods.forEach(method => {
    methodStats[method.name] = { success: 0, failed: 0, timeout: 0 };
  });
  
  results.forEach(({ tests }) => {
    tests.forEach(({ method, status }) => {
      if (methodStats[method]) {
        if (status === 'success') methodStats[method].success++;
        else if (status === 'failed') methodStats[method].failed++;
        else if (status === 'timeout') methodStats[method].timeout++;
      }
    });
  });
  
  Object.entries(methodStats).forEach(([method, stats]) => {
    const total = stats.success + stats.failed + stats.timeout;
    console.log(`- ${method}: 成功(${stats.success}/${total}), 失败(${stats.failed}/${total}), 超时(${stats.timeout}/${total})`);
  });
  
  console.log('\n结论:');
  console.log('1. TCP 连接是最可靠的基础检测方式，但需要服务器监听特定端口');
  console.log('2. UDP 检测速度快但不可靠，适合广播式检测');
  console.log('3. WebSocket 需要服务器端支持，但能提供双向通信');
  console.log('4. HTTP ping 最常见但需要健康检查端点');
  console.log('5. DNS 检测只验证域名解析，不验证服务可用性');
  console.log('\n建议组合使用多种方法以提高检测的准确性。');
}

// 运行测试
runConnectivityTests().catch(console.error);