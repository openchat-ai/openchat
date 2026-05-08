// Analysis by 小明
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T08:49:54.950Z

console.log("=== 小明的分析 ===");
console.log("javascript\n/**\n * 研究：除了 HTTP ping 之外，还能如何检测“姐妹”实例的存活状态？\n * 本示例使用 Node.js 原生模块实现三种不同的检测方式：\n *   1. TCP socket（非 HTTP 的直接连接）\n *   2. Unix domain socket（本机文件系统路径通信）\n *   3. 文件心跳（通过共享文件的时间戳判断）\n *\n * 运行方式：\n *   node sister-detect.js\n *\n * 代码会：\n *   - 启动一个“姐妹”进程（同进程内部）负责：\n *        • 每 3 秒写一次心跳文件\n *      ");
