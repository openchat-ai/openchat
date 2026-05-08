// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:50:07.959Z

// 引入必要的模块
const WebSocket = require('ws');

// 创建一个 WebSocket 服务器
const wss = new WebSocket.Server({ port: 8080 });

// 存储当前连接的 WebSocket 连接
const connections = new Map();

wss.on('connection', (ws) => {
  // 当有新的 WebSocket 连接时，将其添加到 connections 中
  connections.set(ws.id, ws);

  console.log(`New WebSocket connection from ${ws.remoteAddress}`);

  // 接收来自客户端的消息
  ws.on('message', (message) => {
    console.log(`Received message from ${ws.remoteAddress}: ${message}`);

    // 将收到的消息转发给其他所有客户端
    connections.forEach((conn, id) => {
      if (id !== ws.id) {
        console.log(`Sending message to ${conn.remoteAddress}: ${message}`);
        conn.send(message);
      }
    });
  });

  // 当连接关闭时，从 connections 中移除该连接
  ws.on('close', () => {
    console.log(`Connection from ${ws.remoteAddress} closed`);

    connections.delete(ws.id);
  });

  // 当连接发生错误时，从 connections 中移除该连接
  ws.on('error', (err) => {
    console.log(`Error on connection from ${ws.remoteAddress}: ${err.message}`);

    connections.delete(ws.id);
  });
});

// 检查所有连接是否都已关闭
const isAllConnectionsClosed = () => {
  for (const [id, conn] of connections.entries()) {
    if (conn.readyState === WebSocket.OPEN) {
      console.log(`Connection ${id} is still open`);
      return false;
    }
  }
  console.log('All connections are closed');
  return true;
};

// 定期检查所有连接的状态
const checkConnections = () => {
  isAllConnectionsClosed();
  setTimeout(checkConnections, 1000);
};

// 开始定期检查连接
checkConnections();

console.log('WebSocket server is running on ws://localhost:8080');