// Research by 管家: 多通道冗余检测：HTTP无响应时，用什么备用通道确认是真的宕机？
// Generated: 2026-05-12T08:55:34.994Z

// 多通道冗余检测：HTTP无响应时，备用通道确认宕机研究
// 本代码模拟一个多通道健康检查系统，当主HTTP通道无响应时，
// 使用TCP ping、ICMP ping（通过child_process模拟）和DNS查询作为备用通道

const http = require('http');
const net = require('net');
const { exec } = require('child_process');
const dns = require('dns').promises;

// 配置：要检测的目标
const TARGET_HOST = 'example.com'; // 可改为真实目标
const TARGET_PORT = 80;
const HTTP_TIMEOUT = 3000; // 3秒超时

// 模拟的检测结果存储
const results = {
  http: null,
  tcp: null,
  ping: null,
  dns: null
};

// 主通道：HTTP GET请求检测
function checkHTTP() {
  return new Promise((resolve) => {
    const req = http.get(`http://${TARGET_HOST}:${TARGET_PORT}`, (res) => {
      resolve({ alive: true, statusCode: res.statusCode, method: 'HTTP' });
    });
    req.on('error', (err) => {
      resolve({ alive: false, error: err.message, method: 'HTTP' });
    });
    req.setTimeout(HTTP_TIMEOUT, () => {
      req.destroy();
      resolve({ alive: false, error: 'Timeout', method: 'HTTP' });
    });
  });
}

// 备用通道1：TCP端口连接检测（不发送HTTP请求，只检查端口是否开放）
function checkTCP() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ alive: true, method: 'TCP' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ alive: false, error: err.message, method: 'TCP' });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ alive: false, error: 'Timeout', method: 'TCP' });
    });
    socket.connect(TARGET_PORT, TARGET_HOST);
  });
}

// 备用通道2：ICMP Ping（通过系统命令模拟，需要系统支持ping）
function checkPing() {
  return new Promise((resolve) => {
    // 在Windows上是ping -n 1，Linux/Mac是ping -c 1
    const cmd = process.platform === 'win32' ? `ping -n 1 ${TARGET_HOST}` : `ping -c 1 ${TARGET_HOST}`;
    exec(cmd, { timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ alive: false, error: error.message, method: 'Ping' });
      } else {
        // 检查输出中是否有"TTL"或"time="等表示成功的字符串
        const isAlive = stdout.includes('TTL') || stdout.includes('time=') || stdout.includes('bytes from');
        resolve({ alive: isAlive, method: 'Ping', output: stdout.substring(0, 100) });
      }
    });
  });
}

// 备用通道3：DNS解析检测（域名能否解析出IP）
async function checkDNS() {
  try {
    const addresses = await dns.resolve4(TARGET_HOST);
    return { alive: addresses.length > 0, ips: addresses, method: 'DNS' };
  } catch (err) {
    return { alive: false, error: err.code || err.message, method: 'DNS' };
  }
}

// 主检测流程：先HTTP，若失败则并行启动备用通道
async function redundantCheck() {
  console.log(`\n========== 多通道冗余检测开始 ==========`);
  console.log(`目标: ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`时间: ${new Date().toISOString()}\n`);

  // 第一步：主通道HTTP检测
  console.log(`[主通道] HTTP检测中...`);
  results.http = await checkHTTP();
  console.log(`[主通道] HTTP结果: ${results.http.alive ? '存活' : '无响应'}`, 
    results.http.alive ? `(状态码: ${results.http.statusCode})` : `(错误: ${results.http.error})`);

  // 如果HTTP无响应，启动所有备用通道
  if (!results.http.alive) {
    console.log(`\n⚠ HTTP无响应，启动备用通道确认...\n`);

    // 并行执行三个备用通道
    const backupResults = await Promise.all([
      checkTCP(),
      checkPing(),
      checkDNS()
    ]);

    results.tcp = backupResults[0];
    results.ping = backupResults[1];
    results.dns = backupResults[2];

    // 输出每个备用通道的结果
    console.log(`[备用1-TCP] TCP端口检测: ${results.tcp.alive ? '端口开放' : '端口关闭/无响应'}`);
    if (!results.tcp.alive) console.log(`           错误: ${results.tcp.error}`);

    console.log(`[备用2-Ping] ICMP Ping检测: ${results.ping.alive ? '主机可达' : '主机不可达'}`);
    if (!results.ping.alive) console.log(`           错误: ${results.ping.error}`);

    console.log(`[备用3-DNS] DNS解析检测: ${results.dns.alive ? '域名可解析' : '解析失败'}`);
    if (results.dns.alive) console.log(`           IP: ${results.dns.ips.join(', ')}`);
    else console.log(`           错误: ${results.dns.error}`);

    // 综合判断：如果至少两个备用通道确认宕机，则判定为真宕机
    const aliveCount = [results.tcp, results.ping, results.dns].filter(r => r.alive).length;
    console.log(`\n========== 综合判定 ==========`);
    console.log(`备用通道存活数: ${aliveCount}/3`);
    if (aliveCount >= 2) {
      console.log(`结论：HTTP无响应但备用通道显示存活，可能是HTTP服务本身故障（如Web服务器进程挂掉、防火墙拦截HTTP）`);
      console.log(`建议：检查Web服务器进程、防火墙规则、代理配置`);
    } else {
      console.log(`结论：HTTP无响应且多数备用通道也失败，目标很可能真宕机`);
      console.log(`建议：检查主机电源、网络连接、路由设备`);
    }
  } else {
    console.log(`\nHTTP响应正常，无需启用备用通道。`);
  }

  console.log(`========== 检测结束 ==========\n`);
}

// 运行检测
redundantCheck().catch(err => {
  console.error('检测过程出错:', err);
});