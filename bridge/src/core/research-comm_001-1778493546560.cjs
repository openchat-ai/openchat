// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:59:06.560Z

const net = require('net');

const checkPort = (port) => {
  let isConnected = false;
  net.on('connect', () => {
    console.log(`连接到 ${port} 端口`);
    if (isConnected) {
      console.log('可能存在其他实例，需进一步分析');
    }
  });
  net.on('data', (data) => {
    if (data.toString().includes('其他') || data.toString().includes('连接')) {
      console.log('检测到异常连接，建议检查系统状态');
    }
  });
};

checkPort(8080);