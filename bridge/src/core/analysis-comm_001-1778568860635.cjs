// Analysis by 小刚
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T06:54:20.635Z

console.log("=== 小刚的分析 ===");
console.log("下面的代码演示了 **在 Node.js（CommonJS）环境下，除了最常用的 HTTP ping 之外，还能用哪些方式去探测“姐妹实例”（即同一进程族里的其他实例）的存活情况**：\n\n* **UDP 广播 / 多播** – 通过局域网广播/多播 heart‑beat 包，无需任何中心化服务器。  \n* **TCP 长连接 + 心跳** – 维持一条持久的 TCP 连接，定时发送轻量心跳包。  \n* **Node Cluster 消息传递** – 当多个进程是同一个 `cluster` 进程组时，利用 `process.send`/`process.on('message')` 进行进程间通");
