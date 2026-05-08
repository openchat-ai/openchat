// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:00:54.989Z

// 研究：实例间通讯方式（除 HTTP ping 之外）检测姐妹状态// 运行方式：node research-sibling-detection.js
// 依赖：仅使用 Node.js 内置模块（net、child_process、os、fs）

// =======================
// 1️⃣ 设定全局参数
// =======================
const SIBLING_COUNT = 4;               // 要创建的“姐妹”实例数量
const HEARTBEAT_INTERVAL = 1000;        // 每个实例发送心跳的间隔（ms）
const TIMEOUT_MULTIPLIER = 2;           // 超时判定为失联的倍数（相对于 HEARTBEAT_INTERVAL）
const LOG_PREFIX = '[Sibling]';

// =======================
// 2️⃣ 创建主控制进程（Coordinator)
//    它打开一个 TCP 端口，负责接受所有姐妹的连接并监控心跳
// =======================
const net = require('net');
const coordinator = net.createServer((socket) => {
  const id = socket.remotePort - 1024; // 简单的 ID（端口号-1024）
  console.log(`${LOG_PREFIX} #${id} 连接到主控制端口 ${socket.remotePort}`);

  // 记录最后一次收到的心跳时间
  let lastHeartbeat = Date.now();

  // 收到数据时更新时间戳并打印
  socket.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg === 'HB') {
      lastHeartbeat = Date.now();
      console.log(`${LOG_PREFIX} #${id} 收到心跳`);
    }
  });

  // 超时检测：若超过 TIMEOUT_MULTIPLIER * HEARTBEAT_INTERVAL 没收到心跳，则判定为失联
  setInterval(() => {
    const now = Date.now();
    if (now - lastHeartbeat > TIMEOUT_MULTIPLIER * HEARTBEAT_INTERVAL) {
      console.log(`${LOG_PREFIX} #${id} 失联（超时 ${now - lastHeartbeat}ms)`);
    }
  }, TIMEOUT_MULTIPLIER * HEARTBEAT_INTERVAL / 2);

  // 当连接关闭时，记录失联信息
  socket.on('end', () => {
    console.log(`${LOG_PREFIX} #${id} 断开连接`);
  });

  // 异常处理
  socket.on('error', (err) => {
    console.error(`${LOG_PREFIX} #${id} 连接错误: ${err.message}`);
  });

  // 把 socket 保存到全局数组供后续使用
  coordinator.sockets = coordinator.sockets || [];
  coordinator.sockets.push(socket);
});

// 启动监听
const COORD_PORT = 12345;
coordinator.listen(COORD_PORT, () => {
  console.log(`[Coordinator] 正在监听 ${COORD_PORT} 端口`);
});

// =======================
// 3️⃣ 启动“姐妹”进程（Worker）
//    每个进程会主动连接到主控制端口，并每隔 HEARTBEAT_INTERVAL 发送一次 'HB'
// =======================
for (let i = 1; i <= SIBLING_COUNT; i++) {
  const worker = require('child_process').fork(__filename, [], {
    execArgv: ['--worker', i.toString()] // 通过命令行参数标识实例 ID
  });

  // 为了让父进程不与子进程无限递归，子进程在收到 --worker 参数时直接退出主逻辑
  // 实际业务中每个实例会有自己的业务代码，这里只演示通信框架
}

// =======================
// 4️⃣ 子进程代码（被 fork 出来的“姐妹”实例）
// =======================
if (process.argv.includes('--worker')) {
  const net = require('net');
  const PORT = 12345; // 与主控制端口相同
  const client = net.createConnection({ port: PORT }, () => {
    console.log(`[Sibling ${process.argv[2]}] 已连接到主控制端口 ${PORT}`);
    // 启动心跳循环
    const interval = setInterval(() => {
      client.write('HB\n');
      console.log(`[Sibling ${process.argv[2]}] 发送心跳`);
    }, HEARTBEAT_INTERVAL);
    // 监听服务器端的异常关闭（如主控制端关闭连接）
    client.on('end', () => {
      clearInterval(interval);
      console.log(`[Sibling ${process.argv[2]}] 服务器端关闭连接`);
    });
    client.on('error', (err) => {
      console.error(`[Sibling ${process.argv[2]}] 连接错误: ${err.message}`);
      clearInterval(interval);
    });
  });

  client.on('data', (data) => {
    // 主控制端可能会发送一些调试信息，这里直接忽略
  });
}

// =======================
// 5️⃣ 演示“主动 killing”一个姐妹以验证失联检测// =======================
setTimeout(() => {
  // 假设第 2 个进程（ID=2）被“异常terminate”
  console.log('\n=== 演示：主动终止Sibling #2 ===');
  const fs = require('fs');
  const ps = require('ps-list');
  ps.then(list => {
    const target = list.find(p => p.PID !== process.pid && p.argv.includes('--worker') && p.argv[1] === '2');
    if (target) {
      console.log(`[Coordinator] 找到进程 ${target.PID}，即将杀死`);
      process.kill(target.PID, 'SIGTERM');
    } else {
      console.log('[Coordinator] 未找到对应的Sibling进程，可能已自行退出');
    }
  });
}, 5000); // 5 秒后执行

// =======================
// 6️⃣ 进程退出清理
// =======================
process.on('exit', (code) => {
  console.log(`[Coordinator] 进程结束，退出码 ${code}`);
  // 关闭所有打开的 socket
  coordinator.sockets?.forEach(s => s.destroy());
  coordinator.close();
});