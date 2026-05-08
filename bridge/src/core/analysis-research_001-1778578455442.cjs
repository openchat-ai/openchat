// Analysis by 管家
// Problem: 如何准确检测姐妹实例是否真正宕机？端口被占用但无响应可能是忙，如何区分？需要并发机制让再忙也能响应
// Time: 2026-05-12T09:34:15.442Z

console.log("=== 管家的分析 ===");
console.log("我来研究这个问题：如何准确检测服务实例是否真正宕机，而不是仅仅因为端口被占用或服务繁忙。\n\njavascript\n// 服务实例健康检测研究 - 区分宕机 vs 繁忙\nconst net = require('net');\nconst http = require('http');\nconst { performance } = require('perf_hooks');\n\n// 创建测试服务器 - 模拟正常服务\nfunction createNormalServer(port, cb) {\n    const server = http.createServer((req, res) =>");
