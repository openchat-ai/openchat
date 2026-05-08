// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:17:22.711Z

// instance_communication.js
// =============================================================
// 1. HTTP (express)
// 2. TCP (net)
// 3. UDP Multicast (dgram)
// 4. WebSocket (ws)
// -------------------------------------------------------------
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const express = require('express');

// ---------- 1. HTTP ----------
const httpApp = express();
httpApp.get('/ping', (req, res) => {
  res.send('pong-http');
});

const httpServer = httpApp.listen(3000, () => {
  console.log('HTTP server listening on port 3000');
  // client
  http.get('http://localhost:3000/ping', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('HTTP ping result:', data));
  }).on('error', err => console.error(err));
});

// ---------- 2. TCP ----------
const tcpServer = net.createServer((socket) => {
  socket.on('data', data => {
    if (data.toString() === 'ping-tcp') {
      socket.write('pong-tcp');
    }
  });
});
tcpServer.listen(4000, () => {
  console.log('TCP server listening on port 4000');
  // client
  const client = net.createConnection({ port: 4000 }, () => {
    client.write('ping-tcp');
  });
  client.on('data', data => {
    console.log('TCP ping result:', data.toString());
    client.end();
  });
});

// ---------- 3. UDP Multicast ----------
const udpPort = 5000;
const udpAddress = '239.255.255.250'; // local multicast address
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpServer.on('message', (msg, rinfo) => {
  if (msg.toString() === 'ping-udp') {
    const response = Buffer.from('pong-udp');
    udpServer.send(response, 0, response.length, udpPort, udpAddress, (err) => {
      if (err) console.error(err);
    });
  }
});

udpServer.bind(udpPort, () => {
  udpServer.addMembership(udpAddress);
  console.log(`UDP server listening on ${udpAddress}:${udpPort}`);
  // client
  const udpClient = dgram.createSocket('udp4');
  const message = Buffer.from('ping-udp');
  udpClient.send(message, 0, message.length, udpPort, udpAddress, (err) => {
    if (err) console.error(err);
  });
  udpClient.on('message', (msg) => {
    console.log('UDP ping result:', msg.toString());
    udpClient.close();
  });
});

// ---------- 4. WebSocket ----------
const wss = new WebSocket.Server({ port: 6000 }, () => {
  console.log('WebSocket server listening on port 6000');
});
wss.on('connection', ws => {
  ws.on('message', data => {
    if (data === 'ping-ws') {
      ws.send('pong-ws');
    }
  });
});

// client
const wsClient = new WebSocket('ws://localhost:6000');
wsClient.on('open', () => {
  wsClient.send('ping-ws');
});
wsClient.on('message', data => {
  console.log('WebSocket ping result:', data);
  wsClient.close();
  // After all tests finish, close servers
  setTimeout(() => {
    httpServer.close();
    tcpServer.close();
    udpServer.close();
    wss.close();
    console.log('All servers closed. Done.');
  }, 100);
});