// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:46:33.848Z

// file: instance-communication-demo.js
// 运行方式：node instance-communication-demo.js

// -------------------- 依赖 --------------------
const net = require('net');                 // TCP
const dgram = require('dgram');             // UDP
const WebSocket = require('ws');            // WebSocket (npm i ws)
const redis = require('redis');             // Redis Pub/Sub (npm i redis)

// -------------------- 配置 --------------------
const CONFIG = {
    TCP_PORT: 4000,
    UDP_PORT: 4001,
    WS_PORT: 4002,
    REDIS_CHANNEL: 'instance_heartbeat',
    TIMEOUT_MS: 2000
};

// -------------------- 工具函数 --------------------
function withTimeout(promise, ms, name) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
}

// -------------------- 1. TCP 心跳 --------------------
function startTcpServer() {
    const server = net.createServer(socket => {
        socket.on('data', data => {
            if (data.toString() === 'ping') {
                socket.write('pong');
            }
        });
    });
    server.listen(CONFIG.TCP_PORT, () => {
        console.log(`[TCP] Server listening on port ${CONFIG.TCP_PORT}`);
    });
    return server;
}

function tcpPing() {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ port: CONFIG.TCP_PORT }, () => {
            client.write('ping');
        });
        client.once('data', data => {
            if (data.toString() === 'pong') resolve('TCP pong received');
            else reject(new Error('TCP unexpected response'));
            client.end();
        });
        client.once('error', reject);
    });
}

// -------------------- 2. UDP 心跳 --------------------
function startUdpServer() {
    const server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
        if (msg.toString() === 'ping') {
            server.send('pong', rinfo.port, rinfo.address);
        }
    });
    server.bind(CONFIG.UDP_PORT, () => {
        console.log(`[UDP] Server bound on port ${CONFIG.UDP_PORT}`);
    });
    return server;
}

function udpPing() {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        const message = Buffer.from('ping');
        client.send(message, CONFIG.UDP_PORT, '127.0.0.1', err => {
            if (err) return reject(err);
        });
        client.once('message', (msg) => {
            if (msg.toString() === 'pong') resolve('UDP pong received');
            else reject(new Error('UDP unexpected response'));
            client.close();
        });
        // safety timeout
        setTimeout(() => reject(new Error('UDP no response')), CONFIG.TIMEOUT_MS);
    });
}

// -------------------- 3. WebSocket 心跳 --------------------
function startWsServer() {
    const wss = new WebSocket.Server({ port: CONFIG.WS_PORT });
    wss.on('connection', ws => {
        ws.on('message', msg => {
            if (msg === 'ping') ws.send('pong');
        });
    });
    console.log(`[WebSocket] Server listening on ws://127.0.0.1:${CONFIG.WS_PORT}`);
    return wss;
}

function wsPing() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.WS_PORT}`);
        ws.on('open', () => ws.send('ping'));
        ws.on('message', msg => {
            if (msg === 'pong') resolve('WebSocket pong received');
            else reject(new Error('WebSocket unexpected response'));
            ws.close();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('WebSocket timeout')), CONFIG.TIMEOUT_MS);
    });
}

// -------------------- 4. Redis Pub/Sub 心跳 --------------------
function startRedisSubscriber() {
    const sub = redis.createClient();
    sub.on('error', err => console.error('Redis subscriber error', err));
    sub.subscribe(CONFIG.REDIS_CHANNEL);
    sub.on('message', (channel, message) => {
        if (message === 'ping') {
            const pub = redis.createClient();
            pub.publish(CONFIG.REDIS_CHANNEL, 'pong');
            pub.quit();
        }
    });
    console.log(`[Redis] Subscriber ready on channel "${CONFIG.REDIS_CHANNEL}"`);
    return sub;
}

function redisPing() {
    return new Promise((resolve, reject) => {
        const pub = redis.createClient();
        const sub = redis.createClient();

        sub.subscribe(CONFIG.REDIS_CHANNEL);
        sub.on('message', (channel, message) => {
            if (message === 'pong') {
                resolve('Redis pong received');
                sub.unsubscribe();
                sub.quit();
                pub.quit();
            }
        });

        // 发送 ping
        pub.publish(CONFIG.REDIS_CHANNEL, 'ping');

        // 超时处理
        setTimeout(() => {
            reject(new Error('Redis timeout'));
            sub.unsubscribe();
            sub.quit();
            pub.quit();
        }, CONFIG.TIMEOUT_MS);
    });
}

// -------------------- 主流程 --------------------
(async () => {
    // 启动各类服务
    const tcpSrv = startTcpServer();
    const udpSrv = startUdpServer();
    const wsSrv = startWsServer();
    const redisSub = startRedisSubscriber();

    // 等待服务稍微启动完毕
    await new Promise(r => setTimeout(r, 500));

    console.log('\n=== 开始状态检测 ===\n');

    const results = [];

    // TCP
    try {
        const res = await withTimeout(tcpPing(), CONFIG.TIMEOUT_MS, 'TCP');
        results.push(res);
    } catch (e) {
        results.push(`TCP error: ${e.message}`);
    }

    // UDP
    try {
        const res = await withTimeout(udpPing(), CONFIG.TIMEOUT_MS, 'UDP');
        results.push(res);
    } catch (e) {
        results.push(`UDP error: ${e.message}`);
    }

    // WebSocket
    try {
        const res = await withTimeout(wsPing(), CONFIG.TIMEOUT_MS, 'WebSocket');
        results.push(res);
    } catch (e) {
        results.push(`WebSocket error: ${e.message}`);
    }

    // Redis
    try {
        const res = await withTimeout(redisPing(), CONFIG.TIMEOUT_MS, 'Redis');
        results.push(res);
    } catch (e) {
        results.push(`Redis error: ${e.message}`);
    }

    console.log('\n=== 检测结果 ===');
    results.forEach(r => console.log('·', r));

    // 关闭服务（演示结束后退出进程）
    tcpSrv.close();
    udpSrv.close();
    wsSrv.close();
    redisSub.quit();

    // 稍等一下让关闭过程完成后退出
    setTimeout(() => process.exit(0), 500);
})();