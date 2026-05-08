// Research by 管家: 杀进程重启的问题：丢失内存状态、断开连接、用户体验差。热加载如何保留状态？
// Generated: 2026-05-12T09:00:19.527Z

// 热加载状态管理器 - 演示如何在进程重启时保留状态
const fs = require('fs');
const path = require('path');
const http = require('http');

// 状态持久化工具
class StateManager {
  constructor(stateFile = './hot_state.json') {
    this.stateFile = stateFile;
    this.state = {
      connections: 0,
      userSessions: {},
      lastProcessId: process.pid,
      restartCount: 0
    };
    this.loadState();
  }

  // 从文件加载状态
  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        // 合并状态，保留之前的统计数据
        this.state = {
          ...saved,
          connections: saved.connections || 0,
          userSessions: saved.userSessions || {},
          restartCount: (saved.restartCount || 0) + 1,
          lastProcessId: process.pid
        };
        console.log(`[状态管理] 从文件加载状态成功，这是第 ${this.state.restartCount} 次重启`);
        console.log(`[状态管理] 前一个进程ID: ${saved.lastProcessId}, 当前进程ID: ${process.pid}`);
      }
    } catch (err) {
      console.log('[状态管理] 首次启动，创建新状态');
    }
  }

  // 保存状态到文件
  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
      console.log('[状态管理] 状态已持久化到文件');
    } catch (err) {
      console.error('[状态管理] 保存状态失败:', err.message);
    }
  }

  // 添加用户会话
  addSession(userId, data) {
    this.state.userSessions[userId] = {
      ...data,
      lastActive: Date.now(),
      sessionStarted: this.state.userSessions[userId]?.sessionStarted || Date.now()
    };
    this.state.connections++;
    this.saveState();
  }

  // 获取用户会话
  getSession(userId) {
    return this.state.userSessions[userId] || null;
  }

  // 获取当前状态统计
  getStats() {
    return {
      totalConnections: this.state.connections,
      activeSessions: Object.keys(this.state.userSessions).length,
      restartCount: this.state.restartCount,
      processId: process.pid
    };
  }
}

// 创建一个简单的HTTP服务器来演示热加载
function createServer(stateManager) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    if (url.pathname === '/connect') {
      // 模拟用户连接
      const userId = url.searchParams.get('user') || `user_${Date.now()}`;
      stateManager.addSession(userId, { ip: req.socket.remoteAddress });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: '连接成功',
        userId: userId,
        state: stateManager.getStats()
      }));
    }
    else if (url.pathname === '/status') {
      // 查看当前状态
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: '状态信息',
        state: stateManager.getStats(),
        sessions: stateManager.state.userSessions
      }));
    }
    else if (url.pathname === '/hot-reload') {
      // 模拟热加载：保存状态后重启
      console.log('\n[热加载] 收到热加载请求...');
      stateManager.saveState();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: '状态已保存，准备热加载',
        state: stateManager.getStats()
      }));
      
      // 模拟热加载：启动新进程（这里用setTimeout模拟重启）
      setTimeout(() => {
        console.log('[热加载] 模拟进程重启...');
        // 在真实场景中，这里会启动新进程
        // 当前进程继续运行，但状态已保存到文件
        console.log('[热加载] 状态已持久化，新进程可以加载');
      }, 1000);
    }
    else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
        <body>
          <h1>状态热加载演示</h1>
          <p>当前进程ID: ${process.pid}</p>
          <p>重启次数: ${stateManager.getStats().restartCount}</p>
          <ul>
            <li><a href="/connect?user=user1">连接用户1</a></li>
            <li><a href="/connect?user=user2">连接用户2</a></li>
            <li><a href="/status">查看状态</a></li>
            <li><a href="/hot-reload">热加载（保存状态）</a></li>
          </ul>
        </body>
        </html>
      `);
    }
  });

  return server;
}

// 主函数
async function main() {
  console.log('='.repeat(50));
  console.log('进程热加载状态管理研究');
  console.log('='.repeat(50));
  
  console.log('\n[研究分析] 杀进程重启的问题:');
  console.log('1. 丢失内存状态 - 所有运行时数据丢失');
  console.log('2. 断开连接 - 客户端连接中断');
  console.log('3. 用户体验差 - 需要重新登录/初始化');
  
  console.log('\n[解决方案] 热加载保留状态:');
  console.log('1. 使用文件系统持久化关键状态');
  console.log('2. 在启动时从文件恢复状态');
  console.log('3. 定期保存状态以减少数据丢失');
  
  // 初始化状态管理器
  const stateManager = new StateManager();
  
  // 创建并启动服务器
  const server = createServer(stateManager);
  const PORT = 3000;
  
  server.listen(PORT, () => {
    console.log(`\n[服务器] 已启动在 http://localhost:${PORT}`);
    console.log(`[服务器] 当前进程ID: ${process.pid}`);
    console.log('\n[演示] 请在浏览器中访问:');
    console.log('1. http://localhost:3000 - 主页');
    console.log('2. http://localhost:3000/connect?user=test - 添加用户');
    console.log('3. http://localhost:3000/status - 查看状态');
    console.log('4. http://localhost:3000/hot-reload - 热加载测试');
    
    console.log('\n[测试] 模拟多次重启保留状态:');
    console.log('停止此进程并重新运行，状态将从文件恢复');
    console.log(`状态文件: ${path.resolve('./hot_state.json')}`);
  });
  
  // 处理优雅退出
  process.on('SIGINT', () => {
    console.log('\n[退出] 保存状态并退出...');
    stateManager.saveState();
    process.exit(0);
  });
  
  process.on('uncaughtException', (err) => {
    console.error('[错误] 未捕获异常:', err.message);
    stateManager.saveState();
  });
}

// 运行主函数
main().catch(console.errorapsed