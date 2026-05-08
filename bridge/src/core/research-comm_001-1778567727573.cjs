// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:35:27.573Z

/**
 * 研究：实例间通信方式（除 HTTP ping 之外）
 * 方案：
 * 1. UDP 广播：发送“ping”报文到本地局域网，监听回覆
 * 2. TCP 心跳：在本地监听 9000 端口，客户端定时连接并发送“heartbeat”
 * 3. Redis Pub/Sub：发布“ping”消息，订阅者在同一 Redis 服务器上接收
 *
 * 运行方式
 *