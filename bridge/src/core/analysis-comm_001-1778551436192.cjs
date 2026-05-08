// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T02:03:56.192Z

console.log("=== 管家的分析 ===");
console.log("下面是一段 **完整的、可直接运行的 Node.js (CommonJS) 脚本**，它演示了 **除 HTTP ping 以外** 的多种实例间状态检测方式，并在最后通过 `console.log` 输出对比结果。  \n代码使用 **cluster** 模块启动 3 个“姐妹”进程（Worker），每个 Worker 会依次尝试以下四种机制：\n\n| 序号 | 机制 | 原理简述 |\n|------|------|----------|\n| 1️⃣ | **TCP 心跳** | 每个 Worker 监听一个独立端口，其他 Worker 主动建立 TCP 连接并发送 `ping`，收到 `pon");
