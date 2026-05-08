// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:32:03.414Z

const WebSocket = require('web-socket');

const ws = new WebSocket('wss://example.com');

ws.on('open', () => console.log('姐妹间状态通讯成功，连接已建立'));
ws.on('message', (data) => console.log(`别人发送: ${data}`));
ws.on('error', (error) => console.log(`错误: ${error}`));