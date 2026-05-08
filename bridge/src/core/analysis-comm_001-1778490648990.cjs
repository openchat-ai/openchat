// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T09:10:48.990Z

console.log("=== 管家的分析 ===");
console.log("**说明**  \n下面的脚本演示了 **除了 HTTP ping 以外**，在 Node.js 集群（cluster）环境中检测“姐妹”实例（工作进程）存活状态的几种常用方式：\n\n| 方式 | 原理 | 代码中对应的实现 |\n|------|------|------------------|\n| **IPC 通道** | 主进程与子进程之间通过 `process.send` / `process.on('message')` 传递结构化消息 | `sendViaIPC()`、`listenIPC()` |\n| **TCP 心跳** | 每个工作进程开启一个 TCP 端口，其他进程主动连接并等");
