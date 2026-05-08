// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:56:40.785Z

// 节点间通信方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？

// 1. 检测方式：Socket.io 实现实时双向通信
const io = require('socket.io')(3001);

// 监听连接
io.on('connection', (socket) => {
  console.log('客户端已连接');

  // 监听心跳检测
  socket.on('ping', (data) => {
    console.log(`收到心跳检测：${data}`);
    socket.emit('pong', { timestamp: Date.now() });
  });

  // 监听其他客户端发送的消息
  socket.on('message', (data) => {
    console.log(`收到消息：${data}`);
    // 可以选择性地回复其他客户端
    // io.emit('reply', '这是回复');
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('客户端已断开连接');
  });
});

// 2. 检测方式：WebSocket 实现实时通信
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3002 });

wss.on('connection', (ws) => {
  console.log('客户端已连接');

  // 监听心跳检测
  ws.isAlive = true;
  setInterval(() => {
    ws.isAlive = false;
    ws.ping(() => { ws.isAlive = true; });
  }, 30000);

  ws.on('pong', () => {
    console.log('收到 pong 回复');
  });

  // 监听客户端发送的消息
  ws.on('message', (message) => {
    console.log(`收到消息：${message}`);
    // 可以选择性地回复客户端
    // ws.send('这是回复');
  });

  // 断开连接
  ws.on('close', () => {
    console.log('客户端已断开连接');
  });

  // 监听异常
  ws.on('error', (error) => {
    console.error('WebSocket 错误：', error);
  });
});

// 3. 检测方式：共享内存（Redis）
const redis = require('redis');
const client = redis.createClient(6379);

// 存储心跳时间戳
const key = 'heartbeat';
client.on('error', (error) => {
  console.error('Redis 错误：', error);
});

// 检测心跳
const checkHeartbeat = async () => {
  const value = await client.get(key);
  if (value) {
    const lastPing = new Date(value);
    const now = new Date();
    const diff = now.getTime() - lastPing.getTime();
    if (diff > 30000) { // 30秒超时
      console.log('Redis 心跳超时');
      // 处理超时逻辑，如更新状态、发送通知等
    } else {
      console.log(`Redis 心跳正常，最近一次更新：${lastPing}`);
    }
  }
};

// 模拟心跳检测
const simulateHeartbeat = () => {
  setInterval(() => {
    client.set(key, Date.now());
    console.log('Redis 心跳已更新');
  }, 5000); // 每5秒心跳一次
};

// 启动心跳检测
simulateHeartbeat();

// 检测方式：定时轮询（HTTP）
const http = require('http');
const server = http.createServer();
const port = 3003;

let clients = [];

server.on('request', (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>姐妹状态检测页面</h1>');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('connection', (socket) => {
  console.log('客户端已连接');

  // 添加到客户端列表
  clients.push(socket);

  // 监听客户端发送的消息
  socket.on('data', (data) => {
    console.log(`收到消息：${data}`);
    // 处理消息逻辑
  });

  // 断开连接
  socket.on('end', () => {
    console.log('客户端已断开连接');
    // 从客户端列表移除
    clients = clients.filter(client => client !== socket);
  });
});

// 启动HTTP服务器
server.listen(port, () => {
  console.log(`HTTP 服务器已启动，端口：${port}`);
});

// 检测方式：gRPC（远程过程调用）
// 由于 gRPC 需要额外的 protobuf 定义和编译，这里仅展示基础框架
const grpc = require('@grpc/grpc-js');
const proto = require('./path/to/your/protobuf/file.proto'); // 需替换为实际的 protobuf 文件路径

const server = new grpc.Server();
server.addService(proto.example.AdditionImpl, {
  add(request, callback) {
    const result = request.a + request.b;
    callback(null, { result });
  }
});

server.bindAsync('0.0.0.0:3004', grpc.ServerCredentials.createInsecure(), (err, address) => {
  if (err) {
    console.error('启动 gRPC 服务器失败：', err);
    return;
  }
  console.log(`gRPC 服务器已启动，地址：${address}`);
  server.start();
});

// 注意：上述代码中的 gRPC 示例仅用于展示，实际使用时需替换为真实的 protobuf 文件路径和具体逻辑