// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:26:15.687Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');

// 模拟姐妹实例的配置
const PORT = 8080;
const UDP_PORT = 8081;
const FILE_PATH = '/tmp/sister_status.txt';

// 1. TCP Socket 通讯方式
function testTcpConnection() {
    return new Promise((resolve) => {
        const client = new net.Socket();
        client.setTimeout(2000);
        client.connect(PORT, '127.0.0.1', () => {
            console.log('TCP: 成功连接到姐妹实例');
            client.write('STATUS_CHECK\n');
            client.end();
            resolve('TCP ping 成功');
        });
        client.on('data', (data) => {
            console.log('TCP: 收到响应:', data.toString());
            resolve('TCP ping 成功');
        });
        client.on('timeout', () => {
            console.log('TCP: 连接超时');
            resolve('TCP ping 失败');
        });
        client.on('error', (err) => {
            console.log('TCP: 连接错误:', err.message);
            resolve('TCP ping 失败');
        });
    });
}

// 2. UDP 通讯方式
function testUdpMessage() {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        client.send('STATUS_CHECK', UDP_PORT, '127.0.0.1', (err) => {
            if (err) {
                console.log('UDP: 发送失败', err.message);
                resolve('UDP ping 失败');
                return;
            }
            console.log('UDP: 消息已发送');
            setTimeout(() => {
                client.close();
                resolve('UDP ping 成功');
            }, 500);
        });
    });
}

// 3. 文件系统检测方式
function testFilesystem() {
    return new Promise((resolve) => {
        fs.writeFile(FILE_PATH, 'SISTER_ALIVE', (err) => {
            if (err) {
                console.log('文件系统: 写入失败', err.message);
                resolve('文件系统检测失败');
                return;
            }
            fs.readFile(FILE_PATH, (err, data) => {
                if (err) {
                    console.log('文件系统: 读取失败', err.message);
                    resolve('文件系统检测失败');
                } else {
                    console.log('文件系统: 检测到姐妹状态文件');
                    resolve('文件系统检测成功');
                }
                fs.unlink(FILE_PATH, () => {}); // 清理
            });
        });
    });
}

// 4. HTTP 之外的其他方式：共享内存（Node.js 示例简化）
function testSharedMemory() {
    console.log('共享内存: Node.js 没有原生共享内存，但可通过 Redis 等中间件实现');
    return '共享内存检测（需外部服务）';
}

// 主函数：运行所有检测
async function main() {
    console.log('=== 实例间通讯方式研究 ===\n');
    
    // 先启动一个模拟的 TCP 服务器作为姐妹实例
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            if (data.toString().trim() === 'STATUS_CHECK') {
                socket.write('STATUS_OK\n');
            }
        });
    });
    server.listen(PORT, () => {
        console.log(`模拟姐妹实例 TCP 服务器启动在端口 ${PORT}`);
    });

    // 同时启动 UDP 服务器（简化处理）
    const udpServer = dgram.createSocket('udp4');
    udpServer.on('message', (msg, rinfo) => {
        console.log(`UDP 服务器收到: ${msg}`);
        udpServer.send('STATUS_OK', rinfo.port, rinfo.address);
    });
    udpServer.bind(UDP_PORT, () => {
        console.log(`模拟姐妹实例 UDP 服务器启动在端口 ${UDP_PORT}`);
    });

    // 等待服务器就绪
    await new Promise(r => setTimeout(r, 500));

    // 执行检测
    const results = await Promise.all([
        testTcpConnection(),
        testUdpMessage(),
        testFilesystem(),
        testSharedMemory()
    ]);

    console.log('\n=== 检测结果汇总 ===');
    results.forEach((result, i) => {
        console.log(`方式 ${i+1}: ${result}`);
    });

    // 清理服务器
    server.close();
    udpServer.close();
    console.log('\n清理完成');
}

main().catch(console.error);