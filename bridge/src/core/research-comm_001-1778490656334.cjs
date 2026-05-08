// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:10:56.334Z

// 创建两个客户端，尝试建立通信
const client1 = require('net').connect('socket1:1234', {port: 1234});
const client2 = require('net').connect('socket2:1234', {port: 1234});

// 发送测试消息
await client1.write('测试请求');
await client2.receive();

// 接收响应
console.log('通信建立成功：');

// 模拟响应（实际需实现接收逻辑）
await client2.write('响应已收到');
console.log('接收结果：');

// 结束关联
await client1.close();
await client2.close();