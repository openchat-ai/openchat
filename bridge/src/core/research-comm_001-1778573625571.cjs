// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:13:45.571Z

const net = require('net');
const { fork } = require('child_process');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

// Configuration
const SOCKET_PATH = '/tmp/sister_status.sock';
const FORK_DELAY = 1000; // ms to wait before forking child

// Clean up socket if it exists from previous runs
try {
  require('fs').unlinkSync(SOCKET_PATH);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

// Create server to listen on Unix socket
const server = net.createServer();

// Track connected clients
const clients = new Set();

server.on('connection', (socket) => {
  clients.add(socket);
  console.log('[' + new Date().toISOString() + '] Sister node detected!');
  
  socket.on('close', () => {
    clients.delete(socket);
    console.log('[' + new Date().toISOString() + '] Sister node disconnected');
  });
});

// Start server
server.listen(SOCKET_PATH, () => {
  console.log(`[${new Date().toISOString()}] Server listening on ${SOCKET_PATH}`);
  
  // Simulate another instance after delay
  setTimeout(async () => {
    console.log(`[${new Date().toISOString()}] Forking child process to test communication...`);
    
    const child = fork(__filename, ['child'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    
    // Wait for child to initialize
    await sleep(FORK_DELAY);
    
    // Test communication by sending a message
    child.send('STATUS_CHECK');
    
    // Listen for responses
    child.on('message', (msg) => {
      if (msg === 'ALIVE') {
        console.log(`[${new Date().toISOString()}] SUCCESS: Sister node is ALIVE (via IPC)`);
      } else if (msg === 'DEAD') {
        console.log(`[${new Date().toISOString()}] WARNING: Sister node appears DEAD (via IPC)`);
      }
    });
    
    // Simulate node failure after 3 seconds
    setTimeout(() => {
      child.kill('SIGKILL');
      console.log(`[${new Date().toISOString()}] Simulated sister node failure (SIGKILL)`);
    }, 3000);
    
  }, 500);
});

// Handle child process arguments
if (process.argv[2] === 'child') {
  process.on('message', (msg) => {
    if (msg === 'STATUS_CHECK') {
      // Check if socket is accessible (simple heartbeat test)
      const testSocket = new net.Socket();
      
      testSocket.setTimeout(2000);
      
      testSocket.on('connect', () => {
        testSocket.destroy();
        process.send('ALIVE');
      });
      
      testSocket.on('error', (err) => {
        // If we can't connect within timeout, node is likely dead
        testSocket.setTimeout(2000, () => {
          testSocket.destroy();
          process.send('DEAD');
        });
      });
      
      testSocket.connect(SOCKET_PATH);
    }
  });
}

// Keep process alive
console.log(`[${new Date().toISOString()}] Main process running. Press Ctrl+C to exit.`);