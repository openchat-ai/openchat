// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:08:08.507Z

// 引入必要的Node.js核心模块
const net = require('net');
const { v4: uuidv4 } = require('uuid');

// 定义一个简单的实例通信类
class InstanceCommunicator {
  constructor(port = 3000) {
    this.port = port;
    this.instanceId = uuidv4(); // 生成一个唯一的实例ID
  }

  // 检测与另一实例的连接
  async pingAnotherInstance(targetPort = this.port) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let connected = false;

      socket.on('connect', () => {
        connected = true;
        console.log(`与端口${targetPort}的实例建立了连接`);
      });

      socket.on('data', (data) => {
        if (connected) {
          console.log(`收到数据: ${data.toString()}`);
          socket.destroy(); // 关闭连接
          resolve(`与端口${targetPort}的实例通信成功`);
        }
      });

      socket.on('error', (error) => {
        console.error(`与端口${targetPort}的实例通信失败: ${error.message}`);
        reject(error);
      });

      socket.on('end', () => {
        console.log(`与端口${targetPort}的实例通信结束`);
      });

      socket.connect(targetPort, 'localhost', () => {
        if (connected) {
          console.log(`向端口${targetPort}的实例发送数据: ${this.instanceId}`);
          socket.write(this.instanceId);
        }
      });
    });
  }
}

// 使用示例
const communicator = new InstanceCommunicator();

// 启动两个实例（假设它们是姐妹实例）
const instance1 = new InstanceCommunicator();
instance1.listen(3000);

const instance2 = new InstanceCommunicator();
instance2.listen(3001);

// 检测实例1与实例2之间的通信
instance1.pingAnotherInstance(3001)
  .then(message => console.log(message))
  .catch(error => console.error(error));

// 检测实例2与实例1之间的通信
instance2.pingAnotherInstance(3000)
  .then(message => console.log(message))
  .catch(error => console.error(error));