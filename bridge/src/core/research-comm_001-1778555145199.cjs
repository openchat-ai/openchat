// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:05:45.199Z

const { EventEmitter } = require('events');

// 创建一个名为 'sisterStatus' 的全局事件发射器
const sisterStatus = new EventEmitter();

// 假设我们有两个 '姐妹' 实例，这里用两个不同的模块代表
// 实例1：监听 'heartbeat' 事件，用于检测心跳状态
const instance1 = require('./instance1');
// 实例2：监听 'heartbeat' 事件，并定期发送 heartbeat 事件

// 实例2 发送心跳事件
setInterval(() => {
  sisterStatus.emit('heartbeat');
  console.log('instance2: heartbeat sent');
}, 1000);

// 实例1 监听心跳事件，模拟检测姐妹状态
instance1.on('heartbeat', () => {
  console.log('instance1: sister is online, heartbeat received');
});

// 启动实例1
require('./instance1');

// 为了测试，我们可以添加一个函数来检测所有姐妹实例是否都正常工作
function checkAllInstances() {
  const instances = [instance1];
  
  for (const instance of instances) {
    if (!instance.isAlive) {
      console.error(`instance is not alive: ${instance.name}`);
      return false;
    }
  }
  
  console.log('All instances are alive and communicating properly');
  return true;
}

// Periodically check all instances
setInterval(checkAllInstances, 5000);

// Helper function to simulate instance
function createInstance(name, isAlive) {
  return {
    name,
    isAlive,
    on(event, listener) {
      sisterStatus.on(event, listener);
    }
  };
}

// Example instance with isAlive property
const instance1 = createInstance('instance1', true);

// Start the Node.js application
if (require.main === module) {
  console.log('Node.js application started. Listening for sister status...');
}