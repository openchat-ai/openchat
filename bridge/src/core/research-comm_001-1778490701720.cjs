// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:11:41.720Z

const fs = require('fs');
const { net } = require('net');

const testMethods = ['http', 'telnet', 'ssh', 'wireshark'];
const results = [];

testMethods.forEach(method => {
  const reader = net.createConnection([method], () => {
    reader.on('data', data => results.push(data));
    reader.on('end', () => results.push('状态确认'));

  });

  reader.on('error', () => results.push('异常抛出'));
  reader.end();
  console.log(`测试方法：${method}，结果：${results.join('\n')}`);
});

results.forEach(result => console.log(result));