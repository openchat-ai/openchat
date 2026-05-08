// Analysis by 管家
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-11T08:49:46.848Z

console.log("=== 管家的分析 ===");
console.log("下面这段代码是一个 **“实例间通讯方式研究”** 的小实验。  \n它在一块机器上模拟了多种常见的 “检测对方是否存活” 的手段（除了最常见的 HTTP Ping），并且把每种方式的 **耗时、成功率、优缺点** 都打印出来，方便你对比和选择适合自己场景的方案。\n\n> **运行方式**  \n> 1. 确保已安装 Node.js（≥12）  \n> 2. 把代码保存为 `instance-check.js`  \n> 3. 在终端执行 `node instance-check.js`  \n\n代码只依赖 Node.js 内置模块（`net`、`dgram`、`fs`、`child_process`、`");
