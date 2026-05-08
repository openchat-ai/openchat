// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:16:27.070Z

// 研究实例间通讯方式，探索除HTTP ping之外的妽途
// 1. 通过消息队列检测状态
// 2. 利用 WebSocket 实现实时通信
// 3. 通过共享文件或数据库实现状态同步

const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

// 创建HTTP服务器
const server = http.createServer((req, res) => {
  res.end('欢迎访问!');
});

// 创建WebSocket服务器实例
const wss = new WebSocket.Server({ server });

// 存储各个实例状态的数据
const instancesState = {};

wss.on('connection', (ws) => {
  console.log('新连接建立');

  // 示例：监听初始状态，输出在客户端接收到的信息
  ws.on('message', (message) => {
    console.log('收到消息:', message);
    // 假设接收到的信息是状态更新
    const state = JSON.parse(message);
    instancesState[state.id] = state.status;
  });

  // 监听状态更新，更新状态并广播
  ws.on('data', (data) => {
    const updatedState = JSON.parse(data);
    if (updatedState.id !== instancesState[state.id]) {
      console.log('状态更新:', updatedState);
      Object.keys(instancesState).forEach(key => {
        if (JSON.stringify(instancesState[key]) !== JSON.stringify(updatedState)) {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(updatedState));
            }
          });
        }
      });
    }
  });
});

server.listen(8080, () => {
  console.log('服务器正在监听端口8080');
});

// 示例用法：模拟状态更新
setTimeout(() => {
  const ws = new WebSocket('ws://localhost:8080');
  ws.send(JSON.stringify({ id: 'A1', status: '更新中' }));
}, 5000);