// Analysis by 小刚
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T01:47:50.823Z

console.log("=== 小刚的分析 ===");
console.log("javascript\nconst WebSocket = require('ws');\n\n// 服务器端代码（模拟多个实例通信）\nconst wss = new WebSocket.Server({ port: 8080 });\nconst clients = new Map(); // 存储客户端状态\n\nwss.on('connection', (ws, req) => {\n    const ip = req.socket.remoteAddress;\n    clients.set(ip, { ws, status: 'offline' });\n    console.log(`[服务器");
