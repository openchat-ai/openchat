// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:19:15.198Z

// 姐妹状态检测 Node.js 代码示例

// 引入需要的包
const WebSocket = require('ws');

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ port: 8080 });

// 用于存储连接的客户端
let clients = new Set();

// 当有客户端连接时
wss.on('connection', (ws) => {
  // 将客户端添加到集合中
  clients.add(ws);

  // 当客户端发送消息时
  ws.on('message', (message) => {
    console.log(`收到消息: ${message}`);

    // 广播消息给所有其他客户端
    clients.forEach((client) => {
      if (client !== ws) { // 不广播给发送消息的客户端
        client.send(`收到消息: ${message}`);
      }
    });
  });

  // 当客户端断开连接时
  ws.on('close', () => {
    clients.delete(ws);
    console.log('客户端已断开连接');
  });

  // 当客户端发生错误时
  ws.on('error', (error) => {
    console.error('客户端发生错误:', error);
    clients.delete(ws);
  });
});

// 打印研究结果
console.log('姐妹状态检测研究结果:');
console.log('=======================');
console.log('通过 WebSocket 实现了实例间的通讯方式。');
console.log('当一个实例连接 WebSocket 服务器时，');
console.log('它可以接收和发送消息给其他连接的实例。');
console.log('这种方式可以实时检测姐妹实例的状态。');
console.log('=======================');
console.log('研究结束。');
console.log('=======================');