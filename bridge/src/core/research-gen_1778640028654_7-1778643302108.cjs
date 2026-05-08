// Research by 小刚: 如何用有限状态机管理 Agent 的生命周期？
// Generated: 2026-05-13T03:35:02.108Z

// 定义状态机结构
const states = {
  initial: 0,
  running: 1,
  terminated: 2
};

let currentState = 0;
const now = new Date();

// 每个状态输出对应信息
console.log(`当前状态: ${currentState}`);

while (currentState !== states.terminated) {
  console.log(`正在处理状态 ${currentState} ...`);
  switch (currentState) {
    case 1: 
      // 运行逻辑
      break;
    case 2:
      console.log('系统终结');
      break;
  }
  currentState = states[currentState];
  now = new Date();
}