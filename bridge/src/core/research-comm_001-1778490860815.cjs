// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-11T09:14:20.815Z

const { forkSync } = require('child_process');
const ping = require('ping');
const telnet = require('telnet');

async function testNetwork() {
  const result = await ping('127.0.0.1', 100);
  const telnetResult = await telnet('127.0.0.1', 21);
  const isSameNetwork = result <= 60 && telnetResult === result;
  console.log('网络状态检测结果：', isSameNetwork ? '同一网络' : '不同网络');
}

testNetwork();