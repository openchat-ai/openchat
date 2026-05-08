// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:56:59.340Z

const net = require('net');
const targetPort = 12345;
const count = 0;

net.createConnection({ port: targetPort }, (socket) => {
  count++;
  console.log(`目标IP ${socket.address} 已连接 ${count} 次。`);
  if (count === 2) {
    console.log('检测到两个姐妹状态！两个进程同时运行。');
  }
});

net.on('end', () => {
  console.log(`网络连接到目标IP结束。`);
});