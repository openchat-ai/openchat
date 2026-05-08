// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:29:27.943Z

// 实例间通讯方式研究 —— 使用 TCP 套接字实现“姐妹”状态检测（不依赖 HTTP ping）
// 运行环境：Node.js (CommonJS) ，直接 `node research.js` 即可
// 代码会 spawn 两个子进程（姐妹实例），它们互相通过 TCP 发送心跳，
// 父进程负责监控连接状态并输出结果。

const { fork } = require('child_process');
const net = require('net');

// ==== 配置 ====
const PORT_BASE = 5000;               // 每个实例使用的端口基准值
const HEARTBEAT_INTERVAL = 1000;        // 心跳发送间隔（ms）
const TIMEOUT_MULTIPLIER = 3;           // 超时检测倍数（检测窗口 = HEARTBEAT_INTERVAL * TIMEOUT_MULTIPLIER）
const CHILD_SCRIPT = 'sibling.js';      // 子进程执行的脚本文件路径

// ==== 辅助函数：创建 TCP 客户端（用于发送心跳） ====
function createHeartbeatClient(targetPort, siblingId, parent) {
  const client = net.createConnection({ host: '127.0.0.1', port: targetPort }, () => {
    console.log(`[Sibling ${siblingId}] 连接已建立至端口 ${targetPort}`);
    // 每隔 HEARTBEAT_INTERVAL 发送一次心跳字符串    setInterval(() => {
      client.write(`HB ${siblingId}\n`);
    }, HEARTBEAT_INTERVAL);
  });

  client.setEncoding('utf8');
  client.on('data', (data) => {
    // 收到心跳后，仅打印确认（实际业务可更新状态）
    console.log(`[Parent] 收到Sibling ${siblingId} 心跳: ${data.trim()}`);
  });

  client.on('error', (err) => {
    console.error(`[Parent] Socket error (Sibling ${siblingId}):`, err.message);
  });

  client.on('close', (hadError) => {
    const reason = hadError ? '错误关闭' : '正常关闭';
    console.log(`[Parent] Sibling ${siblingId} 连接已断开（${reason}）`);
    // 这里可以记录离线状态，或触发重连逻辑
    // 为演示直接退出父进程（在真实场景下可以继续监控）
    // process.exit(0);
  });

  return client;
}

// ==== 父进程：启动监控并 spawn 子进程 ====
const parents = [];

for (let i = 1; i <= 2; i++) {
  const port = PORT_BASE + i; // 每个子进程使用独立端口
  const child = fork(CHILD_SCRIPT, [String(port), String(i)], {
    detached: false,
    stdio: 'inherit',
  });

  // 父进程保持对子进程的引用，用于后续监控
  parents[i] = { child, port };

  // 为每个子进程创建对应的“心跳客户端”，指向另一Sibling的端口
  const targetPort = PORT_BASE + (i === 1 ? 2 : 1); // 互相对应
  const hbClient = createHeartbeatClient(targetPort, i, this);

  // 监听子进程退出（异常退出时给出提示）
  child.on('exit', (code, signal) => {
    console.log(`[Parent] Sibling ${i} 进程退出，码=${code}, 信号=${signal}`);
  });
}

// ==== 主进程结束提示 ====
process.on('exit', () => {
  console.log('[Parent] 所有Sibling进程已结束，研究结束。');
});