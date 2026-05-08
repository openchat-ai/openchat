// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:05:42.771Z

// 引入需要的模块
const net = require('net');
const EventEmitter = require('events');

// 建立一个基于TCP的简单通信协议
class MirrorServer extends EventEmitter {
  constructor(port = 8000) {
    super();
    this.port = port;
    this.server = net.createServer();
    this.server.listen(port, () => {
      console.log(`监听端口 ${port}`);
    });
  }

  connect(targetHost, targetPort) {
    this.client = net.connect(targetPort, targetHost, () => {
      console.log(`已连接到 ${targetHost}:${targetPort}`);
    });

    this.client.on('data', (data) => {
      console.log(`接收到数据: ${data}`);
      this.emit('receive', data);
    });

    this.client.on('error', (err) => {
      console.log(`连接错误: ${err}`);
    });
  }

  send(data) {
    this.client.write(data);
  }
}

// 创建服务器实例
const server = new MirrorServer();

// 监听接收事件
server.on('receive', (data) => {
  console.log(`接收到的数据: ${data}`);
});

// 检测姐妹状态
function checkMirrorStatus() {
  // 连接到姐妹节点
  server.connect('localhost', 8001);

  // 发送ping信息
  server.send('PING');
  
  // 假设5秒后没有收到响应，则认为姐妹节点不在线
  setTimeout(() => {
    if (!server.isConnected()) {
      console.log('姐妹节点不在线');
    } else {
      console.log('姐妹节点在线');
    }
  }, 5000);
}

// 开始检测
checkMirrorStatus();