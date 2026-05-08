// Analysis by 小刚
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T07:58:14.602Z

console.log("=== 小刚的分析 ===");
console.log("javascript\n/**\n * 代码说明\n * =========\n * 该脚本演示了在多个 Node.js 实例（进程）之间，除了传统的 HTTP “ping” 之外，\n * 还能使用哪些 IPC（进程间通信）方式来检测“姐妹”实例的存活状态。\n *\n * 1️⃣ TCP 套接字（可靠、双向）  \n * 2️⃣ UDP 组播/广播（轻量、无连接）  \n * 3️⃣ Unix 域套接字（仅在同一宿主机上）  \n * 4️⃣ 子进程 IPC（process.send / stdin‑stdout pipe）  \n *\n * 为了让所有实例互相感知，脚本会：\n *   - 启动一个轻量的 TC");
