// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:36:03.601Z

// 引入需要的模块
const net = require('net');
const EventEmitter = require('events');

// 创建一个EventEmitter实例，用于处理通信事件
class CommunicationManager extends EventEmitter {
  constructor() {
    super();
  }

  // 创建一个客户端连接
  createClientConnection(port, host = 'localhost', callback) {
    const client = new net.Socket();
    client.connect(port, host, () => {
      console.log(`客户端连接到 ${host}:${port}`);
      callback(client);
    });
  }

  // 发送消息到客户端
  sendMessage(client, message) {
    client.write(message);
    console.log(`发送消息: ${message}`);
  }

  // 从客户端接收消息
  receiveMessage(client) {
    client.on('data', (data) => {
      console.log(`收到消息: ${data}`);
      this.emit('messageReceived', data);
    });
  }
}

// 创建通信管理器实例
const communicationManager = new CommunicationManager();

// 模拟一个检测状态的函数
function checkStatusMethod1() {
  console.log('开始使用 WebSocket 检测状态...');
  const ws = new WebSocket('ws://localhost:8080');
  ws.onmessage = (event) => {
    console.log(`状态信息: ${event.data}`);
    ws.close();
  };
}

// 模拟一个检测状态的函数
function checkStatusMethod2() {
  console.log('开始使用 TCP 监听检测状态...');
  const server = net.createServer((client) => {
    console.log('有客户端连接');
    client.on('data', (data) => {
      console.log(`收到数据: ${data}`);
      client.destroy(); // 关闭连接
    });
    client.on('end', () => {
      console.log('客户端断开连接');
    });
  });
  server.listen(8081);
  console.log('TCP 服务器监听在端口 8081 上');
}

// 检测状态的函数
function checkStatus() {
  console.log('开始检测状态...');
  setTimeout(() => {
    console.log('状态检测完成');
  }, 5000);
}

// 运行检测状态的函数
checkStatus();

// 模拟一个检测状态的函数
function checkStatusMethod3() {
  console.log('开始使用 MQTT 检测状态...');
  const client = mqtt.connect('mqtt://broker.hivemq.com');
  client.on('connect', () => {
    console.log('MQTT 客户端连接成功');
    client.publish('status/check', 'hello', { qos: 0, retain: false });
    client.subscribe('status/result');
  });

  client.on('message', (topic, message) => {
    console.log(`收到 MQTT 消息: ${message.toString()}`);
    client.end();
  });
}

// 主函数
function main() {
  // 检测状态的方法 1: HTTP ping
  console.log('检测状态的方法 1: HTTP ping');
  const http = require('http');
  const pingServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong\n');
  });
  pingServer.listen(8080);
  console.log('HTTP ping 服务器监听在端口 8080 上');

  // 检测状态的方法 2: TCP 监听
  console.log('检测状态的方法 2: TCP 监听');
  const server = net.createServer((socket) => {
    console.log('TCP 服务器接收到来自客户端的连接');
    socket.write('欢迎连接\n');
    socket.on('end', () => {
      console.log('TCP 服务器接收到来自客户端的结束信号');
    });
  });
  server.listen(8082);
  console.log('TCP 服务器监听在端口 8082 上');

  // 检测状态的方法 3: WebSocket 检测
  console.log('检测状态的方法 3: WebSocket 检测');
  const WebSocketServer = require('ws').Server;
  const wss = new WebSocketServer({ port: 8083 });
  wss.on('connection', (ws) => {
    console.log('WebSocket 服务器接收到来自客户端的连接');
    ws.send('欢迎连接\n');
    ws.on('message', (message) => {
      console.log(`WebSocket 服务器接收到来自客户端的消息: ${message}`);
      ws.send('消息已接收\n');
    });
  });
  console.log('WebSocket 服务器监听在端口 8083 上');

  // 检测状态的方法 4: MQTT 检测
  console.log('检测状态的方法 4: MQTT 检测');
  const mqtt = require('mqtt');
  const client = mqtt.connect('mqtt://broker.hivemq.com');
  client.on('connect', () => {
    console.log('MQTT 客户端连接成功');
    client.publish('status/check', 'hello', { qos: 0, retain: false });
    client.subscribe('status/result');
  });

  client.on('message', (topic, message) => {
    console.log(`收到 MQTT 消息: ${message.toString()}`);
    client.end();
  });
}

// 执行主函数
main();