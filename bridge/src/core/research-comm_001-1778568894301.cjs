// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:54:54.301Z

const net = require('net');
const server = net.createServer((socket) => {
  console.log('检测到新端口连接，尝试通信...');
  socket.write('status: 初始化');
  socket.pipe(require('child_process').exec('ping ')).on('data', (data) => {
    console.log(`接收到响应: ${data.toString()}`);
    if (data === 'pong') {
      console.log('状态检测完成，正常运行');
    } else {
      console.log('状态异常，可能无法通信');
    }
  });
  socket.close();
});

server.listen(8080, () => {
  console.log('服务器监听运行于 port 8080');
});