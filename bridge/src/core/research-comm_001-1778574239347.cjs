// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:23:59.347Z

/**
 * 实例间通讯方式研究（除 HTTP ping 之外的替代方案）
 * 目标：展示多种在同一台机器或局域网内发现并检测“姐妹”进程状态的方式
 *  - UDP 广播 / 组播
 *  - Unix Domain Socket（仅在支持的平台上可用）
 *  - 本地 TCP 服务器 + 心跳协议
 *  - 文件系统事件（创建/删除标记文件）
 *
 * 运行方式：
 *   node detect-siblings.js *
 * 该脚本会尝试使用上述几种手段主动探测同一网络/进程组中的其他实例，
 * 并通过 console.log 输出检测结果。
 */

const dgram = require('dgram');
const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');

// ---------- 配置 ----------
const UDP_PORT = 41234;
const UDP_GROUP = '239.255.255.250'; // 组播地址（本地）
const TCP_PORT = 41235;
const MARK_FILE = path.join(os.tmpdir(), `sibling-mark-${process.pid}.txt`);
const HEARTBEAT_INTERVAL = 2000; // ms

// ---------- 1. UDP 广播/组播探测 ----------
function startUdpDiscovery() {
  const socket = dgram.createSocket('udp4');

  // 加入组播组  socket.bind(null, () => {
    socket.setMulticastTTL(128);
    socket.addMembership(UDP_GROUP);
    console.log('[UDP] 加入组播组:', UDP_GROUP);
  });

  // 发送探测消息
  const msg = Buffer.from('SIBLING_HELLO_' + process.pid);
  socket.send(msg, UDP_PORT, UDP_GROUP, () => {
    console.log(`[UDP] 发送探测消息 ${msg.toString('hex')}`);
  });

  // 接收响应（设置 3 秒超时）
  const timeout = setTimeout(() => {
    socket.setTimeToLive(1);
    socket.setSendBufferSize(1024);
    socket.on('message', (msg, rinfo) => {
      console.log(`[UDP] 收到响应来自 ${rinfo.address}:${rinfo.port} -> ${msg.toString()}`);
    });
  }, 3000);

  // 监听响应
  socket.on('message', (msg) => {
    console.log(`[UDP] 收到响应: ${msg.toString()}`);
  });

  // 3 秒后清理
  setTimeout(() => {
    clearTimeout(timeout);
    socket.dropMembership(UDP_GROUP);
    socket.close();
  }, 4000);
}

// ---------- 2. Unix Domain Socket（Linux/macOS） ----------
function startUnixSocketDiscovery() {
  const socketPath = '/tmp/sibling-unix.sock';
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      console.log(`[UnixSocket] 收到来自另一实例的数据: ${data.toString()}`);
    });
    socket.write('ACK');
    socket.end();
  });

  server.listen(socketPath, () => {
    console.log(`[UnixSocket] 监听 Unix Domain Socket: ${socketPath}`);
  });

  // 监测 5 秒后关闭
  setTimeout(() => {
    server.close();
    fs.unlink(socketPath, () => {});
  }, 5000);
}

// ---------- 3. 本地 TCP 心跳服务器 ----------
function startTcpHeartbeat() {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
      console.log(`[TCP] 收到心跳: ${data.trim()}`);
    });
    socket.write('HEARTBEAT_OK');
    socket.destroy();
  });

  server.listen(TCP_PORT, () => {
    console.log(`[TCP] 本地 TCP 心跳服务器已启动, 端口 ${TCP_PORT}`);
  });

  // 发送心跳探测（模拟另一个实例的存在）
  const client = new net.Socket();
  client.connect(TCP_PORT, () => {
    client.write('I_AM_ALIVE_' + process.pid);
  });

  client.on('data', (data) => {
    console.log(`[TCP] 收到心跳回应: ${data.trim()}`);
  });

  client.on('error', () => {
    console.log('[TCP] 未能建立 TCP 心跳连接（可能没有兄弟实例）');
  });

  // 2 秒后关闭
  setTimeout(() => {
    server.close();
    client.destroy();
  }, 3000);
}

// ---------- 4. 文件系统标记文件方式 ----------
function startFileMarkDetection() {
  // 创建标记文件模拟自己存活
  fs.writeFile(MARK_FILE, `pid=${process.pid}\n`, { flag: 'w' }, (err) => {
    if (err) throw err;
    console.log(`[FileMark] 已创建标记文件 ${MARK_FILE}`);
  });

  // 监视目录中是否出现其他标记文件（简化版）
  fs.watch(path.dirname(MARK_FILE), (eventType, filename) => {
    if (filename && filename !== path.basename(MARK_FILE)) {
      console.log(`[FileMark] 检测到新的标记文件: ${filename}`);
    }
  });

  // 定时检查是否有已存在的标记文件（假设已经存在即有其他实例）
  setTimeout(() => {
    fs.stat(MARK_FILE, (err, stats) => {
      if (!err && stats.isFile()) {
        console.log('[FileMark] 检测到标记文件已存在，可能有Sibling进程在运行');
      }
    });
    fs.unlink(MARK_FILE, () => {});
  }, 2000);
}

// ---------- 启动全部检测方式 ----------
console.log('=== 开始研究实例间通讯方式（除 HTTP ping）===\n');

startUdpDiscovery();
startUnixSocketDiscovery();
startTcpHeartbeat();
startFileMarkDetection();

console.log('\n=== 检测结束，等待观察控制台输出 ===\n');