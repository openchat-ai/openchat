// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:24:46.314Z

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('=== 实例间通讯方式研究 ===\n');

// 1. TCP Socket 心跳检测
function tcpHeartbeatDemo() {
    console.log('1. TCP Socket 心跳检测:');
    console.log('   - 实例通过建立TCP连接来确认对方存活');
    console.log('   - 适用于可靠的状态通告场景');
    console.log('   - 优点：Connection-oriented, 可靠传输');
    console.log('   - 缺点：需要维护连接状态\n');
}

// 2. UDP 广播/组播探测
function udpDiscoveryDemo() {
    console.log('2. UDP 广播/组播探测:');
    console.log('   - 实例通过UDP广播发现网络中的其他实例');
    console.log('   - 适用于服务发现场景');
    console.log('   - 优点：轻量、无需连接');
    console.log('   - 缺点：不可靠、可能丢包\n');
}

// 3. 文件系统共享状态
function fileShareDemo() {
    console.log('3. 文件系统共享状态:');
    console.log('   - 实例通过读写共享文件来交换状态');
    console.log('   - 适用于简单的文件锁或状态标志');
    console.log('   - 优点：简单、跨平台');
    console.log('   - 缺点：存在竞争条件、性能差\n');
}

// 4. Redis Pub/Sub 消息通知
function redisPubSubDemo() {
    console.log('4. Redis Pub/Sub 消息通知:');
    console.log('   - 实例通过Redis订阅主题进行状态通告');
    console.log('   - 适用于分布式系统的实时通知');
    console.log('   - 优点：解耦、实时、可扩展');
    console.log('   - 缺点：需要额外Redis服务\n');
}

// 5. IPC (进程间通讯) - Unix Domain Socket
function ipcDemo() {
    console.log('5. IPC - Unix 域套接字:');
    console.log('   - 实例间通过本地套接字进行通讯');
    console.log('   - 适用于本地进程间状态检测');
    console.log('   - 优点：高性能、低延迟');
    console.log('   - 缺点：仅限本地系统\n');
}

// 6. 共享内存
function sharedMemoryDemo() {
    console.log('6. 共享内存:');
    console.log('   - 实例通过共享内存段读写状态');
    console.log('   - 适用于高性能状态共享');
    console.log('   - 优点： extremely fast, 低延迟');
    console.log('   - 缺点：需要处理同步问题\n');
}

// 7. 数据库共享状态
function databaseShareDemo() {
    console.log('7. 数据库共享状态:');
    console.log('   - 实例通过数据库表来更新和读取状态');
    console.log('   - 适用于持久化状态管理');
    console.log('   - 优点：持久化、事务支持');
    console.log('   - 缺点：性能开销、依赖数据库\n');
}

// 演示具体实现
async function demonstrateImplementations() {
    console.log('=== 具体实现演示 ===\n');
    
    // TCP 服务器端
    const tcpServer = net.createServer((socket) => {
        socket.write('ALIVE');
        socket.end();
    });
    
    tcpServer.listen(9876, () => {
        console.log('TCP 服务器启动，监听 9876 端口');
        
        // TCP 客户端检测
        const client = new net.Socket();
        client.connect(9876, () => {
            client.on('data', (data) => {
                console.log('TCP 检测结果:', data.toString());
                client.destroy();
                tcpServer.close();
            });
        });
        client.on('close', () => process.exit(0));
        client.on('error', (err) => {
            console.log('TCP 检测失败:', err.message);
            tcpServer.close();
        });
    });
    
    // UDP 广播演示
    const udpServer = dgram.createSocket('udp4');
    const UDP_PORT = 9877;
    
    udpServer.on('message', (msg, rinfo) => {
        console.log('UDP 收到消息:', msg.toString(), '来自:', rinfo.address);
    });
    
    udpServer.bind(UDP_PORT, () => {
        console.log('UDP 服务器启动，监听', UDP_PORT, '端口');
        
        // 模拟 UDP 广播
        setTimeout(() => {
            const buf = Buffer.from('HEARTBEAT');
            udpServer.send(buf, 0, buf.length, UDP_PORT, 'localhost', (err) => {
                if (err) console.log('UDP 发送失败:', err);
                else console.log('UDP 广播消息已发送');
            });
        }, 100);
    });
    
    // 文件状态演示
    const stateFile = path.join(__dirname, 'instance_state.txt');
    try {
        fs.writeFileSync(stateFile, JSON.stringify({
            instanceId: crypto.randomBytes(4).toString('hex'),
            timestamp: Date.now(),
            status: 'ALIVE'
        }));
        console.log('状态文件已创建:', stateFile);
        
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        console.log('读取的状态:', state);
        
        fs.unlinkSync(stateFile);
    } catch (err) {
        console.log('文件操作出错:', err.message);
    }
    
    // 延迟退出
    setTimeout(() => {
        udpServer.close();
        console.log('\n=== 研究总结 ===');
        console.log('除了HTTP ping，常用的实例间通讯方式：');
        console.log('1. TCP Socket - 可靠的连接检测');
        console.log('2. UDP 广播 - 轻量级发现');
        console.log('3. Redis Pub/Sub - 分布式消息');
        console.log('4. IPC/共享内存 - 高性能本地通信');
        console.log('5. 数据库共享 - 持久化状态');
        console.log('6. 文件系统 - 简单共享');
        process.exit(0);
    }, 500);
}

demonstrateImplementations().catch(console.error);