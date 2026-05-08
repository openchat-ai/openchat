// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:16:06.238Z

// 引入必要的 Node.js 模块
const { fork } = require('child_process');
const { promisify } = require('util');
const childProcessFork = promisify(fork);

// 创建一个简单的计算任务函数
function calculateSum(a, b) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(a + b);
        }, Math.random() * 1000);
    });
}

// 创建一个主进程，它将创建两个子进程作为“姐妹”进程
async function createSiblingProcesses() {
    console.log('创建姐妹进程开始...');
    
    // 创建第一个子进程
    const firstChild = childProcessFork('./child.js');
    console.log('第一个子进程已创建');
    
    // 创建第二个子进程
    const secondChild = childProcessFork('./child.js');
    console.log('第二个子进程已创建');
    
    console.log('等待两个子进程完成计算...');
    
    try {
        // 等待第一个子进程完成计算
        const firstChildResult = await new Promise(resolve => {
            firstChild.on('message', resolve);
        });
        console.log('第一个子进程计算结果:', firstChildResult);
        
        // 等待第二个子进程完成计算
        const secondChildResult = await new Promise(resolve => {
            secondChild.on('message', resolve);
        });
        console.log('第二个子进程计算结果:', secondChildResult);
        
        console.log('姐妹进程通讯测试完成。');
    } catch (error) {
        console.error('姐妹进程通讯测试出错:', error);
    }
}

// 运行姐妹进程通讯测试
createSiblingProcesses();

// 子进程文件 child.js，用于执行计算任务
// (这个文件将被用于创建两个“姐妹”子进程)
process.on('message', async () => {
    const sum = await calculateSum(5, 10);
    process.send(sum);
});