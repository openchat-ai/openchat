// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:09:44.482Z

const net = require('net');

const server1 = net.createServer((client) => {
  const clientResponse = client.on('data', (chunk) => {
    const buffer = Buffer.concat(chunk.split('\n'));
    const response = buffer.toString();
    const status = response.trim().split('\n')[0];
    const body = response.trim();
    
    console.log(`服务器1响应状态: ${status}`);
    if (status === 'OK') {
      console.log('姐妹状态: 联动');
    } else {
      console.log('姐妹状态: 未响应或异常');
    }
  }, {write: true, bufferSize: 1024});
});

const server2 = net.createServer((client) => {
  const clientResponse = client.on('data', (chunk) => {
    const buffer = Buffer.concat(chunk.split('\n'));
    const response = buffer.toString();
    const status = response.trim().split('\n')[0];
    const body = response.trim();
    
    console.log(`服务器2响应状态: ${status}`);
    if (status === 'OK') {
      console.log('姐妹状态: 联动');
    } else {
      console.log('姐妹状态: 未响应或异常');
    }
  }, {write: true, bufferSize: 1024});
});

server1.setUp(() => server1.end());
server2.setUp(() => server2.end());

// 模拟检测机制（随机延迟模拟网络延迟）
setTimeout(() => {
  console.log('主线程模拟检测结果');
  if (Math.random() > 0.5) {
    console.log('结论: 姐妹状态异常');
  } else {
    console.log('结论: 姐妹状态正常');
  }
}, 1000);