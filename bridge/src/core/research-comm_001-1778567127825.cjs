// Research by 小刚: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T06:25:27.825Z

// 引入必要的依赖包
const net = require('net');
const { promisify } = require('util');
const fs = require('fs');

// 创建一个用于检测姐姐状态的函数
async function detectCousinState(port, timeout = 5000) {
    console.log(`开始检测姐姐状态，监听端口: ${port}...`);

    // 创建一个TCP客户端
    const client = new net.Socket();

    // 设置超时时间
    client.setTimeout(timeout);

    // 连接到姐姐服务器
    client.connect(port, 'localhost', () => {
        console.log(`连接到姐姐服务器成功，端口: ${port}`);
    });

    // 监听错误事件
    client.on('error', (err) => {
        console.error(`检测姐姐状态时发生错误: ${err.message}`);
        client.destroy();
    });

    // 监听数据事件
    client.on('data', (data) => {
        console.log(`姐姐服务器回复: ${data.toString()}`);
        client.destroy();
    });

    // 监听结束事件
    client.on('end', () => {
        console.log(`连接到姐姐服务器结束，端口: ${port}`);
    });

    // 监听超时事件
    client.on('timeout', () => {
        console.log(`检测姐姐状态超时，端口: ${port}`);
        client.destroy();
    });

    // 尝试发送心跳包
    client.write('ping\0');

    // 关闭连接
    client.destroy();
}

// 异步执行检测姐姐状态的函数
(async () => {
    try {
        // 检测姐姐状态
        await detectCousinState(3000);
    } catch (error) {
        console.error(`检测姐姐状态时发生错误: ${error.message}`);
    }
})();