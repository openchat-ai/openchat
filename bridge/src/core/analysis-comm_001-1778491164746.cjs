// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T09:19:24.746Z

console.log("=== 管家的分析 ===");
console.log("javascript\n/**\n *实例间通讯方式研究（除 HTTP ping 之外的检测方法）\n * 运行方式：\n *   node sister-detect.js --id A   # 启动实例 A\n *   node sister-detect.js --id B   # 启动实例 B\n *\n * 该脚本会在同一台机器上通过 fork 启动两个子进程，分别模拟 “姐妹” 实例。\n * 每个实例会尝试以下几种非 HTTP 的存活检测方式：\n *   1. TCP 连接检测（主动连接对方的 TCP 端口）\n *   2. UDP 广播心跳（监听本机广播，收到则认为对方存活）\n *   3. ");
