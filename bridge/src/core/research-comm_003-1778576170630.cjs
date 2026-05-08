// Research by 管家: 多通道冗余检测：HTTP无响应时，用什么备用通道确认是真的宕机？
// Generated: 2026-05-12T08:56:10.630Z

// 多通道冗余检测系统 - 用于确认HTTP服务是否真的宕机
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { exec } = require('child_process');

class MultiChannelDetector {
  constructor(targetHost, targetPort = 80) {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.results = [];
  }

  // 通道1: HTTP请求检测
  async checkHTTP() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const req = http.get(`http://${this.targetHost}:${this.targetPort}`, {
        timeout: 5000
      }, (res) => {
        const latency = Date.now() - startTime;
        resolve({
          channel: 'HTTP',
          status: 'online',
          statusCode: res.statusCode,
          latency: `${latency}ms`,
          message: `HTTP响应正常，状态码: ${res.statusCode}`
        });
      });

      req.on('error', (err) => {
        resolve({
          channel: 'HTTP',
          status: 'timeout_or_error',
          latency: `${Date.now() - startTime}ms`,
          message: `HTTP无响应: ${err.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          channel: 'HTTP',
          status: 'timeout',
          latency: '5000ms',
          message: 'HTTP请求超时(5秒)'
        });
      });
    });
  }

  // 通道2: TCP端口检测
  async checkTCP() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      
      socket.setTimeout(3000);
      
      socket.connect(this.targetPort, this.targetHost, () => {
        const latency = Date.now() - startTime;
        socket.destroy();
        resolve({
          channel: 'TCP',
          status: 'online',
          latency: `${latency}ms`,
          message: `TCP端口${this.targetPort}开放`
        });
      });

      socket.on('error', (err) => {
        socket.destroy();
        resolve({
          channel: 'TCP',
          status: 'offline',
          latency: `${Date.now() - startTime}ms`,
          message: `TCP连接失败: ${err.message}`
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          channel: 'TCP',
          status: 'timeout',
          latency: '3000ms',
          message: 'TCP连接超时(3秒)'
        });
      });
    });
  }

  // 通道3: DNS解析检测
  async checkDNS() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      dns.resolve(this.targetHost, (err, addresses) => {
        const latency = Date.now() - startTime;
        
        if (err) {
          resolve({
            channel: 'DNS',
            status: 'failed',
            latency: `${latency}ms`,
            message: `DNS解析失败: ${err.message}`
          });
        } else {
          resolve({
            channel: 'DNS',
            status: 'success',
            latency: `${latency}ms`,
            message: `DNS解析成功: ${addresses.join(', ')}`,
            addresses: addresses
          });
        }
      });
    });
  }

  // 通道4: Ping检测 (通过系统命令)
  async checkPing() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const platform = process.platform;
      const cmd = platform === 'win32' 
        ? `ping -n 1 ${this.targetHost}`
        : `ping -c 1 ${this.targetHost}`;

      exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
        const latency = Date.now() - startTime;
        
        if (error) {
          resolve({
            channel: 'Ping',
            status: 'failed',
            latency: `${latency}ms`,
            message: `Ping失败: ${error.message}`
          });
        } else {
          // 解析ping结果中的延迟信息
          const pingMatch = stdout.match(/time[=<]\s*(\d+\.?\d*)\s*ms/i);
          const pingLatency = pingMatch ? `${pingMatch[1]}ms` : 'unknown';
          
          resolve({
            channel: 'Ping',
            status: 'success',
            latency: `${latency}ms`,
            pingLatency: pingLatency,
            message: `Ping成功 (${pingLatency})`
          });
        }
      });
    });
  }

  // 综合分析所有通道结果
  analyzeResults(results) {
    const onlineChannels = results.filter(r => 
      r.status === 'online' || r.status === 'success'
    );
    
    const offlineChannels = results.filter(r => 
      r.status === 'offline' || r.status === 'failed' || r.status === 'timeout'
    );

    console.log('\n=== 多通道检测分析报告 ===');
    console.log(`目标: ${this.targetHost}:${this.targetPort}`);
    console.log(`总通道数: ${results.length}`);
    console.log(`在线通道: ${onlineChannels.length}`);
    console.log(`离线通道: ${offlineChannels.length}\n`);

    // 详细输出每个通道的结果
    results.forEach(result => {
      const icon = result.status === 'online' || result.status === 'success' ? '✅' : '❌';
      console.log(`${icon} [${result.channel}] ${result.message}`);
      console.log(`   响应时间: ${result.latency}`);
      if (result.addresses) {
        console.log(`   解析地址: ${result.addresses.join(', ')}`);
      }
      console.log();
    });

    // 综合判断
    if (onlineChannels.length >= 2) {
      console.log('🟢 结论: 服务可能正常运行');
      console.log('   原因: 多个通道确认服务可达');
    } else if (onlineChannels.length === 1) {
      console.log('🟡 结论: 服务状态不确定');
      console.log('   原因: 仅一个通道确认服务可达');
    } else {
      console.log('🔴 结论: 服务可能已宕机');
      console.log('   原因: 所有通道均无法访问');
    }

    // 建议的备用通道优先级
    console.log('\n=== 备用通道优先级建议 ===');
    console.log('1️⃣  TCP端口检测 - 最可靠，直接验证端口状态');
    console.log('2️⃣  DNS解析检测 - 验证域名解析是否正常');
    console.log('3️⃣  Ping检测 - 验证基础网络连通性');
    console.log('4️⃣  其他HTTP端点 - 尝试访问不同路径');
  }

  // 执行全面检测
  async runFullCheck() {
    console.log(`\n开始多通道检测: ${this.targetHost}:${this.targetPort}`);
    console.log('时间:', new Date().toISOString());
    console.log('='.repeat(50));

    // 并行执行所有检测
    const [httpResult, tcpResult, dnsResult, pingResult] = await Promise.all([
      this.checkHTTP(),
      this.checkTCP(),
      this.checkDNS(),
      this.checkPing()
    ]);

    this.results = [httpResult, tcpResult, dnsResult, pingResult];
    this.analyzeResults(this.results);
    
    return this.results;
  }
}

// 使用示例
async function main() {
  // 测试案例1: 一个常见的网站
  const detector1 = new MultiChannelDetector('example.com', 80);
  await detector1.runFullCheck();

  console.log('\n' + '='.repeat(60) + '\n');

  // 测试案例2: 一个可能不存在的服务
  const detector2 = new MultiChannelDetector('nonexistent-service.local', 8080);
  await detector2.runFullCheck();

  // 输出研究结论
  console.log('\n=== 研究结论 ===');
  console.log('1. 单通道检测(仅HTTP)容易产生误判，网络波动或防火墙可能导致误报');
  console.log('2. 多通道检测通过TCP、DNS、Ping等不同层面验证，显著提高准确性');
  console.log('3. TCP端口检测是最可靠的备用通道，因为它直接验证网络层可达性');
  console.log('4. DNS解析检测可以区分"域名解析失败"和"服务宕机"两种不同情况');
  console.log('5. 建议至少使用3个不同的检测通道来确认服务状态');
  console.log('6. 检测超时时间应该合理设置，避免过长的等待时间');
}

main().catch(console.error);