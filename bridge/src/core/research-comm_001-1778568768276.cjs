// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:52:48.276Z

// 引入必要的模块
const net = require('net');

// 设置监听的端口和地址
const port = 12345;
const address = 'localhost';

// 创建一个TCP服务器
const server = net.createServer((socket) => {
  console.log(`客户端已连接: ${socket.remoteAddress}:${socket.remotePort}`);

  // 发送心跳包，用于检测连接状态
  setInterval(() => {
    socket.write('pong');
    console.log('心跳包已发送');
  }, 5000); // 每5秒发送一次心跳包

  // 监听数据接收事件
  socket.on('data', (data) => {
    console.log(`接收到数据: ${data}`);
  });

  // 监听结束事件
  socket.on('end', () => {
    console.log(`客户端已断开: ${socket.remoteAddress}:${socket.remotePort}`);
  });

  // 监听错误事件
  socket.on('error', (err) => {
    console.error(`客户端错误: ${err}`);
  });
});

// 监听服务器端口
server.listen(port, address, () => {
  console.log(`服务器已启动，监听端口: ${port}`);
});

// 停止服务器的函数
function stopServer() {
  console.log('停止服务器');
  server.close(() => {
    console.log('服务器已关闭');
  });
}

// 模拟客户端连接
const client = net.connect(port, address, () => {
  console.log('客户端已连接');
});

// 模拟客户端断开
setTimeout(() => {
  client.destroy();
  console.log('客户端已断开');
}, 10000);

// 模拟服务器停止
setTimeout(stopServer, 20000);