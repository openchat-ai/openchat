// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:19:47.542Z

const net = require('net');
const client = net.createConnection({port: 12345}, () => {
  console.log('检测姐妹状态：已经建立连接');
  const message = '在线检测已完成';
  client.write(message, 0, 12345)
    .on('data', data => {
      console.log(`接收到数据: ${data}`);
      console.log('系统状态更新：确认姐妹间通信成功');
    })
    .on('end', () => {
      console.log('协议通信正常终止');
    });
});