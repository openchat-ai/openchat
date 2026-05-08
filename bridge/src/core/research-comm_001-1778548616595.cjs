// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:16:56.595Z

// 通过Node.js创建一个简单的本地通信服务，用于探索实例间通信的不同方式

// 引入必要的模块
const { Server, createConnection } = require('socket.io');
const http = require('http');
const express = require('express');
const cors = require('cors');

// 创建HTTP服务器
const app = express();
const server = http.createServer(app);
app.use(cors());

// 创建Socket.IO服务器
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["get", "post"]
  }
});

// 监听连接
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // 监听来自客户端的ping消息
  socket.on('ping', () => {
    console.log('Received ping from:', socket.id);
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });

  // 监听来自客户端的状态更新
  socket.on('status_update', (status) => {
    console.log(`Received status update from ${socket.id}: ${status}`);
  });

  // 监听客户端断开连接
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// 监听端口
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 通过命令行运行这个服务器
// node server.js

// 为了测试这个服务，你可以在另一个终端启动以下客户端脚本：
// 1. 创建一个名为 client.js 的文件
// 2. 用以下代码填充该文件

// const socket = io('http://localhost:3000');

// socket.on('connect', () => {
//   console.log('Connected to server:', socket.id);
//   socket.emit('ping', { timestamp: new Date().toISOString() });
// });

// setInterval(() => {
//   socket.emit('status_update', `Status update at ${new Date().toISOString()}`);
// }, 5000);
// 3. 运行客户端脚本
// node client.js

// 这将启动一个客户端，它会每5秒向服务器发送一个状态更新，并响应服务器的ping请求