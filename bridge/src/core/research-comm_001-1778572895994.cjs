// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:01:35.994Z

// file: check_sisters.js
// ------------------------------------------------------------
// 运行前请先安装 ws:  npm install ws
// ------------------------------------------------------------

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const WebSocket = require('ws');

// ------------------- 配置 -------------------
const PORTS = {
    http: 3000,
    tcp: 3001,
    udp: 3002,
    ws: 3003,
};
const HOST = '127.0.0.1';
const UDP_TIMEOUT = 2000; // ms
const CONNECT_TIMEOUT = 2000; // ms
// ------------------------------------------------

// ---------- 1. 启动各类服务 ----------
function startHttpServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/ping') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('pong');
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    server.listen(PORTS.http, HOST, () => {
        console.log(`[HTTP] listening on http://${HOST}:${PORTS.http}/ping`);
    });
    return server;
}

function startTcpServer() {
    const server = net.createServer((socket) => {
        // 简单回应
        socket.write('pong');
        socket.end();
    });
    server.listen(PORTS.tcp, HOST, () => {
        console.log(`[TCP] listening on ${HOST}:${PORTS.tcp}`);
    });
    return server;
}

function startUdpServer() {
    const server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
        if (msg.toString() === 'ping') {
            server.send('pong', rinfo.port, rinfo.address);
        }
    });
    server.bind(PORTS.udp, HOST, () => {
        console.log(`[UDP] listening on ${HOST}:${PORTS.udp}`);
    });
    return server;
}

function startWsServer() {
    const wss = new WebSocket.Server({ port: PORTS.ws, host: HOST }, () => {
        console.log(`[WebSocket] listening on ws://${HOST}:${PORTS.ws}`);
    });
    wss.on('connection', (ws) => {
        ws.send('welcome');
    });
    return wss;
}

// ---------- 2. 检测函数 ----------
function checkHttp() {
    return new Promise((resolve) => {
        http.get(`http://${HOST}:${PORTS.http}/ping`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                resolve(res.statusCode === 200 && data === 'pong');
            });
        }).on('error', () => resolve(false));
    });
}

function checkTcp() {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const cleanup = () => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(false);
            }
        };

        socket.setTimeout(CONNECT_TIMEOUT, cleanup);
        socket.connect(PORTS.tcp, HOST, () => {
            // 连接成功后立即结束，视为存活
            if (!settled) {
                settled = true;
                socket.end();
                resolve(true);
            }
        });
        socket.on('error', cleanup);
    });
}

function checkUdp() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        const timeout = setTimeout(() => {
            client.close();
            resolve(false);
        }, UDP_TIMEOUT);

        client.on('message', (msg) => {
            if (msg.toString() === 'pong') {
                clearTimeout(timeout);
                client.close();
                resolve(true);
            }
        });

        client.send('ping', PORTS.udp, HOST);
    });
}

function checkWs() {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://${HOST}:${PORTS.ws}`);

        const timer = setTimeout(() => {
            ws.terminate();
            resolve(false);
        }, CONNECT_TIMEOUT);

        ws.on('open', () => {
            // 等待服务器返回 welcome 消息
        });

        ws.on('message', (msg) => {
            if (msg.toString() === 'welcome') {
                clearTimeout(timer);
                ws.terminate();
                resolve(true);
            }
        });

        ws.on('error', () => {
            clearTimeout(timer);
            ws.terminate();
            resolve(false);
        });
    });
}

// ---------- 3. 主流程 ----------
async function main() {
    // 启动服务
    const httpSrv = startHttpServer();
    const tcpSrv = startTcpServer();
    const udpSrv = startUdpServer();
    const wsSrv = startWsServer();

    // 等待服务稍微启动完毕
    await new Promise((r) => setTimeout(r, 500));

    // 检测
    const results = await Promise.all([
        checkHttp(),
        checkTcp(),
        checkUdp(),
        checkWs(),
    ]);

    console.log('\n=== 姐妹实例状态检测结果 ===');
    console.log(`HTTP ping  : ${results[0] ? '✅ 在线' : '❌ 离线'}`);
    console.log(`TCP socket : ${results[1] ? '✅ 在线' : '❌ 离线'}`);
    console.log(`UDP ping   : ${results[2] ? '✅ 在线' : '❌ 离线'}`);
    console.log(`WebSocket  : ${results[3] ? '✅ 在线' : '❌ 离线'}`);

    // 关闭服务（演示结束后退出）
    httpSrv.close();
    tcpSrv.close();
    udpSrv.close();
    wsSrv.close();
}

main().catch((err) => {
    console.error('Unexpected error:', err);
});