// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:13:16.160Z

// 使用WebSocket实现同步通信，提示不同通配符
const WebSocket = require('web-socket');

const client1 = new WebSocket('ws://localhost:8080/sync');
const client2 = new WebSocket('ws://localhost:8081/sync');

// 客户端1发送状态确认
client1.on('open', () => console.log('客户端1连接成功'));
client1.on('message', message => {
  console.log('客户端1收到：', message.toString());
  client2.send('确认状态：在线');
});

// 客户端2响应与状态验证
client2.on('open', () => console.log('客户端2连接成功'));
client2.on('message', message => {
  console.log('客户端2响应：', message.toString());
  if (message === '确认状态：在线') {
    console.log('状态同步，两方同步确认！');
  } else {
    console.log('状态不同，需手动协调');
  }
});