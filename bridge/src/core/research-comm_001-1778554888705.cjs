// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:01:28.706Z

// 引入必要的模块
const WebSocket = require('ws');

// 创建一个WebSocket服务器
const wss = new WebSocket.Server({ port: 8080 });

// 用于存储连接的WebSocket实例
const connectedClients = new Set();

// WebSocket服务器的连接处理函数
wss.on('connection', (ws) => {
  // 将新连接的WebSocket实例添加到集合中
  connectedClients.add(ws);
  console.log('Client connected');

  // 定期发送心跳消息来检测状态
  const pingInterval = setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping', data: 'heartbeat' }));
  }, 5000);

  // 当WebSocket连接关闭时移除实例
  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log('Client disconnected');
    clearInterval(pingInterval);
  });
});

// WebSocket服务器的消息处理函数
wss.on('message', (message) => {
  // 尝试解析接收到的消息
  try {
    const msg = JSON.parse(message);
    if (msg.type === 'ping') {
      // 检测到心跳消息，表示客户端仍然在线
      const client = Array.from(connectedClients).find(c => c.readyState === WebSocket.OPEN);
      if (client) {
        console.log('Client is still alive');
      } else {
        console.log('Client is offline');
      }
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

console.log('WebSocket server is running on ws://localhost:8080');