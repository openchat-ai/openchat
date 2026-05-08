// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:25:44.861Z

// 1️⃣ 依赖
const http = require('http');
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// 2️⃣ 先检查本机是否有 Redis
async function checkRedis() {
  try {
    const { stdout } = await exec('redis-cli ping');
    return stdout.trim() === 'PONG';
  } catch (e) {
    return false;
  }
}

// 3️⃣ HTTP Ping
function httpPing(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      resolve(`HTTP ${res.statusCode}`);
    }).on('error', () => resolve('HTTP error'));
  });
}

// 4️⃣ UDP 广播
function udpBroadcast(port = 41234, message = 'ping') {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    const server = dgram.createSocket('udp4');

    server.on('message', (msg, rinfo) => {
      resolve(`UDP received "${msg}" from ${rinfo.address}:${rinfo.port}`);
      client.close();
      server.close();
    });

    server.bind(port, () => {
      client.setBroadcast(true);
      client.send(message, 0, message.length, port, '255.255.255.255');
    });
  });
}

// 5️⃣ TCP Echo
function tcpEcho(port = 5000, message = 'hello') {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        socket.write(data); // echo back
        resolve(`TCP echo "${data.toString()}"`);
        socket.end();
        server.close();
      });
    });

    server.listen(port, () => {
      const client = net.createConnection(port, () => {
        client.write(message);
      });
    });
  });
}

// 6️⃣ Redis Pub/Sub
async function redisPubSub(channel = 'heartbeat', msg = 'ping') {
  if (!await checkRedis()) return 'Redis not available';
  const Redis = require('ioredis');
  const pub = new Redis();
  const sub = new Redis();

  return new Promise((resolve) => {
    sub.subscribe(channel, () => {
      pub.publish(channel, msg);
    });

    sub.on('message', (chan, message) => {
      if (chan === channel) {
        resolve(`Redis received "${message}" on channel "${chan}"`);
        pub.disconnect();
        sub.disconnect();
      }
    });
  });
}

// 7️⃣ File System Watch
function fsWatch(file = './heartbeat.txt') {
  return new Promise((resolve) => {
    // 写入文件
    fs.writeFileSync(file, `ping at ${new Date().toISOString()}`);

    // 监听
    const listener = (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        resolve(`FS detected change in ${file}`);
        fs.unwatchFile(file, listener);
      }
    };
    fs.watchFile(file, listener);
  });
}

// 8️⃣ 主流程
(async () => {
  console.log('=== 实例间通讯方式研究 ===\n');

  // 8.1 HTTP Ping (使用本地 HTTP 服务器示例)
  // 启动一个简单服务器
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  httpServer.listen(3000, async () => {
    const httpRes = await httpPing('http://127.0.0.1:3000');
    console.log('HTTP Ping:', httpRes);

    // 8.2 UDP 广播
    const udpRes = await udpBroadcast();
    console.log('UDP Broadcast:', udpRes);

    // 8.3 TCP Echo
    const tcpRes = await tcpEcho();
    console.log('TCP Echo:', tcpRes);

    // 8.4 Redis Pub/Sub
    const redisRes = await redisPubSub();
    console.log('Redis Pub/Sub:', redisRes);

    // 8.5 File System Watch
    const fsRes = await fsWatch();
    console.log('File System Watch:', fsRes);

    // 结束
    httpServer.close(() => {
      console.log('\n=== 研究完成 ===');
    });
  });
})();