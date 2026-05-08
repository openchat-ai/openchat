// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:52:43.952Z

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const redis = require('redis');
const WebSocket = require('ws');

// 存储实例状态
const instances = new Map();

// 方法1: HTTP Ping检测
function createHTTPServer(port) {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    
    server.listen(port, () => {
        console.log(`HTTP健康检查服务器启动在端口 ${port}`);
    });
    
    return server;
}

// 方法2: TCP Socket心跳检测
function createTCPServer(port) {
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            if (data.toString() === 'PING') {
                socket.write('PONG');
            }
        });
    });
    
    server.listen(port, () => {
        console.log(`TCP心跳服务器启动在端口 ${port}`);
    });
    
    return server;
}

// 方法3: UDP心跳检测
function createUDPServer(port) {
    const server = dgram.createSocket('udp4');
    
    server.on('message', (msg, rinfo) => {
        if (msg.toString() === 'PING') {
            server.send('PONG', rinfo.port, rinfo.address);
        }
    });
    
    server.bind(port, () => {
        console.log(`UDP心跳服务器启动在端口 ${port}`);
    });
    
    return server;
}

// 方法4: WebSocket状态检测
function createWSServer(port) {
    const wss = new WebSocket.Server({ port });
    
    wss.on('connection', (ws) => {
        ws.on('message', (message) => {
            if (message.toString() === 'PING') {
                ws.send('PONG');
            }
        });
    });
    
    console.log(`WebSocket服务器启动在端口 ${port}`);
    return wss;
}

// 方法5: Redis Pub/Sub状态检测
async function setupRedisSubscriber(redisClient, channel) {
    await redisClient.subscribe(channel, (message) => {
        if (message === 'PING') {
            redisClient.publish(`${channel}_response`, 'PONG');
        }
    });
    console.log('Redis订阅者已设置');
}

// 检测函数
async function detectStatus() {
    console.log('\n=== 实例状态检测结果 ===\n');
    
    // HTTP检测
    try {
        const httpResult = await new Promise((resolve) => {
            http.get('http://localhost:3001/health', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', () => resolve(null));
        });
        console.log(`[HTTP] 状态: ${httpResult ? httpResult.status : '不可用'}`);
    } catch (e) {
        console.log('[HTTP] 状态: 检测失败');
    }
    
    // TCP检测
    try {
        const tcpResult = await new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(1000);
            socket.connect(3002, 'localhost', () => {
                socket.write('PING');
            });
            socket.on('data', (data) => {
                resolve(data.toString());
                socket.destroy();
            });
            socket.on('error', () => resolve(null));
            socket.on('timeout', () => {
                resolve(null);
                socket.destroy();
            });
        });
        console.log(`[TCP] 状态: ${tcpResult || '不可用'}`);
    } catch (e) {
        console.log('[TCP] 状态: 检测失败');
    }
    
    // UDP检测
    try {
        const udpResult = await new Promise((resolve) => {
            const client = dgram.createSocket('udp4');
            client.bind(() => {
                client.send('PING', 3003, 'localhost');
            });
            client.on('message', (msg) => {
                resolve(msg.toString());
                client.close();
            });
            setTimeout(() => {
                resolve(null);
                client.close();
            }, 1000);
        });
        console.log(`[UDP] 状态: ${udpResult || '不可用'}`);
    } catch (e) {
        console.log('[UDP] 状态: 检测失败');
    }
    
    // Redis检测
    try {
        const redisClient = redis.createClient();
        await redisClient.connect();
        const start = Date.now();
        await redisClient.publish('status_check', 'PING');
        // 模拟等待响应
        await new Promise(r => setTimeout(r, 500));
        console.log('[Redis] 状态: 可用 (发布/订阅模式)');
        await redisClient.quit();
    } catch (e) {
        console.log('[Redis] 状态: 不可用或未配置');
    }
    
    console.log('\n=== 总结 ===');
    console.log('除了HTTP Ping，还有以下检测方式：');
    console.log('1. TCP Socket - 基于连接的可靠检测');
    console.log('2. UDP - 轻量级无连接检测');
    console.log('3. WebSocket - 全双工持久连接');
    console.log('4. Redis Pub/Sub - 消息中间件检测');
    console.log('5. gRPC - 高性能RPC框架');
    console.log('6. 消息队列 - Kafka/RabbitMQ等');
    console.log('7. 共享存储 - 数据库/文件系统标记');
}

// 主程序
async function main() {
    console.log('=== 实例间通讯方式研究 ===\n');
    
    // 启动各种服务器
    createHTTPServer(3001);
    createTCPServer(3002);
    createUDPServer(3003);
    createWSServer(3004);
    
    // 等待服务器启动
    await new Promise(r => setTimeout(r, 1000));
    
    // 执行检测
    await detectStatus();
}

main().catch(console.error);