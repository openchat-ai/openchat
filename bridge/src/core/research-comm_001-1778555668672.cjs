// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:14:28.672Z

const socket = new WebSocket('wss://localhost:8080');
socket.onopen = () => {
  console.log('连接建立，调试状态');
  socket.send('初始状态调试');
};
socket.onmessage = (event) => {
  console.log(`接收到消息: ${event.data}`);
  console.log('系统状态更新:', event.data);
};