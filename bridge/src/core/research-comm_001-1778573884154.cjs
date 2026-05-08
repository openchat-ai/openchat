// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:18:04.154Z

const net = require('net');
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('请输入目标IP地址: ', (ip) => {
  const testData = 'System 包; 检测到姐妹IP: ' + ip;
  const connection = net.createConnection({port: 8080})
    .on('data', (chunk) => {
      console.log(`收到包: ${chunk}`);
      if (chunk.includes('检测到姐妹') || chunk.includes('连接完成')) {
        console.log('系统状态更新：姐妹状态确认！');
      }
    })
    .on('end', () => {
      rl.close();
      console.log('任务完成，姐妹状态检测成功');
    });
});