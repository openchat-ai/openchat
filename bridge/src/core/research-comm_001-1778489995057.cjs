// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T08:59:55.057Z

// 妹妹节点文件 (sister-node.js)
const net = require('net');
const EventEmitter = require('events');

// 创建一个事件发射器
const events = new EventEmitter();

// 设置监听端口
const port = 3000;

// 创建服务器
const server = net.createServer();

// 当有连接时触发
server.on('connection', (socket) => {
  console.log('已连接到服务器');

  // 发送消息
  socket.write('Hello, Sister Node!');

  // 监听数据
  socket.on('data', (data) => {
    console.log(`收到数据: ${data}`);
    events.emit('dataReceived', data.toString());
  });

  // 监听关闭事件
  socket.on('close', () => {
    console.log('连接已关闭');
    events.emit('connectionClosed');
  });
});

// 监听服务器关闭
server.on('close', () => {
  console.log('服务器已关闭');
});

// 监听错误
server.on('error', (error) => {
  console.error(`服务器错误: ${error.message}`);
});

// 启动服务器
server.listen(port, () => {
  console.log(`服务器已启动，监听端口 ${port}`);
});

// 监听事件
events.on('dataReceived', (data) => {
  console.log(`数据接收事件触发，数据: ${data}`);
});

events.on('connectionClosed', () => {
  console.log('连接关闭事件触发');
});

// 妹妹节点监听端口
server.listen(port, () => {
  console.log(`服务器已启动，监听端口 ${port}`);
});

// 主节点文件 (main-node.js)
const net = require('net');
const EventEmitter = require('events');

// 创建一个事件发射器
const events = new EventEmitter();

// 设置监听端口
const port = 3000;

// 创建客户端
const client = new net.Socket();

// 当连接建立时触发
client.on('connect', () => {
  console.log('已连接到服务器');

  // 发送消息
  client.write('Hello, Main Node!');

  // 监听数据
  client.on('data', (data) => {
    console.log(`收到数据: ${data}`);
    events.emit('dataReceived', data.toString());
  });

  // 监听关闭事件
  client.on('close', () => {
    console.log('连接已关闭');
    events.emit('connectionClosed');
  });
});

// 监听服务器错误
client.on('error', (error) => {
  console.error(`客户端错误: ${error.message}`);
});

// 监听事件
events.on('dataReceived', (data) => {
  console.log(`数据接收事件触发，数据: ${data}`);
});

events.on('connectionClosed', () => {
  console.log('连接关闭事件触发');
});

// 连接到妹妹节点
client.connect(port, () => {
  console.log(`已连接到端口 ${port}`);
});

// 主节点监听端口
const server = net.createServer();

// 当有连接时触发
server.on('connection', (socket) => {
  console.log('已连接到服务器');

  // 发送消息
  socket.write('Hello, Main Node!');

  // 监听数据
  socket.on('data', (data) => {
    console.log(`收到数据: ${data}`);
    events.emit('dataReceived', data.toString());
  });

  // 监听关闭事件
  socket.on('close', () => {
    console.log('连接已关闭');
    events.emit('connectionClosed');
  });
});

// 监听服务器关闭
server.on('close', () => {
  console.log('服务器已关闭');
});

// 监听错误
server.on('error', (error) => {
  console.error(`服务器错误: ${error.message}`);
});

// 启动服务器
server.listen(port, () => {
  console.log(`服务器已启动，监听端口 ${port}`);
});