// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:43:17.672Z

// 妹妹状态检测器
// 使用 Node.js 的 WebSocket 实现实例间通讯

// 引入 WebSocket 模块
const WebSocket = require('ws');

// 创建 WebSocket 服务器
const server = new WebSocket.Server({ port: 8080 });

// 存储所有连接的 WebSocket 连接
const connections = new Set();

server.on('connection', (ws) => {
  // 当有新的连接时，将其添加到 connections 集合中
  connections.add(ws);

  // 定义消息处理函数
  ws.on('message', (message) => {
    // 接收消息并输出日志
    console.log('收到消息:', message);

    // 如果消息是 "ping"，则回复 "pong"
    if (message === 'ping') {
      ws.send('pong');
    }
  });

  // 定义连接关闭处理函数
  ws.on('close', () => {
    // 当连接关闭时，从 connections 集合中移除该连接
    connections.delete(ws);
    console.log('连接已关闭');
  });

  // 定义错误处理函数
  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error);
  });
});

// 检查所有连接的 WebSocket 连接
function checkConnections() {
  console.log('当前连接的 WebSocket 连接:', Array.from(connections).length);
}

// 每隔 5 秒检查一次连接
setInterval(checkConnections, 5000);

// 启动 WebSocket 服务器
console.log('WebSocket 服务器已启动，端口: 8080');

// 为了测试，可以使用 WebSocket 客户端发送消息到服务器
// 例如: wscat -c ws://localhost:8080
// 发送消息 "ping" 到服务器，应该会收到 "pong" 回复