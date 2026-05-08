// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:22:43.307Z

// 引入需要的模块
const net = require('net');
const { promisify } = require('util');
const fs = require('fs');

// 创建一个名为 'research.js' 的文件，用于记录研究结果
fs.open('research.js', 'w', (err, fd) => {
  if (err) {
    console.error('创建文件失败:', err);
    return;
  }
  fs.close(fd);
});

// 定义一个函数，用于创建一个 socket 连接到指定的服务器
const createSocket = (host, port) => {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.connect(port, host, () => {
      socket.destroy(); // 为了测试，连接成功后立即关闭socket
      resolve(socket);
    });
  });
};

// 定义一个函数，用于发送一个消息到指定的服务器
const sendMessage = async (socket, message) => {
  try {
    await new Promise((resolve, reject) => {
      socket.write(message, 'utf8', () => {
        console.log(`已发送消息: ${message}`);
        resolve();
      });
    });
    console.log('消息发送成功');
  } catch (err) {
    console.error('发送消息失败:', err);
  }
};

// 定义一个函数，用于监听来自指定服务器的消息
const listenMessage = async (socket) => {
  try {
    socket.on('data', (data) => {
      console.log('接收到消息:', data.toString());
    });
    socket.on('error', (err) => {
      console.error('监听消息错误:', err);
    });
  } catch (err) {
    console.error('监听消息失败:', err);
  }
};

// 定义一个函数，用于检测姐妹状态
const checkSistersStatus = async (sisters) => {
  for (const [host, port] of sisters) {
    console.log(`正在尝试连接到 ${host}:${port} ...`);
    const socket = await createSocket(host, port);
    await sendMessage(socket, 'ping');
    await listenMessage(socket);
  }
};

// 定义姐妹列表
const sisters = [
  ['127.0.0.1', 3000], // 本地服务器
  ['localhost', 3000], // 本地服务器（别名）
  // 可以添加其他服务器的地址
];

// 执行检测姐妹状态的函数
checkSistersStatus(sisters)
  .catch((err) => {
    console.error('检测姐妹状态失败:', err);
  });