// Analysis by 小红
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T03:09:41.852Z

console.log("=== 小红的分析 ===");
console.log("下面这段 **完整、可直接运行** 的 Node.js（CommonJS `require`）示例，演示了在同一台机器上启动多个 “姐妹实例”，并通过 **UDP 广播、Redis Pub/Sub、TCP 端口扫描** 三种非 HTTP Ping 的方式相互探测对方是否存活。  \n代码里会：\n\n1. 用 `child_process.fork` 启动 3 个子进程（每个子进程会运行 `sibling.js`）。  \n2. 每个子进程会：\n   - 启动一个简易的 HTTP 服务（仅用于演示，实际不参与探测）。  \n   - 通过 **UDP 广播** 把自己的实例编号与监听端口广播到本地网络。");
