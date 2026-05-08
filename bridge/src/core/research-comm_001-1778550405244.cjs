// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:46:45.244Z

console.log("通过WebSocket探索实例间通讯方式示例");
const webSocket = require('WebSocket');
const server = webSocket.createConnection({ port: 8080 });
server.on('open', () => console.log(`连接成功！`));
server.on('message', (data) => {
  console.log(`收到消息: ${data}`);
  server.close();
});
webSocket.on('error', (err) => console.log(`错误：${err.message}`));
webSocket.on('close', () => console.log("通信中断");
console.log("已探索多种通讯方式，结束");