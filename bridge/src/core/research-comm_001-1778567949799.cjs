// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:39:09.799Z

// 实例间通讯方式研究：检测姐妹状态的方法
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const os = require('os');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. HTTP Ping (基础方式)
function httpPing(host, port, callback) {
    const options = {
        hostname: host,
        port: port,
        path: '/',
        method: 'GET',
        timeout: 2000
    };
    
    const req = http.request(options, (res) => {
        callback(null, `HTTP Ping 成功: 状态码 ${res.statusCode}`);
    });
    
    req.on('error', (err) => {
        callback(err.message);
    });
    
    req.on('timeout', () => {
        req.destroy();
        callback('超时');
    });
    
    req.end();
}

// 2. TCP Socket 检测
function tcpCheck(host, port, callback) {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    
    socket.connect(port, host, () => {
        socket.destroy();
        callback(null, 'TCP Socket 检测成功: 端口可达');
    });
    
    socket.on('error', (err) => {
        callback(err.message);
    });
    
    socket.on('timeout', () => {
        socket.destroy();
        callback('超时');
    });
}

// 3. UDP 心跳包
function udpHeartbeat(port, callback) {
    const server = dgram.createSocket('udp4');
    const client = dgram.createSocket('udp4');
    
    server.on('message', (msg, rinfo) => {
        console.log(`收到UDP响应: ${msg}`);
        server.close();
        client.close();
        callback(null, 'UDP 心跳包成功');
    });
    
    server.on('error', (err) => {
        server.close();
        client.close();
        callback(err.message);
    });
    
    server.bind(port);
    
    setTimeout(() => {
        client.send('heartbeat', 0, 'localhost', port, (err) => {
            if (err) {
                callback(err.message);
            }
        });
    }, 500);
}

// 4. 文件系统心跳
function fsHeartbeat(filepath, callback) {
    const check = (path) => {
        fs.stat(path, (err, stats) => {
            if (err) {
                callback(err.message);
            } else {
                const age = Date.now() - stats.mtime.getTime();
                if (age < 5000) { // 5秒内修改过
                    callback(null, `文件系统心跳成功: 文件 ${path} 在 ${Math.floor(age/1000)}秒前更新`);
                } else {
                    callback('心跳超时: 文件超过5秒未更新');
                }
            }
        });
    };
    
    // 确保文件存在
    fs.writeFile(filepath, Date.now().toString(), { flag: 'w' }, (err) => {
        if (err) {
            callback(err.message);
        } else {
            setTimeout(() => check(filepath), 100);
        }
    });
}

// 5. 端口扫描 (检测开放端口)
function portScan(startPort, endPort, callback) {
    const openPorts = [];
    
    for (let port = startPort; port <= endPort; port++) {
        const socket = new net.Socket();
        socket.setTimeout(500);
        
        const checkPort = (p, index) => {
            socket.connect(p, 'localhost', () => {
                openPorts.push(p);
                socket.destroy();
                if (index < endPort - startPort) {
                    checkPort(p + 1, index + 1);
                } else {
                    callback(null, `端口扫描完成: 开放端口 ${openPorts.join(', ')}`);
                }
            });
            
            socket.on('error', () => {
                if (index < endPort - startPort) {
                    checkPort(p + 1, index + 1);
                } else {
                    callback(null, `端口扫描完成: 开放端口 ${openPorts.join(', ')}`);
                }
            });
        };
        
        checkPort(port, 0);
        return; // 避免递归过深
    }
}

// 6. 系统信息检测
function systemCheck() {
    const interfaces = os.networkInterfaces();
    const uptime = os.uptime();
    
    console.log('\n=== 系统信息 ===');
    console.log(`运行时间: ${Math.floor(uptime/3600)}小时 ${Math.floor((uptime%3600)/60)}分钟`);
    
    Object.keys(interfaces).forEach(name => {
        interfaces[name].forEach(iface => {
            if (iface.family === 'IPv4') {
                console.log(`网卡 ${name}: ${iface.address}`);
            }
        });
    });
}

// 执行检测
console.log('开始检测实例间通讯方式...\n');

// 模拟HTTP服务
const httpServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(8080, () => {
    console.log('HTTP服务启动在端口 8080');
});

// 执行各种检测方法
setTimeout(() => {
    console.log('\n--- 方法1: HTTP Ping ---');
    httpPing('localhost', 8080, (err, result) => {
        console.log(result || err);
    });
    
    setTimeout(() => {
        console.log('\n--- 方法2: TCP Socket 检测 ---');
        tcpCheck('localhost', 8080, (err, result) => {
            console.log(result || err);
        });
        
        setTimeout(() => {
            console.log('\n--- 方法3: UDP 心跳包 ---');
            udpHeartbeat(8081, (err, result) => {
                console.log(result || err);
            });
            
            setTimeout(() => {
                console.log('\n--- 方法4: 文件系统心跳 ---');
                fsHeartbeat('./heartbeat.txt', (err, result) => {
                    console.log(result || err);
                });
                
                setTimeout(() => {
                    console.log('\n--- 方法5: 端口扫描 ---');
                    portScan(8080, 8085, (err, result) => {
                        console.log(result || err);
                    });
                    
                    setTimeout(() => {
                        systemCheck();
                        console.log('\n=== 研究结论 ===');
                        console.log('除HTTP ping外，检测姐妹状态的方式包括:');
                        console.log('1. TCP Socket连接检测 - 检测端口可达性');
                        console.log('2. UDP心跳包 - 轻量级双向通信');
                        console.log('3. 文件系统心跳 - 通过共享文件检测存活');
                        console.log('4. 端口扫描 - 发现开放服务和端口');
                        console.log('5. 系统信息对比 - 比较运行时间、IP等');
                        console.log('\n每种方式有不同的适用场景和性能特点。');
                        
                        httpServer.close();
                    }, 1000);
                }, 1000);
            }, 2000);
        }, 1000);
    }, 1000);
}, 1000);