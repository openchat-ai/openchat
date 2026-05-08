// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:01:29.797Z

const net = require('net');

const server = net.createServer((socket) => {
  console.log("服务器启动，监听 UDP 数据包");
  socket.on('data', (data) => {
    console.log(`接收到数据: ${data.toString()}`);
    if (data === "test") {
      console.log("检测到状态：姐妹状态稳定");
    } else {
      console.log("异常数据：非测试值，需进一步检查");
    }
  });
});

server.listen(8080, () => {
  console.log("监听运行中，检查 UDP 连接是否成功");
});