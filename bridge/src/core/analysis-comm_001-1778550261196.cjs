// Analysis by 小刚
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T01:44:21.196Z

console.log("=== 小刚的分析 ===");
console.log("下面是一段 **完整的、可直接运行** 的 Node.js (CommonJS) 脚本，它演示了 **除 HTTP ping 之外** 的多种实例间状态检测方法，并在控制台打印出每种方式的延迟与可用性结论。  \n\n代码结构如下：\n\n1. **Cluster 模式** – 主进程启动两个 Worker（模拟“姐妹实例”）。  \n2. **Worker 内部**：\n   * 启动 **TCP** 服务器与客户端，互相发送 `ping/pong` 并统计往返时间。  \n   * 启动 **UDP** 套接字，发送单向心跳并测量延迟。  \n   * 使用 **共享文件**（`fs.watch`）监听对");
