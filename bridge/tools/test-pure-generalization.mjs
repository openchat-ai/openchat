import { vectorMemory } from '../src/core/vector-memory.js';

// First, store the meta-knowledge about strategy selection
vectorMemory.store({
  residentId: 'meta-lib',
  text: '策略选择通用方法：当面对多种解题策略时，按以下步骤选出最优策略：\n1. 列出所有可能的策略方向（如"先摸圆形"和"先摸星形"是两种不同策略）\n2. 对每个策略计算最坏情况下的总操作数\n3. 比较各个策略的总操作数，选最小的那个\n4. 如果两个策略结果相同，选执行步骤更少的\n\n示例：糖果题中"先摸全部星形"和"先摸全部圆形"是两种策略，应分别计算最坏情况下的摸取数量，再取较小的值。',
  metadata: { type: 'meta-reasoning', method: 'strategy-selection' },
  source: 'meta-library',
});
vectorMemory.save();

const q = '在一个黑色的袋子里放有三种口味的糖果，可以凭手感区分圆形和星形。苹果味圆形7苹果味星形7，桃子味圆形9桃子味星形6，西瓜味圆形8西瓜味星形4。最少取出多少个才能保证拿到不同形状的苹果味和桃子味的糖?';
const API_KEY = process.env.SILICONFLOW_API_KEY;
const API_BASE = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';

const hits = vectorMemory.search(q, { limit: 5, minScore: 0.01 });

console.log('命中的策略:');
for (const r of hits) {
  console.log('  [' + (r.score * 100).toFixed(0) + '%] ' + r.text.split('\n')[0].substring(0, 75));
}
console.log();

const prompt = '你是一个解题专家。题目中提到"靠手感可以分辨形状"，意味着你可以主动选择摸圆形还是星形。\n\n可用策略知识：\n' +
  hits.map((r,i) => (i+1) + '. ' + r.text.split('\n')[0]).join('\n') +
  '\n\n要求：\n1. 先列出所有可行的策略方向\n2. 对每个策略方向计算最坏情况下的摸取数量\n3. 比较后选出最优策略\n4. 给出最终答案和推导过程';

const res = await fetch(API_BASE + '/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
  body: JSON.stringify({ model: 'Qwen/Qwen2.5-72B-Instruct', messages: [{ role: 'system', content: prompt }, { role: 'user', content: q }], temperature: 0.2, max_tokens: 1024 }),
});
const data = await res.json();
const answer = data.choices?.[0]?.message?.content || '(empty)';
console.log('回答:\n');
console.log(answer);
