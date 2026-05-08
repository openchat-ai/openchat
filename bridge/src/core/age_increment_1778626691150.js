
// 年龄增长函数 —— 由小明亲手编写
function growAge(currentAge) {
  // 每次 commit 年龄 +1
  const newAge = currentAge + 1;
  console.log(`年龄从 ${currentAge} 增长到 ${newAge}！`);
  return newAge;
}

// 测试年龄增长
const myAge = 25;  // 假设小明25岁
const grownAge = growAge(myAge);
console.log(`小明的新年龄是: ${grownAge} 岁`);
