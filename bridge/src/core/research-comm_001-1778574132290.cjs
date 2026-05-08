// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:22:12.290Z

> **注意**：脚本中使用了几个可选的外部依赖（`redis`、`sqlite3`、`zeromq`）。如果你的环境没有安装它们，脚本会自动跳过并在日志中说明。你也可以只保留核心模块（`net`、`dgram`、`fs`、`child_process`）来运行最基本的探测。