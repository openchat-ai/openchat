// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T10:04:46.838Z

console.log("=== 管家的分析 ===");
console.log("下面是一段 **完整、可直接运行** 的 Node.js（CommonJS）示例代码。  它不使用 HTTP ping，而是通过 **UDP 广播 + 简单的 TCP 连接** 来探测同一局域网中的“姐妹实例”（即其他运行了相同脚本的进程）。代码会：\n\n1. 组播/UDP 广播一条心跳消息。  \n2. 监听其他实例回复的 “I‑AM‑ALIVE” 消息。  \n3. 发现到达的实例地址后尝试建立 TCP 连接并验证。  \n4. 把发现结果通过 `console.log` 输出，帮助你直观看到不同通讯方式的效果。\n\njavascript\n// 文件名：sibling-discovery.js\n//");
