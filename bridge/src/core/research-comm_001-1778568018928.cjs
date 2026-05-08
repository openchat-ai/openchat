// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:40:18.928Z

/**
 * 简单的实例间通讯方式研究
 * 
 * 1. HTTP Ping（已知方式）  - 通过 HTTP GET /ping
 * 2. UDP 广播探测          - 发送 UDP 消息到本地广播地址，监听响应
 * 3. TCP keep-alive 监测     - 连接到同一主机的指定 TCP 端口，使用 keep-alive
 * 4. DNS SRV 记录查询     - 查询本地主机的 SRV 记录（示例）
 * 
 * 代码会尝试以上四种方式来探测“姐妹实例”状态，并将结果打印到控制台。
 * 
 * 运行前请确保：
 *   - 本机有可用的 UDP/Broadcast 网络
 *   - 目标主机（此处为 localhost）有对应的服务器监听端口（如 8080）
 *   - Node.js v18+（内置 dns.promises）
 */

const http = require('http');
const dgram = require('dgram');
const net = require('net');
const dns = require('dns').promises;

// ---------- 1. HTTP Ping ----------
function httpPing(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(2000, () => {
      req.abort();
      resolve({ ok: false });
    });
  });
}

// ---------- 2. UDP 广播探测 ----------
function udpBroadcast(port, message, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const responses = [];
    socket.on('message', (msg, rinfo) => {
      responses.push({ msg: msg.toString(), host: rinfo.address, port: rinfo.port });
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      const buffer = Buffer.from(message);
      socket.send(buffer, 0, buffer.length, port, '255.255.255.255');
    });

    setTimeout(() => {
      socket.close();
      resolve(responses);
    }, timeout);
  });
}

// ---------- 3. TCP Keep-Alive ----------
function tcpKeepAlive(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let responded = false;

    client.setTimeout(timeout);
    client.setKeepAlive(true, 1000);

    client.connect(port, host, () => {
      responded = true;
      resolve({ ok: true, reason: 'connected' });
      client.end();
    });

    client.on('error', () => {
      if (!responded) resolve({ ok: false, reason: 'connect error' });
    });

    client.on('timeout', () => {
      if (!responded) resolve({ ok: false, reason: 'timeout' });
    });
  });
}

// ---------- 4. DNS SRV 记录查询 ----------
async function dnsSrvQuery(service) {
  try {
    const records = await dns.resolveSrv(service);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- 主程序 ----------
(async () => {
  console.log('--- 实例间通讯方式研究开始 ---\n');

  // 1. HTTP Ping
  console.log('1) HTTP Ping to http://localhost:8080/ping');
  const httpResult = await httpPing('http://localhost:8080/ping');
  console.log('   Result:', httpResult, '\n');

  // 2. UDP 广播
  console.log('2) UDP 广播探测 (发送到 3000 端口)');
  const udpResponses = await udpBroadcast(3000, 'PING_FROM_NODE');
  console.log('   Received responses:', udpResponses, '\n');

  // 3. TCP Keep-Alive
  console.log('3) TCP Keep-Alive 连接测试 (localhost:9090)');
  const tcpResult = await tcpKeepAlive('127.0.0.1', 9090);
  console.log('   Result:', tcpResult, '\n');

  // 4. DNS SRV 记录查询
  console.log('4) DNS SRV 记录查询 (_http._tcp.local)');
  const dnsResult = await dnsSrvQuery('_http._tcp.local');
  console.log('   Result:', dnsResult, '\n');

  console.log('--- 研究结束 ---');
})();