// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:19:14.112Z

// 实例间通讯方式研究 Node.js 示例
// 使用 WebSocket 进行实例间通讯

// 引入 WebSocket 库
const WebSocket = require('ws');

// 创建 WebSocket 服务器
const server = new WebSocket.Server({ port: 8080 });

// WebSocket 服务器连接事件
server.on('connection', (ws) => {
  console.log('新客户端连接');

  // 发送测试消息
  ws.send(JSON.stringify({
    type: 'ping',
    message: 'WebSocket ping 检测'
  }));

  // 客户端消息事件
  ws.on('message', (message) => {
    console.log('接收到消息:', message);
  });

  // 客户端关闭事件
  ws.on('close', () => {
    console.log('客户端已关闭');
  });

  // 客户端错误事件
  ws.on('error', (error) => {
    console.error('客户端错误:', error);
  });
});

console.log('WebSocket 服务器已启动，监听端口 8080');

// 创建 WebSocket 客户端测试代码
// 此代码需要另外在一个实例中执行（即另一个终端）

// 引入 WebSocket 库
// const WebSocket = require('ws');

// 创建 WebSocket 客户端
// const client = new WebSocket('ws://localhost:8080');

// 客户端连接事件
// client.on('open', () => {
//   console.log('已连接到 WebSocket 服务器');
// });

// 客户端消息事件
// client.on('message', (message) => {
//   console.log('从服务器收到消息:', message);
// });

// 客户端关闭事件
// client.on('close', () => {
//   console.log('已关闭 WebSocket 连接');
// });

// 客户端错误事件
// client.on('error', (error) => {
//   console.error('WebSocket 客户端错误:', error);
// });

// 发送测试消息
// client.send(JSON.stringify({
//   type: 'ping',
//   message: 'WebSocket ping 检测'
// }));