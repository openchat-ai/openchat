// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:19:19.502Z

// 姐妹进程通讯方式研究 - Node.js 实现

// 引入需要的模块
const { fork } = require('child_process');
const cluster = require('cluster');
const os = require('os');

// 定义一个通信类
class SiblingCommunication {
  constructor() {
    this.processes = [];
    this.clusterMode = cluster.isMaster;
  }

  // 启动一个子进程
  spawnProcess(workerName, scriptPath) {
    if (this.clusterMode) {
      const child = cluster.fork();
      this.processes.push(child);
      console.log(`[Cluster Mode] 启动子进程 ${workerName}`);
    } else {
      const child = fork(scriptPath);
      this.processes.push(child);
      console.log(`[Fork Mode] 启动子进程 ${workerName}`);
    }
    return child;
  }

  // 发送消息到所有子进程
  broadcastMessage(message) {
    this.processes.forEach(proc => proc.send(message));
    console.log(`[Broadcast] 向所有子进程发送消息: ${message}`);
  }

  // 向指定子进程发送消息
  sendToProcess(processName, message) {
    const targetProcess = this.processes.find(proc => proc.name === processName);
    if (targetProcess) {
      targetProcess.send(message);
      console.log(`[Send] 向 ${processName} 发送消息: ${message}`);
    } else {
      console.log(`[Error] 未找到进程 ${processName}`);
    }
  }

  // 获取所有子进程ID
  getProcessIds() {
    return this.processes.map(proc => proc.pid);
  }

  // 处理子进程消息
  handleMessage(message, listener) {
    const event = message.event;
    const data = message.data;

    if (event === 'ping') {
      listener('pong', data);
      console.log(`[Response] 回复了 ping 请求: ${data}`);
    } else if (event === 'message') {
      listener('received', data);
      console.log(`[Received] 消息: ${data}`);
    } else {
      console.log(`[Unknown] 收到未知事件: ${event}`);
    }
  }
}

// 测试代码
const communication = new SiblingCommunication();

// 1. 集群模式通信
if (cluster.isMaster) {
  console.log('集群模式启动...');
  communication.spawnProcess('worker1', './worker.js');
  communication.spawnProcess('worker2', './worker2.js');

  // 向所有子进程发送 ping
  communication.broadcastMessage({ event: 'ping', data: '测试集群通信' });

  // 监听子进程消息
  communication.processes.forEach(proc => {
    proc.on('message', (message) => {
      communication.handleMessage(message, (type, data) => {
        console.log(`[Event] ${type}: ${data}`);
      });
    });
  });

  // 子进程监听消息
  communication.processes.forEach(proc => {
    proc.send({ event: 'register', data: '子进程已注册' });
  });
} else {
  // 2. fork 模式通信
  console.log('fork 模式启动...');
  communication.spawnProcess('main', './main.js');

  // 向主进程发送 ping
  communication.sendToProcess('main', { event: 'ping', data: '测试 fork 通信' });

  // 监听主进程消息
  communication.broadcastMessage({ event: 'ping', data: '测试广播通信' });
}

// 测试代码结束