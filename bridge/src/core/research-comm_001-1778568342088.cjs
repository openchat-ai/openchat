// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:45:42.088Z

// 可运行的Node.js WebSocket代码示例
const WebSocket = require('ws');

// 创建WebSocket服务器
const server = new WebSocket.Server({ port: 8080 });

// 客户端连接服务器并处理消息
const client = new WebSocket('ws://localhost:8080');

client.on('open', () => {
  console.log('✅ 连接成功，状态：', client.readyState === WebSocket.OPEN);
  console.log('请求消息：', client.send('网络状态更新'));
});

client.on('message', (data) => {
  console.log('📡 收到响应：', data.toString());
  console.log('当前状态：', data.toString());
});

client.on('close', () => {
  console.log('❌ 连接关闭，状态：', client.status === WebSocket.CLOSE);
});