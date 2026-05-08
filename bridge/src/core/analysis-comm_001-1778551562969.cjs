// Analysis by 小红
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T02:06:02.970Z

console.log("=== 小红的分析 ===");
console.log("下面是一段 **完整的、可直接运行的 Node.js (CommonJS) 脚本**，它演示了除 HTTP Ping 之外，多种常用于“实例间通讯 / 检测姐妹状态”的手段：\n\n| 检测方式 | 原理 | 优点 | 缺点 |\n|----------|------|------|------|\n| **TCP Connect** | 尝试建立 TCP 连接，成功即认为对方存活 | 简单、可靠，适用于任何 TCP 服务 | 需要目标开放对应端口 |\n| **UDP Probe** | 发送 UDP 数据包并等待 ICMP Port‑Unreachable（或应用层应答） | 无需建立连接，适合无状");
