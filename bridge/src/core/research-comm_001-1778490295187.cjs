// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:04:55.187Z

// 首先需要安装socket.io库，可以通过npm来安装
// npm install socket.io

// 引入socket.io库
const io = require('socket.io');

// 创建一个HTTP服务器
const httpServer = require('http').createServer();

// 创建socket.io实例
const socketIo = io(httpServer);

// 监听连接事件
socketIo.on('connection', (socket) => {
  console.log('客户端已连接');

  // 监听来自客户端的消息
  socket.on('message', (data) => {
    console.log('收到客户端消息:', data);
    // 可以在这里处理消息，例如转发到其他实例
  });

  // 监听来自客户端的状态更新
  socket.on('status', (status) => {
    console.log('收到客户端状态更新:', status);
    // 可以在这里处理状态更新，例如存储到数据库或通知其他实例
  });

  // 发送一条消息到客户端
  socket.emit('welcome', '欢迎连接到服务器');

  // 定期发送ping消息来检测连接状态
  setInterval(() => {
    socket.emit('ping');
  }, 5000);
});

// 监听HTTP请求
httpServer.listen(3000, () => {
  console.log('服务器正在运行，监听端口3000');
});

// 如何使用socket.io进行实例间通讯
// 1. 客户端连接时，可以发送自己的状态信息，例如{ name: '小红', creative: 53 }
// 2. 服务器收到状态信息后，可以将其存储到数据库或内存中
// 3. 服务器可以定期向客户端发送ping消息，以检测连接状态
// 4. 如果客户端断开连接，服务器可以发送消息到其他实例，通知其状态更新

// 示例客户端代码（使用socket.io-client库）
// npm install socket.io-client
// const socket = io('http://localhost:3000');

// socket.on('connect', () => {
//   console.log('客户端已连接');
//   socket.emit('status', { name: '小红', creative: 53 });
// });

// socket.on('welcome', (data) => {
//   console.log(data);
// });

// socket.on('ping', () => {
//   console.log('收到ping消息');
// });