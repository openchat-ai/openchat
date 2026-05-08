// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:45:58.280Z

const WebSocket = require('web-sockets');
const ws = new WebSocket('wss://example.com');

ws.onopen = () => console.log('WebSocket连接成功');
ws.onmessage = (data) => console.log('收到消息:', data);
ws.onclose = () => console.log('WebSocket断开导致消息未发送');