// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:00:32.548Z

// 妹妹状态检测研究 - 实例间通讯方式探索

// 引入需要的模块
const { ipcMain, ipcRenderer } = require('electron').remote;

// 创建一个 Electron 应用的主进程
const app = require('electron').app;
const BrowserWindow = require('electron').BrowserWindow;

// 创建一个 BrowserWindow 实例
let mainWindow;

// 创建窗口，展示应用
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({ width: 800, height: 600 });
  
  // 加载主页面
  mainWindow.loadURL('https://www.example.com');

  // 监听窗口关闭事件，确保应用也正常关闭
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 主进程与渲染进程通讯的示例
  // 这里使用 Electron 的 IPC (Inter-Process Communication) 机制

  // 在主进程中监听来自渲染进程的消息
  ipcMain.on('message-from-renderer', (event, arg) => {
    console.log('收到渲染进程的消息：', arg);
    // 回复渲染进程
    event.reply('response-from-main', `收到您发送的：${arg}`);
  });

  // 在主进程中发送消息到渲染进程
  ipcMain.send('message-from-main', `这是从主进程发送的消息：${new Date()}`);

  // 在渲染进程中监听来自主进程的消息
  ipcRenderer.on('message-from-main', (event, arg) => {
    console.log('渲染进程收到主进程的消息：', arg);
  });

  // 在渲染进程中发送消息到主进程
  ipcRenderer.send('message-from-renderer', `这是从渲染进程发送的消息：${new Date()}`);
});

// 当应用关闭时
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('ready', () => {
  console.log('Electron 应用已准备好！');
});

// 研究结果输出
console.log('实例间通讯方式研究结果：');
console.log('1. HTTP ping：通过 HTTP 协议发送心跳包，定期检测状态。');
console.log('2. WebSockets：建立持久化的双向通信通道，实时传输数据。');
console.log('3. gRPC：基于 HTTP/2 的开源高性能 RPC 框架，支持多种语言。');
console.log('4. Electron IPC (Inter-Process Communication)：用于 Electron 应用中主进程与渲染进程之间的通讯。');
console.log('5. Shared Memory：共享内存段，进程间直接访问内存地址。');
console.log('6. Named Pipes：在 Windows 系统中，命名管道提供进程间通讯机制。');
console.log('7. Message Queues：消息队列，异步通讯，消息生产者将消息放入队列，消费者从队列中取出消息。');
console.log('8. ZeroMQ：轻量级通讯库，支持多种通讯模式，如请求/响应、发布/订阅等。');