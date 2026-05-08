// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:44:38.012Z

#!/usr/bin/env node

// 引入所需的模块
const net = require('net');

// 定义目标端口和消息
const port = 12345; // 假设的姐妹节点监听端口
const message = 'PING'; // 用于检测的简单消息
const timeout = 3000; // 检测超时时间（毫秒）

// 创建一个WebSocket服务器并监听连接
const server = net.createServer((socket) => {
  console.log(`客户端连接到服务器端口 ${port}`);

  // 从客户端接收消息的处理函数
  socket.on('data', (data) => {
    if (data.toString() === message) {
      console.log(`检测到有效的${message}消息，姐妹节点状态正常`);
      socket.destroy(); // 关闭连接，避免资源占用
    } else {
      console.log(`收到无效的数据：${data.toString()}`);
    }
  });

  // 处理客户端断开连接的事件
  socket.on('end', () => {
    console.log('客户端连接已断开');
  });

  // 处理错误事件
  socket.on('error', (err) => {
    console.error(`客户端发生错误：${err.message}`);
  });
});

// 监听服务器连接
server.listen(port, () => {
  console.log(`Node.js 服务器正在监听端口 ${port}`);
});

// 执行检测函数
function checkSisterNodeStatus() {
  const client = net.connect(port, () => {
    console.log('已尝试与姐妹节点建立连接');
    client.write(message); // 发送检测消息
  });

  client.setTimeout(timeout, () => {
    client.end(); // 超时后关闭连接
    console.log(`检测到超时，姐妹节点可能不在线`);
  });

  client.on('error', (err) => {
    console.error(`连接错误：${err.message}`);
    client.end();
  });
}

// 定时执行检测
setInterval(checkSisterNodeStatus, timeout);

// 程序结束时关闭服务器
process.on('SIGINT', () => {
  console.log('程序结束，关闭服务器...');
  server.destroy();
});