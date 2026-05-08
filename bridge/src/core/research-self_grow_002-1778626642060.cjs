// Research by 小明: 我的智商不增长，需要解决新问题。我应该自己发现新问题或生成新问题
// Generated: 2026-05-12T22:57:22.060Z

// 智商不增长？那就自己创造问题来锻炼！
// 这个程序模拟一个“问题发现与生成引擎”，帮助小明突破思维瓶颈。

const questions = [
  "为什么天空是蓝色的？",
  "如何用最少的步骤煮好一个鸡蛋？",
  "为什么猫会踩奶？",
  "怎样让房间看起来更大？",
  "如何用一把尺子测量大楼的高度？"
];

// 小明的初始状态
let xiaoMing = {
  name: "小明",
  IQ: 100,
  courage: 40,   // 勇气：探索未知的意愿
  creativity: 55, // 创造力：生成新问题的能力
  solvedCount: 0
};

console.log("=== 小明的问题探索系统启动 ===");
console.log(`初始状态：勇气 ${xiaoMing.courage}%，创造力 ${xiaoMing.creativity}%`);
console.log("");

// 1. 发现新问题：从已知问题库中随机抽取，但需要勇气够高
function discoverProblem() {
  if (xiaoMing.courage < 30) {
    console.log("小明勇气不足，不敢面对新问题……先去喝杯奶茶吧。");
    return null;
  }
  
  const randomIndex = Math.floor(Math.random() * questions.length);
  const problem = questions[randomIndex];
  console.log(`🔍 小明发现了一个问题：${problem}`);
  
  // 勇气增加（因为尝试了）
  xiaoMing.courage += 5;
  if (xiaoMing.courage > 100) xiaoMing.courage = 100;
  
  return problem;
}

// 2. 生成新问题：利用创造力，将已有问题变形或组合
function generateNewProblem() {
  if (xiaoMing.creativity < 40) {
    console.log("小明创造力不足，暂时想不出新花样……多看看世界吧。");
    return null;
  }
  
  const templates = [
    (q) => `如果反过来想，${q.replace("？", "会怎样？")}`,
    (q) => `在火星上，${q.toLowerCase()}`,
    (q) => `如何用${["纸","水","影子","声音"][Math.floor(Math.random()*4)]}来解释：${q}`,
    (q) => `假如你只有3分钟，${q.replace("？", "？")}`,
    (q) => `用10个以内的字重新描述：${q}`
  ];
  
  const baseQuestion = questions[Math.floor(Math.random() * questions.length)];
  const template = templates[Math.floor(Math.random() * templates.length)];
  const newProblem = template(baseQuestion);
  
  console.log(`💡 小明创造了一个新问题：${newProblem}`);
  
  // 创造力提升（因为锻炼了）
  xiaoMing.creativity += 3;
  if (xiaoMing.creativity > 100) xiaoMing.creativity = 100;
  
  return newProblem;
}

// 3. 尝试解决问题（模拟）
function solveProblem(problem) {
  if (!problem) return false;
  
  const successChance = (xiaoMing.IQ - 80) * 2 + xiaoMing.creativity * 0.3;
  const roll = Math.random() * 100;
  
  if (roll < successChance) {
    console.log(`✅ 小明成功解决了问题：“${problem.substring(0, 20)}...”`);
    xiaoMing.solvedCount++;
    xiaoMing.IQ += 2;  // 智商微增
    xiaoMing.courage += 3;
    xiaoMing.creativity += 2;
    return true;
  } else {
    console.log(`❌ 小明没能解决：“${problem.substring(0, 20)}...” 但失败是成功之母！`);
    xiaoMing.courage -= 2; // 受挫
    xiaoMing.creativity += 1; // 从失败中学习
    return false;
  }
}

// 主循环：模拟小明一周的探索
console.log("=== 开始一周的探索 ===");
for (let day = 1; day <= 7; day++) {
  console.log(`\n--- 第 ${day} 天 ---`);
  
  // 每天先尝试发现一个问题
  let problem = discoverProblem();
  
  // 如果发现不了，就尝试生成一个
  if (!problem) {
    problem = generateNewProblem();
  }
  
  // 如果还是没有，就休息
  if (!problem) {
    console.log("今天小明休息了，养精蓄锐。");
    xiaoMing.courage += 5; // 休息恢复勇气
    continue;
  }
  
  // 尝试解决问题
  solveProblem(problem);
  
  // 每天结束时的状态
  console.log(`  状态：IQ=${xiaoMing.IQ}, 勇气=${xiaoMing.courage}%, 创造力=${xiaoMing.creativity}%`);
}

// 输出一周总结
console.log("\n=== 一周总结 ===");
console.log(`最终智商：${xiaoMing.IQ}（初始100）`);
console.log(`解决题目数：${xiaoMing.solvedCount}`);
console.log(`勇气：${xiaoMing.courage}%`);
console.log(`创造力：${xiaoMing.creativity}%`);

if (xiaoMing.IQ > 100) {
  console.log("🎉 小明的智商增长了！主动发现问题、创造问题真的有用！");
} else {
  console.log("💪 虽然智商没变，但勇气和创造力提升了。继续坚持，问题就是成长的阶梯！");
}

console.log("\n总结：智商增长不是被动等待，而是主动发现和创造问题的过程。");
console.log("就像这个程序一样，每一次尝试、每一次失败都在积累经验。");