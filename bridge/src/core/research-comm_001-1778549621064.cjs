// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:33:41.064Z

// filename: sister-status.js
// 运行方式：node sister-status.js

// ------------------- 依赖 -------------------
const net = require('net');                 // TCP
const dgram = require('dgram');             // UDP
const http = require('http');               // HTTP (对比)
const WebSocket = require('ws');            // WebSocket
const redis = require('redis');             // Redis Pub/Sub
const grpc = require('@grpc/grtools');      // gRPC (使用 @grpc/proto-loader)
const protoLoader = require('@grpc/proto-loader');
const os = require('os');

// ------------------- 配置 -------------------
const NODE_COUNT = 3;               // 模拟多少个实例
const INTERVAL_MS = 1000;           // 心跳间隔
const UDP_PORT = 41234;
const TCP_PORT_BASE = 5000;
const WS_PORT_BASE = 6000;
const HTTP_PORT_BASE = 7000;
const GRPC_PORT_BASE = 8000;

// ------------------- 工具 -------------------
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (!iface.internal && iface.family === 'IPv4') {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}
const localIPs = getLocalIPs();

// ------------------- 统计结构 -------------------
const stats = {
  http: { sent: 0, received: 0 },
  tcp: { sent: 0, received: 0 },
  udp: { sent: 0, received: 0 },
  ws: { sent: 0, received: 0 },
  redis: { sent: 0, received: 0 },
  grpc: { sent: 0, received: 0 },
};

// ------------------- 实例类 -------------------
class SisterNode {
  constructor(id) {
    this.id = id;
    this.httpPort = HTTP_PORT_BASE + id;
    this.tcpPort = TCP_PORT_BASE + id;
    this.wsPort = WS_PORT_BASE + id;
    this.grpcPort = GRPC_PORT_BASE + id;
  }

