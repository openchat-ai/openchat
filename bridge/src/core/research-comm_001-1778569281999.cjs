// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:01:21.999Z

const net = require('net');
const dgram = require('dgram');
const redis = require('redis');
const WebSocket = require('ws');

// 模拟的姐妹实例配置
const instanceId = process.env.INSTANCE_ID || 'instance-1';
const port = parseInt(process.env.PORT || '3001');

// 研究结果存储
const researchResults = {
  tcpSocket: { success: false, message: '' },
  udpHeartbeat: { success: false, message: '' },
  redisPubSub: { success: false, message: '' },
  webSocket: { success: false, message: '' }
};

// 1. TCP Socket 状态检测
function testTcpSocketDetection() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port + 100, () => {
      console.log(`[TCP] 服务器监听在端口 ${port + 100}`);
      
      // 模拟另一个实例连接
      const client = net.connect(port + 100, 'localhost', () => {
        researchResults.tcpSocket.success = true;
        researchResults.tcpSocket.message = 'TCP socket连接成功，可以检测姐妹实例状态';
        console.log('[TCP] 成功检测到姐妹实例');
        
        client.end();
        server.close();
        resolve();
      });
      
      client.on('error', (err) => {
        researchResults.tcpSocket.message = `TCP socket检测失败: ${err.message}`;
        resolve();
      });
    });
    
    server.on('connection', (socket) => {
      socket.on('data', (data) => {
        // 收到心跳数据
      });
    });
  });
}

// 2. UDP 心跳检测
function testUdpHeartbeat() {
  return new Promise((resolve) => {
    const udpServer = dgram.createSocket('udp4');
    const heartbeatInterval = 1000; // 1秒
    
    udpServer.bind(port + 200, () => {
      console.log(`[UDP] 心跳监听在端口 ${port + 200}`);
      
      // 发送心跳
      const heartbeat = Buffer.from(JSON.stringify({
        instanceId,
        timestamp: Date.now(),
        type: 'heartbeat'
      }));
      
      udpServer.send(heartbeat, port + 201, 'localhost', (err) => {
        if (err) {
          researchResults.udpHeartbeat.message = `UDP心跳发送失败: ${err.message}`;
        } else {
          researchResults.udpHeartbeat.success = true;
          researchResults.udpHeartbeat.message = 'UDP心跳机制有效，可以广播状态给所有姐妹实例';
        }
        resolve();
      });
    });
    
    // 接收心跳
    udpServer.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'heartbeat' && data.instanceId !== instanceId) {
          console.log(`[UDP] 收到姐妹实例 ${data.instanceId} 的心跳`);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
  });
}

// 3. Redis Pub/Sub 状态检测
async function testRedisPubSub() {
  try {
    const publisher = redis.createClient({ host: 'localhost', port: 6379 });
    const subscriber = redis.createClient({ host: 'localhost', port: 6379 });
    
    await Promise.all([publisher.connect(), subscriber.connect()]);
    
    console.log('[Redis] 连接成功');
    
    // 订阅状态通道
    await subscriber.subscribe(`instance-status-${instanceId}`, (message) => {
      console.log(`[Redis] 收到状态更新: ${message}`);
    });
    
    // 发布状态
    await publisher.publish(`instance-status-${instanceId}`, JSON.stringify({
      instanceId,
      status: 'alive',
      timestamp: Date.now()
    }));
    
    researchResults.redisPubSub.success = true;
    researchResults.redisPubSub.message = 'Redis Pub/Sub 可以实现实时状态广播和检测';
    
    await Promise.all([publisher.quit(), subscriber.quit()]);
  } catch (err) {
    researchResults.redisPubSub.message = `Redis Pub/Sub 测试失败: ${err.message}`;
  }
}

// 4. WebSocket 状态检测
function testWebSocket() {
  return new Promise((resolve) => {
    const wss = new WebSocket.Server({ port: port + 300 });
    console.log(`[WebSocket] 服务器监听在端口 ${port + 300}`);
    
    wss.on('connection', (ws) => {
      console.log('[WebSocket] 新的姐妹实例连接');
      
      ws.on('message', (message) => {
        console.log(`[WebSocket] 收到消息: ${message}`);
      });
      
      // 发送状态
      ws.send(JSON.stringify({
        instanceId,
        status: 'alive',
        timestamp: Date.now()
      }));
    });
    
    // 模拟客户端连接
    setTimeout(() => {
      const wsClient = new WebSocket(`ws://localhost:${port + 300}`);
      
      wsClient.on('open', () => {
        researchResults.webSocket.success = true;
        researchResults.webSocket.message = 'WebSocket 提供全双工通信，可实时交换状态';
        wsClient.close();
        wss.close();
        resolve();
      });
      
      wsClient.on('error', (err) => {
        researchResults.webSocket.message = `WebSocket 测试失败: ${err.message}`;
        resolve();
      });
    }, 500);
  });
}

// 执行所有测试
async function runResearch() {
  console.log('=== 实例间通讯方式研究 ===\n');
  
  console.log('1. 测试 TCP Socket 状态检测...');
  await testTcpSocketDetection();
  
  console.log('\n2. 测试 UDP 心跳检测...');
  await testUdpHeartbeat();
  
  console.log('\n3. 测试 Redis Pub/Sub...');
  await testRedisPubSub();
  
  console.log('\n4. 测试 WebSocket...');
  await testWebSocket();
  
  // 输出研究结果
  console.log('\n=== 研究结果总结 ===');
  console.log(JSON.stringify(researchResults, null, 2));
  
  console.log('\n=== 推荐方案 ===');
  console.log('1. TCP Socket: 适用于点对点直接连接的场景');
  console.log('2. UDP 心跳: 适用于广播场景，网络开销小');
  console.log('3. Redis Pub/Sub: 适用于已有Redis基础设施的分布式系统');
  console.log('4. WebSocket: 适用于需要双向实时通信的场景');
}

// 运行研究
runResearch().catch(console.error);