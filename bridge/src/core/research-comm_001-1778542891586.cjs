// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:41:31.586Z

// 服务端（Node.js）
const WebSocket = require('web-socket');
const util = require('util');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', async (ws) => {
  console.log('连接建立！', util.timestamp());
  ws.on('message', msg => {
    const response = {
      sharedState: '合并状态',
      updatedState: util.timestamp() 
    };
    ws.send(JSON.stringify(response));
  });
});