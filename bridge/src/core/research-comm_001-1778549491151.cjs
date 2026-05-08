// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:31:31.151Z

// 引入需要的模块
const { fork } = require('child_process');
const EventEmitter = require('events');

// 创建一个事件发射器，用于实例间通信
const eventEmitter = new EventEmitter();

// 创建两个子进程，模拟姐妹进程
const child1 = fork('./childScript.js');
const child2 = fork('./childScript.js');

// 给子进程1注册一个事件监听，当它发送消息时，会触发事件
child1.on('message', (message) => {
  console.log('Child 1 received message:', message);
  // 触发事件，表示子进程1已发送消息
  eventEmitter.emit('child1-sent-message');
});

// 给子进程2注册一个事件监听，当它发送消息时，会触发事件
child2.on('message', (message) => {
  console.log('Child 2 received message:', message);
  // 触发事件，表示子进程2已发送消息
  eventEmitter.emit('child2-sent-message');
});

// 监听事件发射器的事件，表示姐妹进程已发送消息
eventEmitter.on('child1-sent-message', () => {
  console.log('Child 1 sent a message to check sister status.');
});

eventEmitter.on('child2-sent-message', () => {
  console.log('Child 2 sent a message to check sister status.');
});

// 向子进程1发送消息，模拟检测行为
child1.send('Check sister status');

// 向子进程2发送消息，模拟检测行为
child2.send('Check sister status');

// 给子进程1发送一个退出信号
child1.disconnect();

// 给子进程2发送一个退出信号
child2.disconnect();

// 输出研究结果
console.log('Research Result:');
console.log('除了HTTP ping，还可以使用实例间通信的方式，例如通过Node.js的子进程通信（child_process）和事件发射器（EventEmitter）来检测姐妹状态。');