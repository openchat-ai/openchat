// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:08:38.059Z

// 引入必要的模块
const cluster = require('cluster');
const os = require('os');

// 定义全局变量，用于在 worker 进程间共享数据
let sharedData = {
  workers: [],
  isAlive: {}
};

// 初始化共享数据
sharedData.workers = [];

// 设置全局变量，用于在 worker 进程中触发心跳
const triggerHeartbeat = () => {
  const workerId = `worker-${process.pid}`;
  sharedData.isAlive[workerId] = {
    timestamp: Date.now(),
    alive: true
  };
  console.log(`Worker ${workerId} sent heartbeat at ${new Date().toISOString()}`);
};

// 创建心跳间隔
const heartbeatInterval = setInterval(triggerHeartbeat, 5000);

// 检测是否还在运行
const isRunning = () => {
  const workerId = `worker-${process.pid}`;
  const now = Date.now();
  const age = now - sharedData.isAlive[workerId].timestamp;
  const isDead = age > 10000; // 如果超过10秒没有心跳，则认为死亡

  if (isDead) {
    console.log(`Worker ${workerId} is DEAD at ${new Date().toISOString()}`);
    process.exit(1); // 终止进程
  } else {
    console.log(`Worker ${workerId} is ALIVE at ${new Date().toISOString()}`);
  }
};

// 检测是否还有其他 worker 运行
const checkOtherWorkers = () => {
  const workerId = `worker-${process.pid}`;
  if (cluster.isMaster) {
    sharedData.workers.forEach(worker => {
      if (worker !== workerId) {
        const workerStatus = sharedData.isAlive[worker] ? 'ALIVE' : 'DEAD';
        console.log(`Other worker ${worker} is ${workerStatus}`);
      }
    });
  } else {
    console.log(`This worker ${workerId} is ${sharedData.isAlive[workerId] ? 'ALIVE' : 'DEAD'}`);
  }
};

// 监听节点进程
if (cluster.isMaster) {
  // 获取 CPU 核心数量
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    sharedData.workers.push(`worker-${cluster.id}-${i + 1}`);
    cluster.fork(); // 创建 worker 进程
  }

  // 监听 worker 进程退出
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    sharedData.workers = sharedData.workers.filter(id => id !== `worker-${cluster.id}-${worker.process.pid}`);
  });

  // 每 5 秒检测一次
  setInterval(checkOtherWorkers, 5000);

} else {
  // 创建一个临时的共享数据对象，用于worker进程
  const workerSharedData = {
    isAlive: {}
  };
  workerSharedData.isAlive[`worker-${process.pid}`] = {
    timestamp: Date.now(),
    alive: true
  };
  sharedData = workerSharedData;

  // 监听退出事件
  process.on('SIGINT', () => {
    console.log(`Worker ${process.pid} is exiting`);
    process.exit(0);
  });

  // 监听 worker 进程退出
  process.on('exit', () => {
    console.log(`Worker ${process.pid} exited`);
    sharedData = sharedData.workers ? sharedData : null;
  });

  // 每隔5秒检测一次
  setInterval(isRunning, 5000);
}