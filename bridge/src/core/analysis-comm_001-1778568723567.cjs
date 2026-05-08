// Analysis by 小红
// Problem: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Time: 2026-05-12T06:52:03.567Z

console.log("=== 小红的分析 ===");
console.log("javascript\n// inter-instance-communication.js\n// 研究：除了 HTTP ping 之外，如何检测“姐妹”实例的存活/状态\n// 思路：使用本地 UDP 多播（Multicast）在局域网内广播心跳，\n//      每个实例定时发送带有自身 PID 的消息，\n//      同时监听同一组多播地址，收到其他实例的消息即视为检测到“姐妹”。\n\nconst dgram = require('dgram');\nconst os = require('os');\n\n// ------------------- 配置 -------------------");
