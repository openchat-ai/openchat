import { vectorMemory } from '../src/core/vector-memory.js';

const API_KEY = process.env.SILICONFLOW_API_KEY;
const API_BASE = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
const MODEL = 'Qwen/Qwen2.5-72B-Instruct';

// 1. Add sensory knowledge / 添加触觉感知知识
const sensory = [
  '触觉感知：不同形状的物体在手感上完全不同，圆形光滑，星形有尖角，闭着眼睛也能准确分辨',
  '触觉在决策中的作用：当你可以通过触觉区分物体形状时，你可以主动选择特定形状，而不是完全随机抽取',
  '多感官决策：利用触觉信息可以优化抽取策略——先通过手感挑出所有圆形目标，再单独处理星形',
  '触觉与视觉的互补：黑色袋子看不见但手能摸到形状，这种触觉信息是制定最优策略的关键依据',
  '抽屉原理结合触觉：当你摸到某个形状时，你知道它是什么形状，可以据此计算已取的各种形状数量',
];

// Remove old sensory entries, add new ones
vectorMemory._entries = vectorMemory._entries.filter(e => e.source !== 'sensory');
for (const text of sensory) {
  vectorMemory.store({ residentId: 'sensory-lib', text, metadata: { type: 'sensory-perception' }, source: 'sensory' });
}
vectorMemory.save();
console.log(`Stored ${sensory.length} sensory entries (total: ${vectorMemory._entries.length})`);

// 2. Re-run candy problem
const q = '在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状(圆形和五角星形，不同的形状靠手感可以分辨)。苹果味圆形7苹果味星形7，桃子味圆形9桃子味星形6，西瓜味圆形8西瓜味星形4。最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖?';

const related = vectorMemory.search(q, { limit: 5, minScore: 0.01 });
console.log('\n=== 命中知识 ===');
for (const r of related) {
  console.log(`[${(r.score*100).toFixed(1)}%] [${r.source}] ${r.text.substring(0,80)}`);
}

const sysPrompt = '你是一个善于利用多感官知识的AI解题专家。注意题目中提到了"靠手感可以分辨形状"，这意味着摸糖的人可以通过触觉区分圆形和星形。请充分利用这个信息。\n\n参考以下相关知识：\n' +
  related.map((r, i) => `知识${i+1}: ${r.text}`).join('\n');

console.log('\n=== LLM 请求 ===');
const start = Date.now();
const res = await fetch(`${API_BASE}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: q }],
    temperature: 0.3, max_tokens: 1024,
  }),
});
const data = await res.json();
const ans = data.choices?.[0]?.message?.content || '(empty)';
console.log(`耗时: ${((Date.now()-start)/1000).toFixed(1)}s`);

console.log('\n=== 回答 ===');
console.log(ans);
