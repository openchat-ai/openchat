// Research by 小红: 多通道冗余检测：HTTP无响应时，用什么备用通道确认是真的宕机？
// Generated: 2026-05-12T08:56:02.770Z

// 多通道冗余检测：HTTP无响应时的备用通道确认方案
// 本代码模拟了多通道检测机制，包含HTTP、Ping、TCP端口和DNS查询四种通道
// 当HTTP无响应时，自动启用备用通道进行确认

const dns = require('dns');
const net = require('net');
const { exec } = require('child_process');
const http = require('http');

// 模拟的目标服务器（实际使用时替换为真实地址）
const TARGET_HOST = 'example.com';
const TARGET_PORT = 80;
const HTTP_TIMEOUT = 3000; // HTTP超时时间（毫秒）

// 通道状态记录
const channelResults = {
  http: null,
  ping: null,
  tcp: null,
  dns: null
};

// 主HTTP检测
function checkHTTP(host, port, timeout) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, { timeout }, (res) => {
      resolve({ alive: true, statusCode: res.statusCode, channel: 'http' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ alive: false, error: 'HTTP超时', channel: 'http' });
    });
    req.on('error', (err) => {
      resolve({ alive: false, error: err.message, channel: 'http' });
    });
  });
}

// 备用通道1: Ping检测
function checkPing(host) {
  return new Promise((resolve) => {
    // Windows使用 -n, Linux/Mac使用 -c
    const cmd = process.platform === 'win32' ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;
    exec(cmd, { timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ alive: false, error: error.message, channel: 'ping' });
      } else {
        // 检查输出中是否包含成功标志
        const isAlive = stdout.includes('TTL=') || stdout.includes('1 received') || stdout.includes('time=');
        resolve({ alive: isAlive, detail: stdout.substring(0, 100), channel: 'ping' });
      }
    });
  });
}

// 备用通道2: TCP端口检测
function checkTCP(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve({ alive: true, channel: 'tcp' });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ alive: false, error: 'TCP连接超时', channel: 'tcp' });
    });
    socket.on('error', (err) => {
      resolve({ alive: false, error: err.message, channel: 'tcp' });
    });
    socket.connect(port, host);
  });
}

// 备用通道3: DNS解析检测
function checkDNS(host) {
  return new Promise((resolve) => {
    dns.resolve(host, (err, addresses) => {
      if (err) {
        resolve({ alive: false, error: err.code, channel: 'dns' });
      } else {
        resolve({ alive: true, addresses: addresses, channel: 'dns' });
      }
    });
  });
}

// 主检测流程
async function multiChannelDetection() {
  console.log('========================================');
  console.log('多通道冗余检测系统启动');
  console.log(`目标: ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`时间: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // 第一步：HTTP检测
  console.log('[1/4] 主通道HTTP检测中...');
  const httpResult = await checkHTTP(TARGET_HOST, TARGET_PORT, HTTP_TIMEOUT);
  channelResults.http = httpResult;
  console.log(`      HTTP结果: ${httpResult.alive ? '✅ 正常' : '❌ 无响应'}`);
  if (httpResult.statusCode) console.log(`      状态码: ${httpResult.statusCode}`);
  if (httpResult.error) console.log(`      错误: ${httpResult.error}`);
  console.log('');

  // 如果HTTP无响应，启用备用通道
  if (!httpResult.alive) {
    console.log('⚠️ HTTP无响应，启动备用通道检测...\n');

    // 并行执行所有备用通道
    console.log('[2/4] 备用通道1: Ping检测中...');
    console.log('[3/4] 备用通道2: TCP端口检测中...');
    console.log('[4/4] 备用通道3: DNS解析检测中...\n');

    const [pingResult, tcpResult, dnsResult] = await Promise.all([
      checkPing(TARGET_HOST),
      checkTCP(TARGET_HOST, TARGET_PORT),
      checkDNS(TARGET_HOST)
    ]);

    channelResults.ping = pingResult;
    channelResults.tcp = tcpResult;
    channelResults.dns = dnsResult;

    // 输出备用通道结果
    console.log('--- 备用通道检测结果 ---');
    console.log(`Ping: ${pingResult.alive ? '✅ 可达' : '❌ 不可达'}`);
    if (pingResult.detail) console.log(`     详情: ${pingResult.detail}`);
    if (pingResult.error) console.log(`     错误: ${pingResult.error}`);

    console.log(`TCP:  ${tcpResult.alive ? '✅ 端口开放' : '❌ 端口关闭或不可达'}`);
    if (tcpResult.error) console.log(`     错误: ${tcpResult.error}`);

    console.log(`DNS:  ${dnsResult.alive ? '✅ 解析成功' : '❌ 解析失败'}`);
    if (dnsResult.addresses) console.log(`     IP地址: ${dnsResult.addresses.join(', ')}`);
    if (dnsResult.error) console.log(`     错误: ${dnsResult.error}`);
    console.log('');

    // 综合分析
    console.log('--- 综合分析 ---');
    const aliveChannels = [pingResult, tcpResult, dnsResult].filter(r => r.alive).length;
    
    if (aliveChannels >= 2) {
      console.log('🟢 结论: 服务器大概率正常运行，HTTP服务可能存在问题');
      console.log('   建议: 检查HTTP服务配置、防火墙规则或负载均衡器');
    } else if (aliveChannels === 1) {
      console.log('🟡 结论: 服务器可能部分不可达，存在网络或服务问题');
      console.log('   建议: 检查网络连接、服务器负载或DNS配置');
    } else {
      console.log('🔴 结论: 服务器很可能宕机或完全不可达');
      console.log('   建议: 立即通知运维团队进行紧急排查');
    }
    
    console.log(`\n备用通道存活数: ${aliveChannels}/3`);
  } else {
    console.log('✅ HTTP响应正常，无需启动备用通道');
    console.log('   系统运行正常');
  }

  // 输出完整报告
  console.log('\n========================================');
  console.log('检测报告摘要');
  console.log('========================================');
  console.log(`HTTP: ${channelResults.http ? (channelResults.http.alive ? '正常' : '无响应') : '未检测'}`);
  console.log(`Ping: ${channelResults.ping ? (channelResults.ping.alive ? '可达' : '不可达') : '未检测'}`);
  console.log(`TCP:  ${channelResults.tcp ? (channelResults.tcp.alive ? '开放' : '关闭') : '未检测'}`);
  console.log(`DNS:  ${channelResults.dns ? (channelResults.dns.alive ? '正常' : '异常') : '未检测'}`);
  console.log('========================================');
}

// 运行主检测
multiChannelDetection().catch(err => {
  console.error('检测过程出错:', err);
});