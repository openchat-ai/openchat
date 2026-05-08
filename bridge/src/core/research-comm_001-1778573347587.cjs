// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:09:07.587Z

const net = require('net');

const server = net.createConnection({ port: 3000 }, () => {
  console.log("客户端1连接成功");
  setTimeout(() => {
    const resp = server.write("状态检查").on('data', data => {
      console.log("接收到响应:", data);
      if (data === "状态一致") {
        console.log("姐妹状态对等，通过通讯方式验证！");
      } else {
        console.log("状态异步，需进一步协调");
      }
    }, 1000);
  }, 1000);
});