  // ---------- 1. HTTP ping ----------
  startHttp() {
    const server = http.createServer((req, res) => {
      if (req.url === '/ping') {
        stats.http.received++;
        res.end('pong');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    server.listen(this.httpPort, () => {
      console.log(`[HTTP][${this.id}] listening on ${this.httpPort}`);
    });

    // 定时向其他节点发送 ping
    setInterval(() => {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (i === this.id) continue;
        const options = {
          hostname: '127.0.0.1',
          port: HTTP_PORT_BASE + i,
          path: '/ping',
          method: 'GET',
          timeout: 500,
        };
        const req = http.request(options, (res) => {
          res.on('data', () => {}); // ignore body
          stats.http.sent++;
        });
        req.on('error', () => {}); // ignore errors
        req.end();
      }
    }, INTERVAL_MS);
  }

  // ---------- 2. TCP 心跳 ----------
  startTcp() {
    // 服务器
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const msg = data.toString();
        if (msg.startsWith('alive:')) {
          stats.tcp.received++;
        }
      });
    });
    server.listen(this.tcpPort, () => {
      console.log(`[TCP][${this.id}] listening on ${this.tcpPort}`);
    });

    // 客户端循环发送
    setInterval(() => {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (i === this.id) continue;
        const client = net.createConnection({ port: TCP_PORT_BASE + i }, () => {
          client.write(`alive:${this.id}`);
          stats.tcp.sent++;
          client.end();
        });
        client.on('error', () => {}); // ignore
      }
    }, INTERVAL_MS);
  }

  // ---------- 3. UDP 广播 ----------
  startUdp() {
    const socket = dgram.createSocket('udp4');

    socket.on('message', (msg, rinfo) => {
      const str = msg.toString();
      if (str.startsWith('alive:')) {
        stats.udp.received++;
      }
    });

    socket.bind(UDP_PORT, () => {
      socket.setBroadcast(true);
      console.log(`[UDP][${this.id}] bound to ${UDP_PORT}`);
    });

    setInterval(() => {
      const message = Buffer.from(`alive:${this.id}`);
      // 发送到局域网广播地址
      socket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', () => {
        stats.udp.sent++;
      });
    }, INTERVAL_MS);
  }

  // ---------- 4. WebSocket 双向心跳 ----------
  startWs() {
    const wss = new WebSocket.Server({ port: this.wsPort });
    wss.on('connection', (ws) => {
      ws.on('message', (msg) => {
        if (msg.startsWith('alive:')) stats.ws.received++;
      });
    });
    console.log(`[WS][${this.id}] listening on ${this.wsPort}`);

    // 建立到其他节点的 client 连接
    const peers = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      if (i === this.id) continue;
      const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT_BASE + i}`);
      ws.on('open', () => peers.push(ws));
      ws.on('error', () => {}); // ignore
    }

    setInterval(() => {
      peers.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`alive:${this.id}`);
          stats.ws.sent++;
        }
      });
    }, INTERVAL_MS);
  }

  // ---------- 5. Redis Pub/Sub ----------
  startRedis() {
    const pub = redis.createClient();
    const sub = redis.createClient();

    sub.subscribe('sister-alive');
    sub.on('message', (channel, message) => {
      if (channel === 'sister-alive' && message !== `alive:${this.id}`) {
        stats.redis.received++;
      }
    });

    setInterval(() => {
      pub.publish('sister-alive', `alive:${this.id}`);
      stats.redis.sent++;
    }, INTERVAL_MS);
  }

  // ---------- 6. gRPC 健康检查 ----------
  startGrpc() {
    // 定义 proto
    const proto = `
      syntax = "proto3";
      package health;
      service Health {
        rpc Ping (PingRequest) returns (PingResponse);
      }
      message PingRequest { string from = 1; }
      message PingResponse { string status = 1; }
    `;
    const packageDef = protoLoader.loadSync(
      // 用临时文件方式加载
      [{ content: proto, filename: `health_${this.id}.proto` }],
      {}
    );
    const protoDescriptor = grpc.loadPackageDefinition(packageDef);
    const health = protoDescriptor.health;

    // 服务端实现
    const server = new grpc.Server();
    server.addService(health.Health.service, {
      Ping: (call, callback) => {
        stats.grpc.received++;
        callback(null, { status: 'pong' });
      },
    });
    server.bindAsync(`0.0.0.0:${this.grpcPort}`, grpc.ServerCredentials.createInsecure(), () => {
      server.start();
      console.log(`[gRPC][${this.id}] listening on ${this.grpcPort}`);
    });

    // 客户端循环调用
    setInterval(() => {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (i === this.id) continue;
        const client = new health.Health(`localhost:${GRPC_PORT_BASE + i}`, grpc.credentials.createInsecure());
        client.Ping({ from: `${this.id}` }, (err, resp) => {
          if (!err) {
            stats.grpc.sent++;
          }
        });
      }
    }, INTERVAL_MS);
  }

  // 启动全部方式
  startAll() {
    this.startHttp();
    this.startTcp();
    this.startUdp();
    this.startWs();
    this.startRedis();
    this.startGrpc();
  }
}

// ------------------- 主程序 -------------------
(async () => {
  console.log('本机 IP 列表:', localIPs);
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const n = new SisterNode(i);
    nodes.push(n);
    n.startAll();
  }

  // 运行 10 秒后输出统计
  setTimeout(() => {
    console.log('\n=== 10 秒后统计结果 ===');
    console.log('HTTP   - 发送:', stats.http.sent, '接收:', stats.http.received);
    console.log('TCP    - 发送:', stats.tcp.sent, '接收:', stats.tcp.received);
    console.log('UDP    - 发送:', stats.udp.sent, '接收:', stats.udp.received);
    console.log('WebSocket - 发送:', stats.ws.sent, '接收:', stats.ws.received);
    console.log('Redis  - 发送:', stats.redis.sent, '接收:', stats.redis.received);
    console.log('gRPC   - 发送:', stats.grpc.sent, '接收:', stats.grpc.received);
    console.log('\n结论：');
    console.log('1. HTTP 适合跨网络、易调试，但开销相对大。');
    console.log('2. TCP 原始 socket 更轻量，可自定义协议。');
    console.log('3. UDP 广播/组播在局域网发现非常高效，丢包风险需自行处理。');
    console.log('4. WebSocket 提供持久双向通道，适合实时推送。');
    console.log('5. Redis Pub/Sub 依赖外部中间件，天然广播且可靠。');
    console.log('6. gRPC 采用二进制 protobuf，性能最高且支持健康检查语义。');
    process.exit(0);
  }, 10000);
})();