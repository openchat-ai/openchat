// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:58:44.833Z

const require = require('require');
const consoleLog = console.log;

const wsServer = require('ws').createServer(require('http').Server);

const client = require('ws').connect('ws://localhost:3000');
const wsClient = client.on('connection', (socket) => {
  console.log('客户端连接已建立');
  wsClient.send('检测姐妹状态');
  wsClient.on('message', (data) => {
    console.log(`接收到：${data.toString()}`);
  });
});

wsServer.listen(3000, () => {
  console.log('服务器监听运行');
});