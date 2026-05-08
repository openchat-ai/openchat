// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:42:42.292Z

// file: index.js
// 主进程：启动两个“姐妹”实例并收集结果

const { fork } = require('child_process');
const path = require('path');

// 记录每种方式的状态
const status = {
  tcp: { AtoB: false, BtoA: false },
  udp: { AtoB: false, BtoA: false },
  ws:  { AtoB: false, BtoA: false },
  redis:{ AtoB: false, BtoA: false },
};

// 启动两个子进程
const sisterA = fork(path.join(__dirname, 'sister.js'), ['A']);
const sisterB = fork(path.join(__dirname, 'sister.js'), ['B']);

// 统一的消息处理
function handleMessage(source, msg) {
  // msg 格式: {type:'tcp'|'udp'|'ws'|'redis', direction:'AtoB'|'BtoA'}
  if (msg && msg.type && msg.direction) {
    status[msg.type][msg.direction] = true;
    console.log(`[${new Date().toISOString()}] ${source} => ${msg.type} ${msg.direction} OK`);
  }
}

// 监听子进程发来的心跳成功信号
sisterA.on('message', (msg) => handleMessage('A', msg));
sisterB.on('message', (msg) => handleMessage('B', msg));

// 5 秒后输出汇总报告并退出
setTimeout(() => {
  console.log('\n=== 姐妹实例连通性检测报告 ===');
  console.table(status);
  sisterA.kill();
  sisterB.kill();
  process.exit(0);
}, 5000);