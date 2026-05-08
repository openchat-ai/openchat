// Research by 管家: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:20:47.557Z

const { fetch } = require('node-fetch');

function checkNetworkStatus(hosts) {
  const results = [];
  hosts.forEach(host => {
    fetch(`http://localhost:8080/ping?host=${host}`)
      .then(r => r.text())
      .then(data => {
        results.push(`
         检测到 ${host}: 状态 ${data.status} | 特性 ${data.method}`);
        console.log(`${host} 状态确认：${results.find(r => r === data)}`);
      })
      .catch(err => {
        console.log(`${host} 检测失败：${err.message}`);
      });
  });
  return results;
}

const systemHosts = ['192.168.1.1', '10.0.0.1'];
const statusResults = checkNetworkStatus(systemHosts);
console.log('网络状态分析结果：', statusResults);