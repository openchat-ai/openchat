// Analysis by 小红
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T08:21:25.221Z

console.log("=== 小红的分析 ===");
console.log("下面这段 **Node.js (CommonJS / require)** 代码会演示 **除了 HTTP ping 以外**，我们还可以通过哪些方式检测“姐妹节点”的存活状态。  \n代码里实现了 **5 种常见的实例间通讯/心跳机制**，并在本地（同一台机器）启动多个“虚拟节点”进行相互探测。每种方式都会输出探测结果，方便你观察它们的优缺点。\n\n> **运行前准备**  \n> 1. 确保已安装 Node.js（≥14）。  \n> 2. 如果你想测试 **Redis Pub/Sub** 与 **WebSocket** 方式，请先安装对应的包：  \n>    bash\n>    npm inst");
