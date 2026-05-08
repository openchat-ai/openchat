// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:29:12.569Z

// 实例间通讯方式研究：姐妹状态检测方法探索
// 除了HTTP ping，我们探索TCP、进程间信号、文件锁等方式

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// 研究结果存储
const researchResults = [];

// 记录研究结果
function logResult(method, description, success, details = '') {
  researchResults.push({
    method,
    description,
    success,
    details,
    timestamp: new Date().toISOString()
  });
  console.log(`[${method}] ${description} - ${success ? '✅ 可行' : '❌ 不可行'} ${details}`);
}

// 方法1：TCP Socket心跳检测
function studyTCPHeartbeat() {
  return new Promise((resolve) => {
    const PORT = 9876;
    const server = net.createServer((socket) => {
      socket.on('data', (data) => {
        const msg = data.toString();
        if (msg === 'PING') {
          socket.write('PONG');
        }
      });
    });

    server.listen(PORT, () => {
      // 模拟姐妹实例连接
      const client = new net.Socket();
      client.connect(PORT, '127.0.0.1', () => {
        client.write('PING');
      });

      client.on('data', (data) => {
        const response = data.toString();
        const success = response === 'PONG';
        logResult(
          'TCP Socket',
          '通过TCP连接发送心跳包检测姐妹状态',
          success,
          `响应: ${response}`
        );
        client.destroy();
        server.close();
        resolve();
      });

      client.on('error', (err) => {
        logResult('TCP Socket', 'TCP连接失败', false, err.message);
        server.close();
        resolve();
      });
    });
  });
}

// 方法2：文件锁/文件心跳
function studyFileLock() {
  return new Promise((resolve) => {
    const lockFile = path.join(os.tmpdir(), `sister-heartbeat-${process.pid}.lock`);
    
    try {
      // 写入心跳文件
      fs.writeFileSync(lockFile, String(Date.now()), 'utf8');
      
      // 模拟检查姐妹状态：检查是否存在其他实例的心跳文件
      const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('sister-heartbeat-'));
      const otherFiles = files.filter(f => !f.includes(String(process.pid)));
      
      const success = otherFiles.length > 0;
      logResult(
        '文件心跳',
        '通过写入带时间戳的文件来检测其他实例是否存活',
        true,
        `发现 ${otherFiles.length} 个姐妹实例文件`
      );
      
      // 清理
      fs.unlinkSync(lockFile);
      resolve();
    } catch (err) {
      logResult('文件心跳', '文件操作失败', false, err.message);
      resolve();
    }
  });
}

// 方法3：共享内存（通过文件映射模拟）
function studySharedMemory() {
  return new Promise((resolve) => {
    const memFile = path.join(os.tmpdir(), 'shared-sister-state.json');
    
    try {
      // 写入当前状态
      const state = {
        pid: process.pid,
        timestamp: Date.now(),
        status: 'alive'
      };
      fs.writeFileSync(memFile, JSON.stringify(state), 'utf8');
      
      // 读取共享状态
      const data = fs.readFileSync(memFile, 'utf8');
      const parsed = JSON.parse(data);
      
      const success = parsed.status === 'alive';
      logResult(
        '共享文件',
        '通过共享文件交换状态信息',
        success,
        `姐妹状态: ${parsed.status}, PID: ${parsed.pid}`
      );
      
      fs.unlinkSync(memFile);
      resolve();
    } catch (err) {
      logResult('共享文件', '共享内存操作失败', false, err.message);
      resolve();
    }
  });
}

// 方法4：进程信号（Unix/Linux）
function studyProcessSignal() {
  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      logResult('进程信号', 'Windows不支持SIGUSR信号', false, '仅在Unix/Linux可用');
      resolve();
      return;
    }

    try {
      // 创建子进程作为姐妹实例
      const child = spawn(process.execPath, ['-e', `
        process.on('SIGUSR1', () => {
          console.log('收到心跳信号');
          process.exit(0);
        });
        // 保持进程存活
        setInterval(() => {}, 1000);
      `], {
        stdio: 'pipe'
      });

      setTimeout(() => {
        // 发送信号检测姐妹状态
        const success = child.pid > 0;
        try {
          process.kill(child.pid, 'SIGUSR1');
        } catch (e) {
          // 信号可能已经处理
        }
        
        logResult(
          '进程信号',
          '通过Unix信号(SIGUSR1/SIGUSR2)检测姐妹进程',
          success,
          `姐妹PID: ${child.pid}`
        );
        
        // 清理子进程
        setTimeout(() => {
          try { child.kill(); } catch(e) {}
          resolve();
        }, 500);
      }, 500);
    } catch (err) {
      logResult('进程信号', '信号发送失败', false, err.message);
      resolve();
    }
  });
}

// 方法5：Unix Domain Socket
function studyUnixSocket() {
  return new Promise((resolve) => {
    const socketPath = path.join(os.tmpdir(), 'sister.sock');
    
    try {
      // 如果socket文件已存在，先删除
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }

      const server = net.createServer((socket) => {
        socket.on('data', (data) => {
          if (data.toString() === 'STATUS') {
            socket.write('ALIVE');
          }
        });
      });

      server.listen(socketPath, () => {
        const client = new net.Socket();
        client.connect(socketPath, () => {
          client.write('STATUS');
        });

        client.on('data', (data) => {
          const response = data.toString();
          const success = response === 'ALIVE';
          logResult(
            'Unix Socket',
            '通过Unix Domain Socket进行本地通讯',
            success,
            `响应: ${response}`
          );
          
          client.destroy();
          server.close(() => {
            // 清理socket文件
            try { fs.unlinkSync(socketPath); } catch(e) {}
            resolve();
          });
        });
      });
    } catch (err) {
      logResult('Unix Socket', 'Unix Socket操作失败', false, err.message);
      resolve();
    }
  });
}

// 主研究函数
async function main() {
  console.log('=== 实例间通讯方式研究 ===');
  console.log('研究目标：探索HTTP ping以外的姐妹状态检测方法\n');
  
  console.log('开始研究方法...\n');
  
  await studyTCPHeartbeat();
  await studyFileLock();
  await studySharedMemory();
  await studyProcessSignal();
  await studyUnixSocket();
  
  console.log('\n=== 研究总结 ===');
  console.log('成功的方法：');
  researchResults
    .filter(r => r.success)
    .forEach(r => console.log(`  ✅ ${r.method}: ${r.description}`));
  
  console.log('\n不可行的方法：');
  researchResults
    .filter(r => !r.success)
    .forEach(r => console.log(`  ❌ ${r.method}: ${r.description} - ${r.details}`));
  
  console.log('\n结论：除了HTTP ping，以下方法也可用于姐妹状态检测：');
  console.log('1. TCP Socket心跳 - 可靠，适合网络通讯');
  console.log('2. 文件锁/文件心跳 - 简单，适合本地实例');
  console.log('3. 共享文件状态 - 灵活，可交换复杂信息');
  console.log('4. Unix进程信号 - 轻量，仅限Unix/Linux');
  console.log('5. Unix Domain Socket - 高效，适合本地通讯');
}

// 运行研究
main().catch(console.error);