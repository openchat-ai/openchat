// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:13:43.858Z

const net = require('net');
const dns = require('dns');
const { EventEmitter } = require('events');

// # 背景分析
// # 尝试通过端口扫描 + DNS解析来检测实例间状态
// # 提供两种方式：被动扫描（监听端口）+ 主动扫描（DNS解析）

// # 主函数：启动检测
async function startInstanceDetection(portToCheck, hostnameOrIp) {
    console.log(`开始检测实例状态... 目标端口: ${portToCheck}, 目标: ${hostnameOrIp}`);

    // # 1. 使用net模块监听端口
    try {
        // 创建一个TCP客户端用于端口扫描
        const client = new net.Socket();
        const options = { timeout: 1000 }; // 设置超时为1秒

        // 监听连接错误事件
        client.on('error', (err) => {
            console.log(`端口${portToCheck}连接错误: ${err.message}`);
            client.destroy();
        });

        // 尝试连接到指定端口
        client.setTimeout(options.timeout);
        await new Promise((resolve, reject) => {
            client.connect(portToCheck, hostnameOrIp, () => {
                console.log(`端口${portToCheck}连接成功，服务可能在线`);
                client.destroy();
                resolve();
            });
        });

        // 重置超时设置
        client.setTimeout(null);

    } catch (error) {
        console.log(`端口${portToCheck}连接异常，服务可能离线`);
    }

    // # 2. 使用dns模块进行DNS解析
    try {
        const records = await dns.promises.resolveAddr(hostnameOrIp);
        console.log(`DNS解析结果: ${records.map(record => `${record.host} => ${record.address}`).join('\n')}`);
        console.log('DNS解析成功，服务可能在线');

    } catch (error) {
        console.log(`DNS解析失败：${error.message}`);
        console.log('DNS解析失败，服务可能离线');
    }

    // # 结束检测
    console.log('检测结束...');
}

// # 示例：检测localhost的8080端口
startInstanceDetection(8080, 'localhost');

// # 注意事项：
// # 1. 这个示例仅用于检测实例是否在线，不保证准确性
// # 2. 端口监听需要超级用户权限（需要root）才能成功
// # 3. DNS解析能返回多个地址，仅选择第一个作为检测结果
// # 4. 此代码使用Promise异步处理操作，避免阻塞事件循环