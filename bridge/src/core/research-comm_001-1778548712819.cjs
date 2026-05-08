// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:18:32.819Z

// instance-monitor.js
// 用 CommonJS (require) 编写，可直接 Node.js 运行
// 运行方式：node instance-monitor.js server|client

const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');
const Redis = require('ioredis');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const os = require('os');
const { once } = require('events');

// -------------------------- 配置 --------------------------
const CONFIG = {
    // 统一使用本机环回或局域网 IP，便于在同机多实例测试
    HOST: '127.0.0.1',
    // 各种协议的端口（保持不冲突）
    TCP_PORT: 4000,
    UDP_PORT: 4001,
    WS_PORT: 4002,
    REDIS_CHANNEL: 'heartbeat',
    GRPC_PORT: 4003,
    // 心跳间隔（ms）
    INTERVAL: 2000,
    // 超时阈值（ms）
    TIMEOUT: 3000,
};

// -------------------------- 工具函数 --------------------------
function log(tag, msg) {
    const now = new Date().toISOString();
    console.log(`[${now}] [${tag}] ${msg}`);
}

// -------------------------- TCP 心跳 --------------------------
function startTcpServer() {
    const server = net.createServer(socket => {
        log('TCP', `收到连接 ${socket.remoteAddress}:${socket.remotePort}`);
        socket.on('data', data => {
            if (data.toString() === 'ping') {
                socket.write('pong');
                log('TCP', '回应 pong');
            }
        });
    });
    server.listen(CONFIG.TCP_PORT, CONFIG.HOST, () => {
        log('TCP', `监听 ${CONFIG.HOST}:${CONFIG.TCP_PORT}`);
    });
    return server;
}

function tcpPing() {
    return new Promise((resolve) => {
        const client = new net.Socket();
        const timer = setTimeout(() => {
            client.destroy();
            resolve(false);
        }, CONFIG.TIMEOUT);

        client.connect(CONFIG.TCP_PORT, CONFIG.HOST, () => {
            client.write('ping');
        });

        client.once('data', data => {
            clearTimeout(timer);
            client.end();
            resolve(data.toString() === 'pong');
        });

        client.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

// -------------------------- UDP 心跳 --------------------------
function startUdpServer() {
    const server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
        if (msg.toString() === 'ping') {
            server.send('pong', rinfo.port, rinfo.address);
            log('UDP', `回应 pong 给 ${rinfo.address}:${rinfo.port}`);
        }
    });
    server.bind(CONFIG.UDP_PORT, CONFIG.HOST, () => {
        log('UDP', `监听 ${CONFIG.HOST}:${CONFIG.UDP_PORT}`);
    });
    return server;
}

function udpPing() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const timer = setTimeout(() => {
            client.close();
            resolve(false);
        }, CONFIG.TIMEOUT);

        client.once('message', (msg) => {
            clearTimeout(timer);
            client.close();
            resolve(msg.toString() === 'pong');
        });

        client.send('ping', CONFIG.UDP_PORT, CONFIG.HOST);
    });
}

// -------------------------- WebSocket 心跳 --------------------------
function startWsServer() {
    const wss = new WebSocket.Server({ port: CONFIG.WS_PORT, host: CONFIG.HOST });
    wss.on('connection', ws => {
        log('WS', '客户端已连接');
        ws.on('message', msg => {
            if (msg === 'ping') ws.send('pong');
        });
    });
    wss.on('listening', () => {
        log('WS', `监听 ws://${CONFIG.HOST}:${CONFIG.WS_PORT}`);
    });
    return wss;
}

