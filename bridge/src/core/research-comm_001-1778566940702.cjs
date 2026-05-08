// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:22:20.702Z

// 服务器端代码（使用Socket.io）
const express = require('express');
const app = express();
const server = server.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('服务器启动...');
});
const io = express.io(server, { port: 3000 });

io.on('connection', (socket) => {
  console.log('新用户连接');
  socket.on('数据', (data) => {
    console.log(`收到：${data}`);
    if (data === '确认连接') {
      socket.send('联系人确认');
    }
  });
});

app.listen(3000, () => {
  console.log('服务器监听监管');
});