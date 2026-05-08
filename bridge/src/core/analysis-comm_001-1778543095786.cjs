// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T23:44:55.787Z

console.log("=== 管家的分析 ===");
console.log("下面的脚本演示了 **在同一台机器或同一局域网内的多个 Node.js 实例之间** 常见的几种状态检测（“姐妹”实例）方案，除了最常见的 HTTP ping 之外，还包括：\n\n1. **TCP 直接连接**（`net` 模块）  \n2. **UDP 心跳**（`dgram` 模块）  \n3. **WebSocket 心跳**（`ws` 模块）  \n4. **Redis Pub/Sub**（需要本地或远程的 Redis）  \n5. **Zero‑MQ（REQ/REP）**（`zeromq` 包）  \n\n每种方式都会在本实例启动时尝试与配置好的“姐妹实例”建立连接并周期性发送心跳。收到心跳即认为");
