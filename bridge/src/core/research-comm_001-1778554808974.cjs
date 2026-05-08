// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:00:08.974Z

// 模拟服务器A（主服务器）
const ServerA = ({ port }) => {
  const server = new WebSocket.Server({ port: port });
  server.on('connection', (socket) => {
    console.log(`服务器A连接到客户端 ${socket.clientId}`);
    socket.on('message', (data) => {
      console.log(`服务器A收到：${data}`);
      // 模拟响应
      const response = { status: 'success', message: '状态同步完成' };
      console.log(`服务器A响应：${JSON.stringify(response)}`);
      socket.send(JSON.stringify(response));
    });
  });
  return server;
};

// 模拟服务器B（客户端）
const ServerB = () => {
  const clientId = 'client_1';
  const socket = new WebSocket('ws://localhost:8080');

  socket.onopen = () => {
    console.log(`客户端连接到 ServerA ${serverA.url}`);
  };

  socket.onmessage = (event) => {
    console.log(`接收到：${event.data}`);
    // 示例：检查是否同步
    if (event.data.includes('状态同步')) {
      console.log('同步验证通过!');
    }
  };
};

// 运行示例
const serverA = ServerA(8080);
const serverB = ServerA(8080); // 重复等待/重启服务器
ServerB(); // 启动客户端服务