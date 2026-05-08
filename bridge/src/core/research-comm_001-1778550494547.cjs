// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:48:14.547Z

const net = require('net');
const dns = require('dns');

// 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// 研究结果：
// 1. TCPping：使用TCP协议发送SYN包，检测是否有响应。
// 2. UDPping：使用UDP协议发送包，检测是否有响应。
// 3. ICMPping：使用ICMP协议发送回显请求包，检测是否有响应。
// 4. DNS解析：解析姐妹实例的域名，检测是否可以解析。

// 函数：TCPping
function tcpPing(host, port) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// 函数：UDPPing
function udpPing(host, port) {
  return new Promise((resolve, reject) => {
    const socket = require('dgram').createSocket('udp4');
    socket.send('ping', port, host, (error) => {
      if (error) {
        resolve(false);
      } else {
        socket.once('message', () => {
          resolve(true);
        });
        setTimeout(() => {
          resolve(false);
        }, 1000);
      }
    });
  });
}

// 函数：ICMPping
function icmpPing(host) {
  return new Promise((resolve, reject) => {
    const childProcess = require('child_process');
    childProcess.exec(`ping -c 1 ${host}`, (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// 函数：DNS解析
function dnsResolve(host) {
  return new Promise((resolve, reject) => {
    dns.resolve4(host, (error, addresses) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// 研究
async function research() {
  const host = 'www.example.com';
  const port = 80;

  console.log('TCPping:', await tcpPing(host, port));
  console.log('UDPPing:', await udpPing(host, port));
  console.log('ICMPping:', await icmpPing(host));
  console.log('DNS解析:', await dnsResolve(host));
}

research();