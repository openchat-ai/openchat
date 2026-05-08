// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T02:05:19.220Z

/**
 *  一段完整的 Node.js 示例代码
 *  说明：演示 HTTP、WebSocket、UDP 广播、Redis Pub/Sub、gRPC 这五种常见的实例间通讯方式
 *  并通过 console.log 输出检测结果
 */

const http = require('http');
const WebSocket = require('ws');
const dgram = require('dgram');
const redis = require('redis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

/* ====================== 1. HTTP 服务器 ====================== */
const HTTP_PORT = 3000;
const httpServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Server listening on http://localhost:${HTTP_PORT}/ping`);
});

/* ====================== 2. WebSocket 服务器 ====================== */
const WS_PORT = 8080;
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[WS] Server listening on ws://localhost:${WS_PORT}`);
});
wss.on('connection', ws => {
  ws.on('message', message => {
    if (message === 'ping') {
      ws.send('pong');
    }
  });
});

/* ====================== 3. UDP 广播监听器 ====================== */
const UDP_PORT = 41234;
const udpSocket = dgram.createSocket('udp4');
udpSocket.on('listening', () => {
  const address = udpSocket.address();
  console.log(`[UDP] Listening on ${address.address}:${address.port}`);
});
udpSocket.on('message', msg => {
  console.log(`[UDP] Received broadcast message: ${msg.toString()}`);
});
udpSocket.bind(UDP_PORT);

/* ====================== 4. Redis Pub/Sub ====================== */
const REDIS_CHANNEL = 'heartbeat';
const redisPub = redis.createClient();
const redisSub = redis.createClient();
redisPub.on('error', err => console.error('Redis Pub Error:', err));
redisSub.on('error', err => console.error('Redis Sub Error:', err));

redisSub.subscribe(REDIS_CHANNEL, err => {
  if (err) console.error('Subscribe failed:', err);
  else console.log(`[Redis] Subscribed to channel "${REDIS_CHANNEL}"`);
});
redisSub.on('message', (channel, message) => {
  console.log(`[Redis] Received message on ${channel}: ${message}`);
});

/* ====================== 5. gRPC Health Check ====================== */
const PROTO_PATH = __dirname + '/health.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  enums: String,
  defaults: true,
  oneofs: true,
});
const healthProto = grpc.loadPackageDefinition(packageDefinition).grpc.health.v1;

const GRPC_PORT = '0.0.0.0:50051';
const grpcServer = new grpc.Server();
grpcServer.addService(healthProto.Health.service, {
  Check: (_, callback) => {
    callback(null, { status: 'SERVING' });
  },
});
grpcServer.bindAsync(GRPC_PORT, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) return console.error('gRPC bind error:', err);
  grpcServer.start();
  console.log(`[gRPC] Server listening on ${GRPC_PORT}`);
});

/* ====================== 客户端检测 ====================== */
async function runClientChecks() {
  /* 1. HTTP ping */
  const httpPromise = new Promise((resolve, reject) => {
    http.get(`http://localhost:${HTTP_PORT}/ping`, res => {
      const { statusCode } = res;
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP status ${statusCode}`));
        }
      });
    }).on('error', reject);
  });

  /* 2. WebSocket ping */
  const wsPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    ws.on('open', () => {
      ws.send('ping');
    });
    ws.on('message', msg => {
      if (msg === 'pong') {
        resolve('pong received');
        ws.close();
      }
    });
    ws.on('error', reject);
  });

  /* 3. UDP broadcast ping */
  const udpPromise = new Promise((resolve, reject) => {
    const udpClient = dgram.createSocket('udp4');
    const message = Buffer.from('ping');
    udpClient.send(message, 0, message.length, UDP_PORT, '255.255.255.255', err => {
      if (err) {
        udpClient.close();
        reject(err);
      } else {
        // 由于是广播，服务端会在 console 输出
        resolve('broadcast sent');
        udpClient.close();
      }
    });
  });

  /* 4. Redis pub/sub ping */
  const redisPromise = new Promise((resolve, reject) => {
    const testMsg = `ping-${Date.now()}`;
    const tempSub = redis.createClient();
    tempSub.on('message', (channel, message) => {
      if (channel === REDIS_CHANNEL && message === testMsg) {
        resolve(`Redis received: ${message}`);
        tempSub.unsubscribe();
        tempSub.quit();
      }
    });
    tempSub.subscribe(REDIS_CHANNEL, () => {
      redisPub.publish(REDIS_CHANNEL, testMsg);
    });
    tempSub.on('error', err => reject(err));
  });

  /* 5. gRPC health check */
  const grpcPromise = new Promise((resolve, reject) => {
    const client = new healthProto.Health(GRPC_PORT, grpc.credentials.createInsecure());
    client.Check({}, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });

  /* 执行所有检查 */
  try {
    const [httpRes, wsRes, udpRes, redisRes, grpcRes] = await Promise.all([
      httpPromise,
      wsPromise,
      udpPromise,
      redisPromise,
      grpcPromise,
    ]);
    console.log('===== 检测结果 =====');
    console.log('HTTP:', httpRes);
    console.log('WebSocket:', wsRes);
    console.log('UDP Broadcast:', udpRes);
    console.log('Redis Pub/Sub:', redisRes);
    console.log('gRPC Health:', grpcRes);
  } catch (e) {
    console.error('检测过程中出现错误:', e);
  }
}

/* 延迟一点时间，让服务器准备好 */
setTimeout(runClientChecks, 1000);