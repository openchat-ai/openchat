// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:25:08.034Z

// 引入必要的Node.js模块
const net = require('net');
const { v4: uuidv4 } = require('uuid');

// 定义一个简单的状态检测类
class StatusChecker {
  constructor(port = 3000) {
    this.port = port;
    this.socket = null;
  }

  // 连接服务器
  connect() {
    this.socket = new net.Socket();
    this.socket.connect(this.port, 'localhost', () => {
      console.log(`连接到服务器端口 ${this.port} 成功`);
      this.sendStatus();
    });

    this.socket.on('error', (err) => {
      console.error(`连接错误: ${err.message}`);
    });

    this.socket.on('end', () => {
      console.log('连接已断开');
      this.socket.destroy();
    });
  }

  // 发送状态
  sendStatus() {
    const status = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      status: 'online'
    };

    this.socket.write(JSON.stringify(status));
    console.log(`发送状态: ${JSON.stringify(status)}`);
  }

  // 接收状态
  receiveStatus() {
    this.socket.on('data', (data) => {
      const receivedStatus = JSON.parse(data.toString());
      console.log(`收到状态: ${JSON.stringify(receivedStatus)}`);
    });
  }
}

// 实例1
const checker1 = new StatusChecker();
checker1.connect();

// 实例2
const checker2 = new StatusChecker(3001);
checker2.connect();

// 模拟实例1断开连接
setTimeout(() => {
  checker1.socket.destroy();
  console.log('实例1已断开连接');
}, 30000);

// 模拟实例2发送状态
setTimeout(() => {
  const status = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    status: 'offline'
  };

  checker2.socket.write(JSON.stringify(status));
  console.log(`实例2发送状态: ${JSON.stringify(status)}`);
}, 10000);

// 模拟实例1接收状态
setTimeout(() => {
  const status = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    status: 'offline'
  };

  checker1.socket.write(JSON.stringify(status));
  console.log(`实例1发送状态: ${JSON.stringify(status)}`);
}, 20000);