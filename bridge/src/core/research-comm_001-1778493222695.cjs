// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:53:42.695Z

// 引入需要的Node.js模块
const { fork } = require('child_process');

// 创建一个主进程
const master = fork('./child.js');

// 模拟3个姐妹进程
for (let i = 1; i <= 3; i++) {
  // 创建一个子进程，并与主进程通信
  const child = fork('./child.js');
  console.log(`创建了第${i}个姐妹进程`);
  
  // 监听子进程消息
  child.on('message', (msg) => {
    console.log(`姐妹进程${i}的消息:`, msg);
  });
  
  // 每隔5秒向子进程发送消息
  const intervalId = setInterval(() => {
    child.send({ type: 'heartbeat', data: `姐妹进程${i}的心跳` });
  }, 5000);
  
  // 假设姐妹进程在30秒后退出
  setTimeout(() => {
    clearInterval(intervalId);
    child.send({ type: 'quit' });
    master.on('message', (msg) => {
      if (msg.type === 'exit') {
        console.log(`姐妹进程${i}已退出`);
      }
    });
  }, 30000);
}

// 主进程监听消息
master.on('message', (msg) => {
  if (msg.type === 'heartbeat') {
    console.log('主进程接收到姐妹进程的心跳');
  } else if (msg.type === 'exit') {
    console.log('主进程接收到姐妹进程退出消息');
  }
});

// 主进程退出时，关闭所有姐妹进程
master.on('exit', (code) => {
  console.log(`主进程退出，代码: ${code}`);
  child.kill(); // 假设我们有一个child变量来存储每个姐妹进程
  // 实际上，我们需要一个更好的方式来跟踪和关闭所有姐妹进程
  // 这里只是为了演示，实际情况需要更复杂的错误处理和进程管理
});