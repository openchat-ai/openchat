// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:55:39.856Z

// 姐妹状态检测器
// 除了HTTP ping，还有哪些方式可以检测姐妹状态？

// 引入需要的模块
const WebSocket = require('ws');
const { fork } = require('child_process');
const { exec } = require('child_process');

// WebSocket 连接示例
function testWebSocket() {
  const ws = new WebSocket('ws://localhost:8081');

  ws.on('open', function() {
    console.log('WebSocket 连接已建立！');
  });

  ws.on('message', function(message) {
    console.log(`收到消息：${message}`);
  });

  ws.on('close', function() {
    console.log('WebSocket 连接已关闭！');
  });

  ws.on('error', function(error) {
    console.error('WebSocket 错误：', error);
  });
}

// 检测系统进程示例
function testSystemProcesses() {
  exec('ps -ef', (error, stdout, stderr) => {
    if (error) {
      console.error(`执行命令失败: ${error.message}`);
      return;
    }
    console.log(`系统进程输出：${stdout}`);
  });
}

// 检测文件写入示例
function testFileWrite() {
  const fs = require('fs');
  const filePath = '/tmp/testfile.txt';

  try {
    fs.writeFileSync(filePath, '测试文件写入');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) throw err;
      console.log(`文件内容：${data}`);
    });
  } catch (err) {
    console.error(`文件操作失败：${err.message}`);
  }
}

// 检测端口监听示例
function testPortListening(port) {
  const net = require('net');
  const server = net.createServer();

  server.on('listening', () => {
    console.log(`端口 ${port} 正在监听`);
  });

  server.on('error', (err) => {
    console.error(`端口监听失败：${err.message}`);
  });

  server.listen(port);
}

// 检测消息队列示例
function testMessageQueue() {
  const queue = require('cluster-message-queue');
  const mq = new queue({ name: 'MyQueue' });

  mq.on('message', (message) => {
    console.log(`收到消息：${message}`);
  });

  mq.on('error', (error) => {
    console.error(`消息队列错误：${error.message}`);
  });
}

// 主程序入口
function main() {
  console.log('开始检测姐妹状态...');
  console.log('----------------------');

  console.log('1. 测试 WebSocket 连接...');
  setTimeout(testWebSocket, 1000);

  console.log('\n2. 测试系统进程...');
  setTimeout(testSystemProcesses, 2000);

  console.log('\n3. 测试文件写入...');
  setTimeout(testFileWrite, 3000);

  console.log('\n4. 测试端口监听...');
  setTimeout(() => testPortListening(8082), 4000);

  console.log('\n5. 测试消息队列...');
  setTimeout(testMessageQueue, 5000);

  console.log('\n----------------------');
  console.log('所有检测项已完成！');
}

// 执行主程序
main();