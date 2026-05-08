// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:41:53.250Z

const require = require('require');
const telnet = require('telnet');

try {
  const result = telnet.test('localhost', 22);
  console.log('检测到的姐妹状态：';
  console.log(result ? '✅ 服务器响应：成功'; 
  : '❌ 连接失败，尝试其他协议');
} catch (err) {
  console.log('系统异常：连接失败，可能使用其他方法检测状态');
}