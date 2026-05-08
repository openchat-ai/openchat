// Research by 小红: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:54:26.063Z

// 创建一个模拟的实例间通讯系统
const stateSystem = {
    peers: [], // 实例列表
    messages: [] // 已发送的消息
};

// 模拟检测姐妹状态的函数
function checkSiblingStatus(peerId, isMember) {
    if (peerId === 'peer1' && isMember) {
        console.log(`检测到 peer1 是姐妹的状态: ${stateSystem.messages.length}`);
    } else if (peerId === 'peer2' && isMember) {
        console.log(`检测到 peer2 是姐妹的状态: ${stateSystem.messages.length}`);
    }
    // 其他状态检测...
}

// 示例：向某个实例发送消息
function sendMessage(peerId, message) {
    if (stateSystem.peers.includes(peerId)) {
        stateSystem.messages.push(message);
        console.log(`已向 ${peerId} 发送消息: ${message}`);
        checkSiblingStatus(peerId, true);
    } else {
        console.log(`无法联系 ${peerId}`);
    }
}

// 实例化并测试
stateSystem.peers = ['peer1', 'peer2', 'peer3'];
sendMessage('peer1', '你好，姐妹！');
sendMessage('peer2', '你正在读书吗？');
sendMessage('peer3', '我也在等你等！');