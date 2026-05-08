// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:13:56.816Z

// file: sister-status-demo.js
// 运行方式: node sister-status-demo.js

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const redis = require('redis');

// -------------------- 配置 --------------------
const INSTANCE_IDS = ['A', 'B', 'C']; // 三个实例的标识
const BASE_TCP_PORT = 7000;           // TCP 服务器基准端口
const UDP_PORT = 8000;                // UDP 广播端口
const WS_PORT = 9000;                 // WebSocket 服务器端口
const REDIS_CHANNEL = 'sister-heartbeat';
const HEARTBEAT_INTERVAL = 2000;      // 发送心跳的间隔（ms）
const OFFLINE_THRESHOLD = 6000;       // 判定离线的超时阈值（ms）
// ------------------------------------------------

// 记录每个实例最近一次收到的心跳时间
const lastSeen = {}; // { instanceId: timestamp }

// ---------- 1. TCP 心跳实现 ----------
function startTcpServer(id, port) {
    const server = net.createServer(socket => {
        socket.on('data', data => {
            const msg = data.toString().trim();
            if (msg === 'heartbeat') {
                // 回复 ACK
                socket.write('ack\n');
                // 更新收到的时间（这里是对方主动发起的心跳）
                // 这里不记录，因为是 server 端收到的；client 端会自行记录
            }
        });
    });

    server.listen(port, () => {
        console.log(`[${id}] TCP server listening on ${port}`);
    });
}

// ---------- 2. UDP Broadcast 心跳 ----------
function startUdpListener(id) {
    const udp = dgram.createSocket('udp4');

    udp.on('message', (msg, rinfo) => {
        const payload = msg.toString();
        const { from, type } = JSON.parse(payload);
        if (type === 'heartbeat') {
            // 记录收到的时间
            lastSeen[from] = Date.now();
            // 回复 ACK（单播回去）
            const ack = Buffer.from(JSON.stringify({ from: id, type: 'ack' }));
            udp.send(ack, rinfo.port, rinfo.address);
        } else if (type === 'ack') {
            lastSeen[from] = Date.now(); // 收到 ack，也算一次存活
        }
    });

    udp.bind(UDP_PORT, () => {
        udp.setBroadcast(true);
        console.log(`[${id}] UDP listener bound to ${UDP_PORT}`);
    });

    return udp;
}

// ---------- 3. WebSocket 心跳 ----------
function startWsServer(id) {
    const wss = new WebSocket.Server({ port: WS_PORT + parseInt(id, 36) }, () => {
        console.log(`[${id}] WebSocket server listening on ${WS_PORT + parseInt(id, 36)}`);
    });

    wss.on('connection', ws => {
        ws.on('message', data => {
            const { from, type } = JSON.parse(data);
            if (type === 'heartbeat') {
                lastSeen[from] = Date.now();
                ws.send(JSON.stringify({ from: id, type: 'ack' }));
            } else if (type === 'ack') {
                lastSeen[from] = Date.now();
            }
        });
    });

    return wss;
}

// ---------- 4. Redis Pub/Sub 心跳 ----------
function startRedisClient(id) {
    const pub = redis.createClient();
    const sub = redis.createClient();

    sub.subscribe(REDIS_CHANNEL);
    sub.on('message', (channel, message) => {
        const { from, type } = JSON.parse(message);
        if (from === id) return; // 忽略自己的消息
        if (type === 'heartbeat') {
            lastSeen[from] = Date.now();
            // 回复 ack
            pub.publish(REDIS_CHANNEL, JSON.stringify({ from: id, type: 'ack' }));
        } else if (type === 'ack') {
            lastSeen[from] = Date.now();
        }
    });

    return { pub, sub };
}

// ---------- 5. 客户端发送心跳 ----------
function startHeartbeat(id) {
    // TCP 客户端
    const tcpSockets = {};
    INSTANCE_IDS.forEach(other => {
        if (other === id) return;
        const port = BASE_TCP_PORT + parseInt(other, 36);
        const socket = new net.Socket();
        socket.connect(port, '127.0.0.1', () => {
            // console.log(`[${id}] TCP connected to ${other}`);
        });
        socket.on('data', data => {
            const msg = data.toString().trim();
            if (msg === 'ack') {
                lastSeen[other] = Date.now();
            }
        });
        tcpSockets[other] = socket;
    });

    // UDP client（同一个 socket即可）
    const udp = dgram.createSocket('udp4');

    // WebSocket 客户端
    const wsClients = {};
    INSTANCE_IDS.forEach(other => {
        if (other === id) return;
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT + parseInt(other, 36)}`);
        ws.on('open', () => {
            // console.log(`[${id}] WS connected to ${other}`);
        });
        ws.on('message', data => {
            const { from, type } = JSON.parse(data);
            if (type === 'ack' && from === other) {
                lastSeen[other] = Date.now();
            }
        });
        wsClients[other] = ws;
    });

    // Redis client
    const { pub: redisPub } = startRedisClient(id);

    // 定时发送
    setInterval(() => {
        const now = Date.now();

        // TCP
        Object.entries(tcpSockets).forEach(([other, sock]) => {
            if (sock.destroyed) return;
            sock.write('heartbeat\n');
        });

        // UDP Broadcast
        const udpMsg = Buffer.from(JSON.stringify({ from: id, type: 'heartbeat' }));
        udp.setBroadcast(true);
        udp.send(udpMsg, 0, udpMsg.length, UDP_PORT, '255.255.255.255');

        // WebSocket
        Object.entries(wsClients).forEach(([other, ws]) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ from: id, type: 'heartbeat' }));
            }
        });

        // Redis Pub/Sub
        redisPub.publish(REDIS_CHANNEL, JSON.stringify({ from: id, type: 'heartbeat' }));

        // 检查离线状态并输出
        INSTANCE_IDS.forEach(other => {
            if (other === id) return;
            const last = lastSeen[other] || 0;
            const offline = now - last > OFFLINE_THRESHOLD;
            console.log(
                `[${id}] -> ${other} | lastSeen=${last ? (now - last) + 'ms ago' : 'never'} | ${offline ? 'OFFLINE' : 'ONLINE'}`
            );
        });
        console.log('---');
    }, HEARTBEAT_INTERVAL);
}

// ---------- 主入口 ----------
function main() {
    // 为每个实例启动全部服务
    INSTANCE_IDS.forEach(id => {
        // TCP server
        startTcpServer(id, BASE_TCP_PORT + parseInt(id, 36));

        // UDP listener
        startUdpListener(id);

        // WS server
        startWsServer(id);

        // Redis client (pub/sub) 已在 heartbeat 中创建

        // 启动心跳发送
        startHeartbeat(id);
    });
}

main();