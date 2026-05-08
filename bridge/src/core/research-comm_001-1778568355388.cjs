// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:45:55.388Z

// file: monitor.js
// 运行方式：node monitor.js

const net = require('net');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const redis = require('redis');

// ------------------- 配置 -------------------
const TCP_PORT = 4000;                 // 用于 TCP 心跳的端口
const UNIX_SOCKET_PATH = '/tmp/sister.sock'; // Unix Domain Socket 路径
const REDIS_CHANNEL = 'sister_heartbeat';
const HEARTBEAT_TIMEOUT = 2000;        // ms
// ------------------------------------------------

// ---------- 1. 启动一个“姐妹”实例（演示用） ----------
function startSister() {
    // 这里直接 fork 一个子进程，它会打开 TCP、Unix Socket、Redis 等监听
    const sister = fork(path.join(__dirname, 'sister.js'));

    sister.on('message', (msg) => {
        console.log('[monitor] Sister child says:', msg);
    });

    return sister;
}

// ---------- 2. 检测实现 ----------
function pingTCP() {
    return new Promise((resolve) => {
        const client = net.createConnection({ port: TCP_PORT }, () => {
            client.write('ping');
        });

        client.setTimeout(HEARTBEAT_TIMEOUT, () => {
            client.destroy();
            resolve(false);
        });

        client.on('data', (data) => {
            if (data.toString() === 'pong') {
                client.end();
                resolve(true);
            }
        });

        client.on('error', () => resolve(false));
    });
}

function pingUnixSocket() {
    return new Promise((resolve) => {
        // 若系统不支持 Unix socket，直接返回 false
        if (process.platform === 'win32') return resolve(false);

        const client = net.createConnection({ path: UNIX_SOCKET_PATH }, () => {
            client.write('ping');
        });

        client.setTimeout(HEARTBEAT_TIMEOUT, () => {
            client.destroy();
            resolve(false);
        });

        client.on('data', (data) => {
            if (data.toString() === 'pong') {
                client.end();
                resolve(true);
            }
        });

        client.on('error', () => resolve(false));
    });
}

function pingIPC(childProcess) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), HEARTBEAT_TIMEOUT);
        childProcess.once('message', (msg) => {
            if (msg === 'pong_ipc') {
                clearTimeout(timeout);
                resolve(true);
            }
        });
        childProcess.send('ping_ipc');
    });
}

function pingRedis() {
    return new Promise((resolve) => {
        const sub = redis.createClient();
        const pub = redis.createClient();

        let responded = false;

        sub.subscribe(REDIS_CHANNEL);
        sub.on('message', (channel, message) => {
            if (channel === REDIS_CHANNEL && message === 'pong') {
                responded = true;
                cleanup();
                resolve(true);
            }
        });

        // 发送 ping
        pub.publish(REDIS_CHANNEL, 'ping');

        const timer = setTimeout(() => {
            if (!responded) {
                cleanup();
                resolve(false);
            }
        }, HEARTBEAT_TIMEOUT);

        function cleanup() {
            clearTimeout(timer);
            sub.unsubscribe();
            sub.quit();
            pub.quit();
        }
    });
}

function pingFileFlag() {
    return new Promise((resolve) => {
        const flagPath = path.join(__dirname, 'sister_alive.flag');

        // 先检查文件是否已存在
        if (fs.existsSync(flagPath)) {
            resolve(true);
            return;
        }

        // 监听文件创建
        const watcher = fs.watch(__dirname, (event, filename) => {
            if (filename === 'sister_alive.flag') {
                watcher.close();
                resolve(true);
            }
        });

        // 超时处理
        setTimeout(() => {
            watcher.close();
            resolve(false);
        }, HEARTBEAT_TIMEOUT);
    });
}

// ---------- 3. 主流程 ----------
(async () => {
    console.log('--- 启动姐妹实例（sister.js） ---');
    const sister = startSister();

    // 给姐妹进程一点时间完成监听
    await new Promise(r => setTimeout(r, 500));

    console.log('\n--- 开始检测姐妹状态 ---');

    const results = await Promise.all([
        pingTCP().then(ok => ({ method: 'TCP Socket', ok })),
        pingUnixSocket().then(ok => ({ method: 'Unix Domain Socket', ok })),
        pingIPC(sister).then(ok => ({ method: 'IPC (child_process)', ok })),
        pingRedis().then(ok => ({ method: 'Redis Pub/Sub', ok })),
        pingFileFlag().then(ok => ({ method: 'File Flag', ok })),
    ]);

    results.forEach(r => {
        console.log(`${r.method} => ${r.ok ? 'ONLINE' : 'OFFLINE'}`);
    });

    // 结束姐妹进程
    sister.kill();
    // 清理 Unix socket 文件（如果有的话）
    if (fs.existsSync(UNIX_SOCKET_PATH)) fs.unlinkSync(UNIX_SOCKET_PATH);
    // 清理文件标记
    const flagPath = path.join(__dirname, 'sister_alive.flag');
    if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
})();