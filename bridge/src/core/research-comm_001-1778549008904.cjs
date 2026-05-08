// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:23:28.904Z

// 检查网络连接状态
let 连接状态 = false;
const 检查网络 = async () => {
  try {
    const response = await fetch('https://api.example.com/network-check');
    const result = await response.json();
    连接状态 = result.status !== 'error';
    console.log('网络状态：', 连接状态);
  } catch (error) {
    console.log('网络检查失败：', error);
    连接状态 = false;
  }
};

setInterval(检查网络, 5000); // 每5秒检查一次