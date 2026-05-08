// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:13:50.982Z

// 引入需要的库
const WebSocket = require('ws');
const net = require('net');

// 初始化 WebSocket 服务器
const wss = new WebSocket.Server({ port: 8080 });

// 初始化 TCP 服务器
const server = net.createServer();
server.listen(3000, () => {
  console.log('TCP 服务器已启动');
});

// WebSocket 服务器连接事件
wss.on('connection', (ws) => {
  console.log('已建立 WebSocket 连接');

  // WebSocket 通信示例
  setTimeout(() => {
    ws.send('WebSocket 检查消息');
    console.log('WebSocket 检查消息已发送');
  }, 1000);

  ws.on('message', (message) => {
    console.log(`收到 WebSocket 消息: ${message}`);
  });

  ws.on('close', () => {
    console.log('WebSocket 连接已关闭');
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
  });
});

// TCP 服务器连接事件
server.on('connection', (socket) => {
  console.log('已建立 TCP 连接');

  // TCP 通信示例
  setTimeout(() => {
    socket.write('TCP 检查消息');
    console.log('TCP 检查消息已发送');
  }, 1000);

  socket.on('data', (data) => {
    console.log(`收到 TCP 数据: ${data}`);
  });

  socket.on('end', () => {
    console.log('TCP 连接已关闭');
  });

  socket.on('error', (error) => {
    console.error('TCP 错误:', error);
  });
});

console.log('正在测试 WebSocket 和 TCP 实例间的通讯方式...');