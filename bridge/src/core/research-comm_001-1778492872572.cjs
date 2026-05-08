// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:47:52.572Z

const axios = require('axios');

try {
  // 尝试通过HTTP POST 检测状态
  const response = await axios.post('http://localhost:8080/status-check', { test: true });
  console.log('检测到姐妹状态：', response.data.status);
} catch (error) {
  // 若协议失败，尝试WebSocket通信
  const ws = new WebSocket('ws://example.com/status');
  ws.onopen = () => console.log('WebSocket连接建立');
  ws.onmessage = (event) => {
    console.log('WebSocket响应：', event.data);
    if (event.data.status === 'success') console.log('状态更新：成功！');
  };
}