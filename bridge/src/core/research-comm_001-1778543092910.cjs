// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:44:52.910Z

// 引入必要的库
const net = require('net');

// 创建一个消息中间件，用于处理节点间的通讯
class NodeCommunicator {
  constructor(port, host = 'localhost') {
    this.host = host;
    this.port = port;
    this.socket = new net.Socket();
    this.socket.connect(port, host, () => {
      console.log(`NodeCommunicator established connection to ${host}:${port}`);
    });
  }

  send(message) {
    this.socket.write(message);
  }

  receive(callback) {
    this.socket.on('data', (data) => {
      callback(data.toString());
    });
  }

  close() {
    this.socket.end();
  }
}

// 创建两个NodeCommunicator实例，模拟两个节点
const nodeA = new NodeCommunicator(3000);
const nodeB = new NodeCommunicator(3001);

// 节点A发送消息到节点B
nodeA.send('Hello, NodeB!');

// 节点B接收消息并打印，然后结束连接
nodeB.receive((message) => {
  console.log(`NodeB received message from NodeA: ${message}`);
  nodeB.close();
});

// 节点A在接收到节点B的响应后结束连接
nodeA.receive((message) => {
  console.log(`NodeA received message from NodeB: ${message}`);
  nodeA.close();
});