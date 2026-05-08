// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:17:12.641Z

const net = require('net');
const dgram = require('dgram');
const os = require('os');

// 1. 使用 UDP 广播检测
function udpBroadcastCheck() {
    const socket = dgram.createSocket('udp4');
    socket.on('listening', () => {
        const address = socket.address();
        console.log(`UDP Server listening on ${address.address}:${address.port}`);
    });
    socket.bind(41234, '0.0.0.0');
    socket.on('message', (msg, rinfo) => {
        console.log(`UDP Check: Received ${msg} from ${rinfo.address}:${rinfo.port}`);
    });
    setInterval(() => {
        socket.send(Buffer.from('ping'), 0, 4, 41234, '255.255.255.255');
    }, 5000);
}

// 2. 使用 TCP 检测
function tcpCheck() {
    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            console.log(`TCP Check: Received ${data} from ${socket.remoteAddress}`);
        });
        socket.on('end', () => {
            console.log('Client disconnected');
        });
    });
    server.listen(8080, () => {
        console.log('TCP Server listening on port 8080');
    });
    setInterval(() => {
        const client = new net.Socket();
        client.connect(8080, '127.0.0.1', () => {
            client.write('ping');
        });
        client.on('data', (data) => {
            console.log(`TCP Check: Received ${data}`);
            client.destroy();
        });
    }, 5000);
}

// 3. 使用本地文件检测
function fileCheck() {
    const fs = require('fs');
    const path = '/tmp/sister_status';
    fs.writeFileSync(path, 'alive');
    setInterval(() => {
        try {
            const data = fs.readFileSync(path, 'utf8');
            console.log(`File Check: Sister status is ${data}`);
        } catch (err) {
            console.log('File Check: Sister is down or file is not accessible');
        }
    }, 5000);
}

console.log('Starting sister instance communication checks...');
udpBroadcastCheck();
tcpCheck();
fileCheck();