// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:44:05.495Z

/**
 * instanceHealth.js
 *
 * Demonstrates several inter‑instance communication methods
 * (HTTP, UDP broadcast, TCP, Redis pub/sub, shared temp file) to detect
 * sister instance status.
 *
 * Usage:
 *   node instanceHealth.js master   # start master (sender)
 *   node instanceHealth.js worker   # start worker (receiver)
 *
 * Note: For Redis demo, you need a running Redis server on localhost:6379.
 * For file demo, make sure the script has write permission in the temp dir.
 */

const http = require('http');
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('redis');

const PORT_HTTP = 3000;
const PORT_UDP = 41234;
const PORT_TCP = 4000;
const REDIS_CHANNEL = 'instance_health';
const FILE_PATH = path.join(os.tmpdir(), 'instance_health.txt');

// ---------- Utility ----------
function log(...msg) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...msg);
}

// ---------- HTTP Ping ----------
function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      log('HTTP: Received ping');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(PORT_HTTP, () => {
    log(`HTTP server listening on port ${PORT_HTTP}`);
  });
}

function httpPing() {
  const options = {
    hostname: 'localhost',
    port: PORT_HTTP,
    path: '/ping',
    method: 'GET',
    timeout: 1000,
  };
  const req = http.request(options, (res) => {
    res.on('data', () => {}); // consume data
    res.on('end', () => {
      log('HTTP: Received pong');
    });
  });
  req.on('error', (e) => log('HTTP: ping error', e.message));
  req.end();
}

// ---------- UDP Broadcast ----------
function startUdpListener() {
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    log(`UDP: Received message from ${rinfo.address}:${rinfo.port} -> ${msg}`);
  });
  socket.bind(PORT_UDP, () => {
    log(`UDP listener bound to port ${PORT_UDP}`);
  });
}

function udpBroadcast() {
  const message = Buffer.from('udp-heartbeat');
  const socket = dgram.createSocket('udp4');
  socket.setBroadcast(true);
  socket.send(message, 0, message.length, PORT_UDP, '255.255.255.255', () => {
    log('UDP: Sent heartbeat broadcast');
    socket.close();
  });
}

// ---------- TCP ----------
function startTcpServer() {
  const server = net.createServer((socket) => {
    log(`TCP: Connection from ${socket.remoteAddress}:${socket.remotePort}`);
    socket.on('data', (data) => {
      log(`TCP: Received -> ${data}`);
    });
    socket.on('end', () => {
      log('TCP: Connection closed');
    });
  });
  server.listen(PORT_TCP, () => {
    log(`TCP server listening on port ${PORT_TCP}`);
  });
}

function tcpClient() {
  const client = net.createConnection({ port: PORT_TCP, host: 'localhost' }, () => {
    log('TCP: Connected to server, sending heartbeat');
    client.write('tcp-heartbeat\n');
  });
  client.on('error', (err) => log('TCP: error', err.message));
  client.on('end', () => log('TCP: Disconnected'));
}

// ---------- Redis Pub/Sub ----------
async function startRedisSubscriber() {
  const client = createClient();
  client.on('error', (err) => log('Redis: client error', err));
  await client.connect();
  await client.subscribe(REDIS_CHANNEL, (message) => {
    log(`Redis: Received message -> ${message}`);
  });
  log(`Redis: Subscribed to channel '${REDIS_CHANNEL}'`);
}

async function redisPublish() {
  const client = createClient();
  client.on('error', (err) => log('Redis: client error', err));
  await client.connect();
  await client.publish(REDIS_CHANNEL, 'redis-heartbeat');
  log(`Redis: Published heartbeat`);
  await client.disconnect();
}

// ---------- Shared File ----------
function startFileWatcher() {
  fs.watch(FILE_PATH, (eventType, filename) => {
    if (eventType === 'change') {
      fs.readFile(FILE_PATH, 'utf8', (err, data) => {
        if (!err) log(`File: Detected change -> ${data.trim()}`);
      });
    }
  });
  log(`File watcher listening on ${FILE_PATH}`);
}

function fileHeartbeat() {
  const content = `heartbeat-${Date.now()}\n`;
  fs.writeFile(FILE_PATH, content, (err) => {
    if (err) log('File: write error', err.message);
    else log('File: wrote heartbeat');
  });
}

// ---------- Main ----------
(async () => {
  const role = process.argv[2];
  if (!role) {
    console.error('Specify role: master or worker');
    process.exit(1);
  }

  if (role === 'worker') {
    // Start all listeners
    startHttpServer();
    startUdpListener();
    startTcpServer();
    await startRedisSubscriber();
    startFileWatcher();
    log('Worker ready, listening for heartbeats...');
  } else if (role === 'master') {
    // Master sends heartbeats every 2 seconds
    setInterval(() => {
      log('--- Master heartbeat cycle ---');
      httpPing();
      udpBroadcast();
      tcpClient();
      redisPublish();
      fileHeartbeat();
    }, 2000);
  } else {
    console.error('Unknown role. Use "master" or "worker".');
    process.exit(1);
  }
})();