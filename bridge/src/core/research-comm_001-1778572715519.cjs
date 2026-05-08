// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T07:58:35.519Z

// 引入需要的模块
const net = require('net');
const WebSocket = require('ws');

// 监听端口的函数
function monitorPort(port, callback) {
  const server = net.createServer((socket) => {
    console.log(`连接已建立，端口号为：${port}`);
    socket.on('data', (data) => {
      console.log(`收到数据：${data}`);
    });
    socket.on('end', () => {
      console.log(`连接已结束，端口号为：${port}`);
    });
  });

  server.listen(port, () => {
    console.log(`监听端口 ${port}...`);
    server.on('error', (err) => {
      console.log(`端口 ${port} 错误：${err.message}`);
    });
    server.on('listening', callback);
  });
}

// 测试WebSocket连接的函数
function testWebSocket(url, callback) {
  const ws = new WebSocket(url);
  ws.onopen = () => {
    console.log('WebSocket连接已打开');
    callback();
  };
  ws.onerror = (err) => {
    console.log(`WebSocket连接出错：${err.message}`);
  };
  ws.onclose = () => {
    console.log('WebSocket连接已关闭');
    callback();
  };
}

// 主函数
function main() {
  const ports = [8080, 8081]; // 监听的端口列表
  const webSocketUrl = 'ws://localhost:8080'; // WebSocket服务器的URL

  ports.forEach((port) => {
    console.log(`正在监听端口 ${port}...`);
    monitorPort(port, () => {
      console.log(`端口 ${port} 监听成功`);
    });
  });

  console.log(`正在测试WebSocket连接到 ${webSocketUrl}...`);
  testWebSocket(webSocketUrl, () => {
    console.log('WebSocket连接测试完成');
  });
}

// 执行主函数
main();