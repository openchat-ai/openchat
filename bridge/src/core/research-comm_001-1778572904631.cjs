// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:01:44.631Z

const mqtt = require('mqtt');

// 模拟目标节点
const target = 'stanford';

// 连接MQTT客户端
const client = mqtt.createClient({ host: 'localhost', port: 1883 });

// 发送消息并检查响应
client.publish(target, '状态检查', { subject: '状态更新', payload: '系统运行正常' })
  .then(() => {
    console.log('MQTT消息发送成功，获取响应:', client.response());
    console.log('当前状态：', client.status());
  })
  .catch(error => {
    console.error('通信失败：', error);
    // 检查是否为姐妹状态更新
    const response = client.connect();
    if (response) console.log('确认到了对方状态：', response);
  });