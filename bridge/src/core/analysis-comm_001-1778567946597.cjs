// Analysis by 小刚
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T06:39:06.598Z

console.log("=== 小刚的分析 ===");
console.log("下面是一段 **完整、可直接运行** 的 Node.js（CommonJS/require）示例代码。  \n它演示了 **在同一局域网内的多个进程（实例）之间，除了最常用的 HTTP ping 之外，还能通过哪些方式相互检测对方是否存活**：\n\n| 方式 | 底层实现 | 代码片段 | 运行时的表现 |\n|------|----------|----------|--------------|\n| **UDP Broadcast**（局域网广播） | `dgram` + `1900` 组播（SSDP‑like） | `udpBroadcast()` | 收到来自其他实例的 “I‑am‑aliv");
