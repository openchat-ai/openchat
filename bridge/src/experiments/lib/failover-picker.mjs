// === failover-picker.mjs ===
// 运行时降级链选择器 (替代 dev-repl 里 connect 试错 — 每次失败等 5-10s)
//
// 流程: 对降级链每个候选先做轻量 ping (≤3s), 首个 alive 再 createProvider+connect
//   - 启动时: pickFirstAlive(fallbacks, cfg) → { provider, label, pickedFrom }
//   - 运行时切: pickFirstAlive(remainingFallbacks, cfg) → 同上
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   pickFirstAlive(fallbacks, cfg, { silent, timeoutMs? })
//     → { ok, provider?, label?, pickedFrom, tried: [{name, ping, error?}], fix? }
//
// === invariants ===
// - 真 ping 永不抛 — 全部错误降级为 tried[i].error
// - 真 ping 超时硬上限 3000ms (可配, 上限 10000)
// - 只对**首个 alive** 调 createProvider+connect, 不浪费 5-10s 在死端点
// - 不写盘, 不持久化任何结果
// - silent=true 不打 stdout, 供测试断言

import { pingProvider } from './provider-health.mjs';

export async function pickFirstAlive(fallbacks, cfg = {}, { silent = false, timeoutMs = 3000 } = {}) {
  const tried = [];
  const log = (s) => { if (!silent) process.stdout.write(s); };

  for (const fb of fallbacks) {
    const pcfg = cfg.providers?.[fb.name] || {};
    const ping = await pingProvider(fb.name, pcfg, { timeoutMs });
    tried.push({ name: fb.name, model: fb.model, ping });

    if (ping.error === 'no-api-key') {
      log(`\x1b[90m[failover] ${fb.name}: 缺 apiKey, 跳过\x1b[0m\n`);
      continue;
    }
    if (ping.error === 'no-baseurl') {
      log(`\x1b[90m[failover] ${fb.name}: 缺 baseUrl, 跳过\x1b[0m\n`);
      continue;
    }
    if (!ping.ok) {
      log(`\x1b[90m[failover] ${fb.name} 不可达 (${ping.status || ping.error}), ${ping.latencyMs}ms\x1b[0m\n`);
      continue;
    }

    // 首个 alive: 真 createProvider + connect
    log(`\x1b[32m[failover] ${fb.name} 存活 (${ping.status}, ${ping.latencyMs}ms), 正在 connect...\x1b[0m`);
    try {
      const { createProvider } = await import('provider-kit');
      const p = createProvider(fb.name, pcfg.apiKey);
      await p.connect(pcfg.apiKey);
      log(' \x1b[32m✓\x1b[0m\n');
      return { ok: true, provider: p, label: `${fb.name}/${fb.model}`, pickedFrom: fb.name, tried };
    } catch (e) {
      log(` \x1b[31m✗ connect 失败: ${e.message?.slice(0, 60)}\x1b[0m\n`);
      tried[tried.length - 1].connectError = e.message;
    }
  }

  // 全部失败
  return {
    ok: false,
    provider: null,
    label: '',
    pickedFrom: null,
    tried,
    fix: '所有 provider 都不可用, 用 `config set <provider> <key>` 或 `ollama serve` 修好后重试',
  };
}

export const META = { id: 'failover-picker' };
