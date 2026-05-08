// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:36:37.379Z

const net = require('net');

// Node.js 实例间通讯方式研究
// 本代码示例主要研究基于TCP的本地实例通讯方式

// 服务器实例
const server = net.createServer((socket) => {
  console.log('收到连接');

  socket.on('data', (data) => {
    console.log(`接收到数据: ${data}`);
    socket.end('已收到数据！');
  });

  socket.on('end', () => {
    console.log('连接结束');
  });

  socket.on('error', (err) => {
    console.error('发生错误:', err);
  });
});

// 启动服务器，并监听端口
server.listen(3000, () => {
  console.log('服务器启动成功，监听端口3000');
});

// 客户端实例
// 模拟客户端与服务器的通讯
const client = net.createConnection({ port: 3000 }, () => {
  console.log('客户端连接服务器成功');

  // 发送数据到服务器
  client.write('这是客户端发送的数据');
});

// 错误处理
client.on('error', (err) => {
  console.error('客户端发生错误:', err);
});

// 连接结束
client.on('end', () => {
  console.log('客户端连接结束');
});