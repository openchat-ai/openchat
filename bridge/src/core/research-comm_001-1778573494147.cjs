// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:11:34.147Z

// 引入必要的Node.js模块
const net = require('net');
const { promisify } = require('util');
const setTimeout = promisify(setTimeout);

// 设置姐妹进程的端口号
const SISTER_PORT = 9000;

// 创建一个用于监听的服务器
const server = net.createServer();
server.listen(SISTER_PORT, () => {
  console.log(`姐妹进程监听端口 ${SISTER_PORT} 正在运行...`);
});

// 定时检测姐妹进程是否在线
const checkSisterProcess = async () => {
  try {
    // 尝试连接到姐妹进程的端口
    const socket = net.connect(SISTER_PORT);
    socket.setTimeout(1000); // 设置超时时间为1秒

    socket.on('timeout', () => {
      console.log(`连接到端口 ${SISTER_PORT} 超时，姐妹进程可能已关闭。`);
      socket.destroy();
    });

    socket.on('connect', () => {
      console.log(`连接到端口 ${SISTER_PORT} 成功，姐妹进程在线。`);
      socket.destroy(); // 关闭连接
    });

    socket.on('error', (err) => {
      console.log(`连接到端口 ${SISTER_PORT} 出错:`, err);
      socket.destroy();
    });

    // 检测完成后关闭连接
    setTimeout(() => {
      socket.destroy();
    }, 1000);
  } catch (error) {
    console.error('检测姐妹进程出错:', error);
  }
};

// 每隔10秒检测一次姐妹进程
setInterval(checkSisterProcess, 10000);

// 代码说明:
// 1. 创建一个监听端口的服务器
// 2. 使用setTimeout实现超时功能，避免程序卡死
// 3. 通过net模块的connect方法尝试连接到姐妹进程的端口
// 4. 根据连接结果输出相应的信息
// 5. 每隔10秒重复检测一次姐妹进程状态