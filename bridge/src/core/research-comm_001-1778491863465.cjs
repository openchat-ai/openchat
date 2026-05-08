// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:31:03.465Z

// 引入必要的Node.js模块
const net = require('net'); // 引入net模块以使用socket通信

// 服务端代码
function server(port) {
  const server = net.createServer(socket => {
    console.log(`连接成功，端口号为: ${port}`);
    socket.write('欢迎连接！');
    socket.on('data', data => {
      console.log(`收到数据：${data}`);
      socket.write(`已收到你的信息：${data}`);
    });
    socket.on('end', () => {
      console.log(`连接结束`);
    });
  });

  console.log(`启动服务器，监听端口：${port}`);
  server.listen(port);
}

// 客户端代码
function client(port, message) {
  const socket = new net.Socket();
  socket.connect(port, () => {
    console.log('连接到服务器');
    socket.write(message);
    socket.on('data', data => {
      console.log(`服务器回复：${data}`);
      socket.destroy(); // 断开连接
      console.log('连接已断开');
    });
  });
}

// 测试服务器
const serverPort = 3000;
server(serverPort);

// 测试客户端，分别使用不同的方式与服务器通信
console.log('开始测试不同的实例间通讯方式：');
setTimeout(() => {
  console.log('1. 使用net模块的Socket进行TCP通讯：');
  client(serverPort, 'Hello Server, How are you?');
}, 5000);

setTimeout(() => {
  console.log('2. 使用HTTP请求进行通讯（由于Node.js没有内置HTTP模块，可以使用第三方模块如http模块）：');
  // 这里需要安装http模块，通过npm install http
  const http = require('http');
  http.get(`http://localhost:${serverPort}/`, response => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => console.log(`HTTP响应：${data}`));
  }).on('error', err => console.error(`HTTP请求出错：${err.message}`));
}, 10000);

setTimeout(() => {
  console.log('3. 使用共享内存（Shared Memory）进行通讯：');
  // Node.js没有内置共享内存模块，可以使用第三方模块如memstore
  // 这里需要安装memstore模块，通过npm install memstore
  const Memstore = require('memstore');
  const sharedMemory = new Memstore();
  process.on('exit', () => {
    sharedMemory.write('Goodbye!', err => {
      if (err) throw err;
      console.log('共享内存已销毁');
    });
  });
  console.log('共享内存已创建，等待销毁...');
}, 15000);

setTimeout(() => {
  console.log('4. 使用Redis进行通讯（由于Node.js没有内置Redis模块，可以使用第三方模块如redis）：');
  // 这里需要安装redis模块，通过npm install redis
  const redis = require('redis');
  const redisClient = redis.createClient();
  redisClient.on('error', err => console.error(`Redis连接出错：${err.message}`));
  redisClient.on('connect', () => {
    console.log('Redis连接成功');
    redisClient.set('message', 'Hello Redis, How are you?', err => {
      if (err) throw err;
      redisClient.get('message', (err, reply) => {
        if (err) throw err;
        console.log(`Redis回复：${reply}`);
        redisClient.quit();
      });
    });
  });
}, 20000);

setTimeout(() => {
  console.log('5. 使用WebSocket进行通讯（由于Node.js没有内置WebSocket模块，可以使用第三方模块如ws）：');
  // 这里需要安装ws模块，通过npm install ws
  const WebSocket = require('ws');
  const ws = new WebSocket(`ws://localhost:${serverPort}`);
  ws.on('open', () => {
    console.log('WebSocket连接成功');
    ws.send('Hello WebSocket, How are you?');
    ws.on('message', message => {
      console.log(`WebSocket回复：${message}`);
      ws.close();
    });
  });
}, 25000);

setTimeout(() => {
  console.log('所有测试完成！');
}, 30000);