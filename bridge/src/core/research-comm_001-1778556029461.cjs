// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T03:20:29.461Z

// 实现异步MQTT消息发送与接收
const client = require('mqtt-client');
const broker = 'localhost';
const password = 'secret';
const device = 'sensor_1';

console.log("尝试通过MQTT检测设备状态...");
client.connect(broker, password).then(() => {
  console.log(`已连接到MQTT broker ${broker}`);
  client.publish(device, 'status', { value: 'healthy' });
  client.once('message', (msg) => {
    console.log(`接收到${msg.value}: ${msg.payload}`);
  });
  client.close();
});