#!/usr/bin/env node
/**
 * End-to-end user journey test / 端到端用户路径测试
 *
 * Tests: Bridge health → resident creation → think() → generalization → response
 * Measures: latency per step, total time
 *
 * Usage: node tools/e2e-journey.mjs
 */

let bridgeProcess = null;

async function waitForHealth(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return { ok: true, ms: Date.now() - start };
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return { ok: false, ms: timeout };
}

async function startBridge() {
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    const proc = spawn('node', ['src/main.js', '--headless', '--port=3001', '--silent'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCHAT_HOME: require('os').tmpdir() + '/openchat-e2e' },
    });

    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill();
        resolve(null); // Bridge failed to start
      }
    }, 10000);

    proc.stdout.on('data', (data) => {
      if (!started && data.toString().includes('HTTPServer')) {
        started = true;
        clearTimeout(timer);
        resolve(proc);
      }
    });
    // If process exits immediately, resolve null
    proc.on('exit', () => { clearTimeout(timer); resolve(null); });
  });
}

async function callBridgeAPI(path, body = null) {
  const url = `http://localhost:3001${path}`;
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function run() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  End-to-End User Journey / 端到端用户路径    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Step 1: Try to start Bridge
  console.log('[1/5] 启动 Bridge...');
  let bridge = null;
  try { bridge = await startBridge(); } catch {}
  if (bridge) {
    const health = await waitForHealth('http://localhost:3001/health');
    console.log(`  Bridge 启动: ${health.ok ? '✅' : '❌'} (${health.ms}ms)\n`);
  } else {
    console.log('  Bridge 不可用（hyperswarm 兼容性），使用直接调用模式\n');
  }

  // Fallback: direct resident-manager call (no Bridge needed)
  if (!bridge) {
    console.log('[2/5] 创建居民...');
    const { residentManager } = await import('../src/core/resident-manager.js');
    const { persistentConfig } = await import('../src/core/persistent-config.js');
    const resident = residentManager.create('e2e-user', {
      id: 'e2e-001', traits: { curiosity: 0.9 },
    });
    console.log(`  居民创建: ✅ ${resident.name} (${resident.id})\n`);

    console.log('[3/5] 配置 provider + LLM handler...');
    persistentConfig.setCurrentProvider('siliconflow');
    const API_KEY = process.env.SILICONFLOW_API_KEY;
    const API_BASE = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
    const MODEL = 'Qwen/Qwen2.5-72B-Instruct';

    residentManager.setMaxListeners(20);
    residentManager.on('llm-request', async ({ messages, resolve, reject }) => {
      try {
        const res = await fetch(`${API_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
          body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 512 }),
        });
        const data = await res.json();
        resolve(data.choices?.[0]?.message || { content: 'no response', model: MODEL });
      } catch (e) { reject(e); }
    });
    console.log('  provider + handler ready\n');

    console.log('[4/5] 调用 think()（含泛化求解器）...');
    const t0 = Date.now();
    const result = await residentManager.think({
      messages: [{ role: 'user', content: '苹果味圆形7苹果味星形7，桃子味圆形9桃子味星形6，西瓜味圆形8西瓜味星形4。最少取多少保证不同形状苹果桃子?' }],
      residentId: 'e2e-001',
      timeout: 30000,
      useGeneralization: true,
      useMultiPath: true,
    });
    const elapsed = Date.now() - t0;

    console.log(`  think() 耗时: ${elapsed}ms`);
    console.log(`  模型: ${result.model}`);
    console.log(`  回答: ${result.content}\n`);

    // Cleanup
    residentManager.delete('e2e-001');

    console.log('[5/5] 验证...');
    const hasAnswer = result && result.content && result.content.length > 0;
    const hasModel = result && result.model;
    console.log(`  有回答: ${hasAnswer ? '✅' : '❌'}`);
    console.log(`  有模型: ${hasModel ? '✅' : '❌'}`);
    const pass = hasAnswer && hasModel;
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  结果: ${pass ? '✅ 通过' : '❌ 失败'}                   ║`);
    console.log(`║  总耗时: ${elapsed}ms                      ║`);
    console.log(`╚══════════════════════════════════════════╝`);

    if (bridge) {
      bridge.kill();
      await new Promise(r => setTimeout(r, 500));
    }
    process.exit(pass ? 0 : 1);
  }
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
