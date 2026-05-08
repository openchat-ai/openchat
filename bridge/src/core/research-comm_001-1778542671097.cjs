// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T23:37:51.097Z

// file: instance-communication-demo.js
// ---------------------------------------------------------------
// 运行方式：直接 `node instance-communication-demo.js`
// ---------------------------------------------------------------

const net = require('net');
const dgram = require('dgram');
const { fork } = require('child_process');
const os = require('os');
const path = require('path');

// ------------------- 配置 -------------------
const CONFIG = {
  tcp: { port: 4001, host: '127.0.0.1' },
  udp: { port: 4002, host: '127.0.0.1' },
  uds: { path: path.join(os.tmpdir(), 'sister.sock') }, // Unix Domain Socket
  ipc: { script: path.join(__dirname, 'ipc-child.js') }, // 子进程入口
  timeout: 1000, // ms，等待 pong 的时间
};

// ------------------- 1. TCP Socket Server -------------------
function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      const msg = buf.toString().trim();
      if (msg === 'ping') {
        socket.write('pong\n');
      }
    });
  });

  server.listen(CONFIG.tcp.port, CONFIG.tcp.host, () => {
    console.log(`[TCP] Server listening on ${CONFIG.tcp.host}:${CONFIG.tcp.port}`);
  });
}

// ------------------- 2. UDP Server -------------------
function startUdpServer() {
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    if (msg.toString().trim() === 'ping') {
      server.send('pong', rinfo.port, rinfo.address);
    }
  });

  server.bind(CONFIG.udp.port, CONFIG.udp.host, () => {
    console.log(`[UDP] Server bound to ${CONFIG.udp.host}:${CONFIG.udp.port}`);
  });
}

// ------------------- 3. Unix Domain Socket Server -------------------
function startUdsServer() {
  // Windows 不支持 Unix Domain Socket，直接跳过
  if (process.platform === 'win32') {
    console.log('[UDS] Windows 平台不支持 Unix Domain Socket，已跳过。');
    return;
  }

  const server = net.createServer((socket) => {
    socket.on('data', (buf) => {
      if (buf.toString().trim() === 'ping') {
        socket.write('pong\n');
      }
    });
  });

  // 删除可能残留的旧 socket 文件
  const fs = require('fs');
  try { fs.unlinkSync(CONFIG.uds.path); } catch (_) {}

  server.listen(CONFIG.uds.path, () => {
    console.log(`[UDS] Server listening on ${CONFIG.uds.path}`);
  });
}

// ------------------- 4. IPC (fork) Server -------------------
// 这里的子进程会在同一个文件里实现，稍后会写入磁盘
function startIpcServer() {
  const child = fork(CONFIG.ipc.script, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  child.on('message', (msg) => {
    // 子进程只会在收到 ping 时回 pong
    if (msg === 'pong') {
      child.__lastPong = Date.now();
    }
  });

  child.on('exit', (code) => {
    console.log(`[IPC] Child exited with code ${code}`);
  });

  // 保存引用，后面轮询时使用
  CONFIG.ipc.child = child;
}

// ------------------- 生成 IPC 子进程脚本 -------------------
function writeIpcChildScript() {
  const fs = require('fs');
  const childCode = `
    // ipc-child.js
    process.on('message', (msg) => {
      if (msg === 'ping') {
        process.send('pong');
      }
    });
    // 为了让父进程知道子进程已就绪
    process.send('ready');
  `;
  fs.writeFileSync(CONFIG.ipc.script, childCode);
}

// ------------------- Ping 实现 -------------------
function pingTcp() {
  return new Promise((resolve) => {
    const client = net.createConnection(CONFIG.tcp.port, CONFIG.tcp.host, () => {
      client.write('ping\n');
    });

    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, CONFIG.timeout);

    client.on('data', (data) => {
      if (data.toString().trim() === 'pong') {
        clearTimeout(timer);
        client.end();
        resolve(true);
      }
    });

    client.on('error', () => resolve(false));
  });
}

function pingUdp() {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const msg = Buffer.from('ping');

    const timer = setTimeout(() => {
      client.close();
      resolve(false);
    }, CONFIG.timeout);

    client.on('message', (msg) => {
      if (msg.toString().trim() === 'pong') {
        clearTimeout(timer);
        client.close();
        resolve(true);
      }
    });

    client.send(msg, CONFIG.udp.port, CONFIG.udp.host);
  });
}

function pingUds() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      resolve(false);
      return;
    }
    const client = net.createConnection(CONFIG.uds.path, () => {
      client.write('ping\n');
    });

    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, CONFIG.timeout);

    client.on('data', (data) => {
      if (data.toString().trim() === 'pong') {
        clearTimeout(timer);
        client.end();
        resolve(true);
      }
    });

    client.on('error', () => resolve(false));
  });
}

function pingIpc() {
  return new Promise((resolve) => {
    const child = CONFIG.ipc.child;
    if (!child) return resolve(false);

    // 监听子进程的 ready 消息，确保已启动
    if (!child.__ready) {
      child.once('message', (msg) => {
        if (msg === 'ready') {
          child.__ready = true;
          sendPing();
        }
      });
    } else {
      sendPing();
    }

    function sendPing() {
      child.__lastPong = null;
      child.send('ping');
      const timer = setTimeout(() => {
        resolve(false);
      }, CONFIG.timeout);

      const check = setInterval(() => {
        if (child.__lastPong) {
          clearTimeout(timer);
          clearInterval(check);
          resolve(true);
        }
      }, 10);
    }
  });
}

// ------------------- 主流程 -------------------
async function main() {
  // 1️⃣ 启动所有服务
  startTcpServer();
  startUdpServer();
  startUdsServer();
  writeIpcChildScript();
  startIpcServer();

  // 等待服务稍微启动（实际生产环境应使用更可靠的就绪检测）
  await new Promise((r) => setTimeout(r, 500));

  // 2️⃣ 轮询检查
  const results = await Promise.all([
    pingTcp(),
    pingUdp(),
    pingUds(),
    pingIpc(),
  ]);

  console.log('\n=== 实例间状态检测结果 ===');
  console.log(`TCP  Socket   : ${results[0] ? 'alive ✅' : 'down ❌'}`);
  console.log(`UDP  Datagram : ${results[1] ? 'alive ✅' : 'down ❌'}`);
  console.log(`UDS  (Unix Domain Socket) : ${results[2] ? 'alive ✅' : 'unsupported / down ❌'}`);
  console.log(`IPC  (fork child) : ${results[3] ? 'alive ✅' : 'down ❌'}`);

  // 3️⃣ 清理（演示结束后退出进程）
  // 关闭 TCP/UDP/UDS 服务器
  process.exit(0);
}

main().catch((e) => {
  console.error('运行出错：', e);
  process.exit(1);
});