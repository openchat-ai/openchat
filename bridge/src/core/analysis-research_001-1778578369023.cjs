// Analysis by 小明
// Problem: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Time: 2026-05-12T09:32:49.023Z

console.log("=== 小明的分析 ===");
console.log("这个问题很有深度！我们需要设计一个机制，不仅检测端口是否被占用，还要判断服务是否真的在响应。我设计了一个\"主动探活+心跳超时\"的方案。\n\njavascript\nconst net = require('net');\nconst dgram = require('dgram');\nconst crypto = require('crypto');\n\n/**\n * 智能探活器 - 区分端口占用但服务无响应 vs 服务忙碌\n * 原理：发送探测请求，等待响应，结合超时和重试机制\n */\nclass SmartHealthChecker {\n  constructor(options = {}) {\n");
