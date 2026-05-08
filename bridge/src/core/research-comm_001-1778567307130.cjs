// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:28:27.130Z

// 引入需要的模块
const net = require('net');

// 定义一个函数，用于创建一个TCP客户端连接到指定的端口
function createTCPClient(port, callback) {
  const client = new net.Socket();

  client.connect(port, 'localhost', () => {
    console.log(`TCP客户端连接到端口 ${port} 成功`);
    callback(client);
  });

  client.on('error', err => {
    console.error(`TCP客户端连接到端口 ${port} 失败：${err.message}`);
    client.destroy();
  });

  client.on('close', () => {
    console.log('TCP客户端连接已关闭');
  });

  client.on('end', () => {
    console.log('TCP客户端连接已结束');
  });
}

// 定义一个函数，用于发送消息到TCP客户端并接收响应
function sendMessageToTCPClient(client, message, callback) {
  client.write(message);
  client.setEncoding('utf8');

  client.on('data', data => {
    console.log(`收到响应：${data}`);
    callback(data);
  });

  client.on('error', err => {
    console.error(`TCP客户端错误：${err.message}`);
    callback(err.message);
  });
}

// 测试代码
const testPort = 3000;

// 创建TCP客户端连接到测试端口
createTCPClient(testPort, client => {
  // 向TCP客户端发送消息
  sendMessageToTCPClient(client, 'ping\n', response => {
    console.log(`响应：${response}`);
    client.destroy();
  });
});