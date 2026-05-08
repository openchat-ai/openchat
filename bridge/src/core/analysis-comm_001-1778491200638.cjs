// Analysis by 小红
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T09:20:00.638Z

console.log("=== 小红的分析 ===");
console.log("javascript\n/**\n * 实例间通讯方式研究 —— 除了 HTTP ping 还有哪些手段可以检测“姐妹”状态？\n *\n * 本脚本在一台机器上模拟了多个“姐妹”实例，并分别用以下方式进行探活：\n *   1. HTTP GET（传统 ping）\n *   2. TCP 连接 + 简单请求/应答\n *   3. UDP 发送/接收心跳\n *   4. Unix Domain Socket 连接\n *   5. 共享文件状态（写 JSON → 读 JSON）\n *\n * 运行方式（Node.js ≥");