function wsPing() {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://${CONFIG.HOST}:${CONFIG.WS_PORT}`);
        const timer = setTimeout(() => {
            ws.terminate();
            resolve(false);
        }, CONFIG.TIMEOUT);

        ws.on('open', () => ws.send('ping'));
        ws.on('message', msg => {
            clearTimeout(timer);
            ws.close();
            resolve(msg === 'pong');
        });
        ws.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

// -------------------------- Redis Pub/Sub 心跳 --------------------------
function startRedisSubscriber() {
    const sub = new Redis();
    sub.subscribe(CONFIG.REDIS_CHANNEL, (err, count) => {
        if (!err) log('Redis', `订阅 ${CONFIG.REDIS_CHANNEL}`);
    });
    sub.on('message', (channel, message) => {
        if (channel === CONFIG.REDIS_CHANNEL && message === 'ping') {
            sub.publish(CONFIG.REDIS_CHANNEL, 'pong');
            log('Redis', '收到 ping，发布 pong');
        }
    });
    return sub;
}

function redisPing() {
    return new Promise(async (resolve) => {
        const pub = new Redis();
        const sub = new Redis();

        const timer = setTimeout(() => {
            pub.disconnect();
            sub.disconnect();
            resolve(false);
        }, CONFIG.TIMEOUT);

        await sub.subscribe(CONFIG.REDIS_CHANNEL);
        sub.on('message', (ch, msg) => {
            if (ch === CONFIG.REDIS_CHANNEL && msg === 'pong') {
                clearTimeout(timer);
                pub.disconnect();
                sub.disconnect();
                resolve(true);
            }
        });

        // 发起 ping
        pub.publish(CONFIG.REDIS_CHANNEL, 'ping');
    });
}

// -------------------------- gRPC 心跳 --------------------------
const PROTO_PATH = __dirname + '/health.proto';
const healthProto = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const healthPackage = grpc.loadPackageDefinition(healthProto).grpc.health.v1;

function startGrpcServer() {
    const server = new grpc.Server();
    server.addService(healthPackage.Health.service, {
        Check: (_, callback) => {
            callback(null, { status: healthPackage.HealthCheckResponse.ServingStatus.SERVING });
        },
    });
    server.bindAsync(`${CONFIG.HOST}:${CONFIG.GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), () => {
        server.start();
        log('gRPC', `监听 ${CONFIG.HOST}:${CONFIG.GRPC_PORT}`);
    });
    return server;
}

function grpcCheck() {
    return new Promise((resolve) => {
        const client = new healthPackage.Health(`${CONFIG.HOST}:${CONFIG.GRPC_PORT}`, grpc.credentials.createInsecure());
        const deadline = Date.now() + CONFIG.TIMEOUT;
        client.waitForReady(deadline, (err) => {
            if (err) return resolve(false);
            client.Check({}, (error, response) => {
                if (error) return resolve(false);
                resolve(response.status === healthPackage.HealthCheckResponse.ServingStatus.SERVING);
            });
        });
    });
}

// -------------------------- 主流程 --------------------------
async function main() {
    const mode = process.argv[2];
    if (!mode || !['server', 'client'].includes(mode)) {
        console.error('使用方法: node instance-monitor.js server|client');
        process.exit(1);
    }

    if (mode === 'server') {
        // 启动所有服务端
        startTcpServer();
        startUdpServer();
        startWsServer();
        startRedisSubscriber();
        startGrpcServer();
        log('MAIN', '所有服务已启动，等待客户端检测...');
    } else {
        // 客户端：周期性尝试所有方式并打印结果
        log('MAIN', '开始对姐妹实例进行状态检测...');
        while (true) {
            const results = await Promise.all([
                tcpPing(),
                udpPing(),
                wsPing(),
                redisPing(),
                grpcCheck(),
            ]);

            const methods = ['TCP', 'UDP', 'WebSocket', 'RedisPubSub', 'gRPC'];
            const line = methods.map((m, i) => `${m}:${results[i] ? 'OK' : 'FAIL'}`).join(' | ');
            console.log(`--- 检测结果 (${new Date().toISOString()}) --- ${line}`);

            await new Promise(r => setTimeout(r, CONFIG.INTERVAL));
        }
    }
}

// 运行入口
main().catch(err => {
    console.error('未捕获的异常:', err);
    process.exit(1);
});