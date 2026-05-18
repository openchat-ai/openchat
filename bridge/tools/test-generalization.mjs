#!/usr/bin/env node
/**
 * Full generalization pipeline test — runs resident-manager.think() with real LLM.
 * 完整泛化链路测试：通过 resident-manager.think() 调用真实 LLM。
 *
 * Usage: node tools/test-generalization.mjs "你的问题"
 *   --use-mock   use mock LLM instead of real API (faster for testing)
 */
const USE_MOCK = process.argv.includes('--use-mock');
const question = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ') || '冰箱里只剩鸡蛋、番茄和葱，晚餐做什么？';

const API_KEY = process.env.SILICONFLOW_API_KEY;
const API_BASE = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
const MODEL = 'Qwen/Qwen2.5-72B-Instruct';

import { residentManager } from '../src/core/resident-manager.js';
import { persistentConfig } from '../src/core/persistent-config.js';
import { vectorMemory } from '../src/core/vector-memory.js';

// Ensure a test resident exists
const testResident = residentManager.create('测试居民', {
  id: 'eval-resident-001',
  traits: { curiosity: 0.9, creativity: 0.8, diligence: 0.7 },
});

async function callSiliconFlow(messages) {
  if (USE_MOCK) {
    return {
      content: '=== 经验分析 ===\n模式：多角度思考\n=== 思路 1 ===\n分析：直接方案\n方案：方案A\n=== 思路 2 ===\n分析：备选方案\n方案：方案B\n=== 选择结果 ===\n最佳思路：1\n理由：简单直接\n学到的经验：从多角度分析问题',
      model: 'mock',
    };
  }
  const r = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message || { content: 'ERROR: no response', model: MODEL };
}

// Hook into resident-manager's llm-request event
residentManager.setMaxListeners(20);
residentManager.on('llm-request', async ({ messages, model, temperature, resolve, reject }) => {
  try {
    console.log(`[LLM] Sending ${messages.length} messages, model=${model || MODEL}`);
    const result = await callSiliconFlow(messages);
    resolve(result);
  } catch (e) {
    console.error('[LLM] Error:', e.message);
    reject(e);
  }
});

// Ensure vector memory has some data for generalization to find
const existing = vectorMemory.search(question, { limit: 1 });
if (existing.length === 0) {
  // Seed a relevant experience
  vectorMemory.store({
    residentId: 'math-lib',
    text: '遇到开放式问题，可以先从不同角度分析，给出多种解法：最简单最快的方法、最彻底最花时间的方法、折中方案。最后根据条件推荐一个。',
    metadata: { type: 'general-problem-solving' },
    source: 'example',
  });
  vectorMemory.save();
}

async function main() {
  console.log(`\n=== 泛化链路测试 ===\n`);
  console.log(`问题: ${question}\n`);
  console.log(`模式: ${USE_MOCK ? 'MOCK (模拟LLM)' : 'REAL (SiliconFlow ' + MODEL + ')'}`);

  // Run think() with generalization enabled (default)
  const startTime = Date.now();
  const result = await residentManager.think({
    messages: [{ role: 'user', content: question }],
    residentId: 'eval-resident-001',
    timeout: 60000,
    useGeneralization: true,
    useMultiPath: true,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n[结果 - 耗时 ${elapsed}s]`);
  console.log(`模型: ${result.model}`);
  console.log(`Token: ${JSON.stringify(result.tokens)}`);
  console.log(`\n--- 回答 ---\n${result.content}`);
}

main().catch(e => console.error('Fatal:', e.message)).finally(() => {
  // Cleanup test resident
  try { residentManager.delete('eval-resident-001'); } catch {}
});
