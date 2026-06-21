// 子任务 10: 云端告警推送服务 (MQTT/WebSocket, 定位结果推送)
// 验收: 给定漏电事件, 3 秒内推送到 APP 端, 带"哪一级/哪一路/可能原因"
// 跑法: 40.waveform-sim 生成漏电 → 41.signal-algo 互相关定位 → 42.mqtt-push 推送

import { run as simRun } from '../40.mjs';
import { run as algoRun } from '../41.mjs';
import { getBus } from '../42.mjs';

// === invariants ===
// - 端到端延迟目标: 3 秒 (推文内 <100ms, 留余量)
// - 推送 payload 必含: level(级) + circuit(路) + reason + ts + waveformRef
// - 不真接 broker, 用 in-process bus 模拟
// - 单测路径不依赖真实 ESP32
const START = Date.now();

function elapsed() { return Date.now() - START; }

async function main() {
  const results = [];
  const bus = await getBus();

  // 3 个并发漏电事件, 模拟多回路同时告警
  const events = [
    { id: 'EVT-001', level: 1, circuit: 'L1-A', leakStartMs: 50, leakLevelMa: 80 },
    { id: 'EVT-002', level: 2, circuit: 'L2-B', leakStartMs: 60, leakLevelMa: 55 },
    { id: 'EVT-003', level: 3, circuit: 'L3-C', leakStartMs: 40, leakLevelMa: 120 },
  ];

  for (const ev of events) {
    const t0 = Date.now();

    // 1. 合成漏电波形
    const simOut = await simRun({
      inputs: { op: 'generate', durationMs: 200, leakStartMs: ev.leakStartMs, leakLevelMa: ev.leakLevelMa, sampleRate: 12800 },
    });
    const t1 = Date.now();

    // 2. 信号分析 (漏电检测 + 定位)
    const detectOut = await algoRun({
      inputs: { op: 'detectLeak', samples: simOut.outputs.samples, sampleRate: 12800 },
    });
    const arcOut = await algoRun({
      inputs: { op: 'arcEnergy', samples: simOut.outputs.samples, sampleRate: 12800, bandHz: [3000, 6000] },
    });
    const t2 = Date.now();

    // 3. 定位 (互相关): 用同 phase 参考信号
    const refOut = await simRun({
      inputs: { op: 'generate', durationMs: 200, leakStartMs: 0, leakLevelMa: ev.leakLevelMa, sampleRate: 12800 },
    });
    const corrOut = await algoRun({
      inputs: { op: 'crossCorrelate', samples: simOut.outputs.samples, b: refOut.outputs.samples },
    });
    const t3 = Date.now();

    // 4. 推送
    const reasonParts = [];
    if (detectOut.outputs.result.triggered) reasonParts.push(`漏电 ${detectOut.outputs.result.peakMa.toFixed(0)}mA`);
    if (arcOut.outputs.result.isArc) reasonParts.push('疑似电弧');
    const reason = reasonParts.length ? reasonParts.join('+') : '未知';
    const lag = corrOut.outputs.result.lag;
    const lagMs = (lag / 12800 * 1000).toFixed(1);
    const payload = {
      eventId: ev.id,
      level: ev.level,
      circuit: ev.circuit,
      reason,
      peakMa: detectOut.outputs.result.peakMa,
      isArc: arcOut.outputs.result.isArc,
      arcRatio: arcOut.outputs.result.ratio,
      locationLagMs: lagMs,
      confidence: corrOut.outputs.result.confidence,
      waveformRef: `s3://lingbao/waveforms/${ev.id}.csv`,
      ts: Date.now(),
    };
    const pubOut = bus.publish(`alert/${ev.circuit}`, payload);
    const t4 = Date.now();

    results.push({
      eventId: ev.id,
      steps: {
        simulate: t1 - t0,
        analyze: t2 - t1,
        correlate: t3 - t2,
        publish: t4 - t3,
        total: t4 - t0,
      },
      payload,
      delivery: pubOut,
    });
  }

  // 5. 验证订阅端收到
  await new Promise(r => setTimeout(r, 100));
  const stats = bus.stats();
  const history = bus.history('alert/L1-A', 1);

  return {
    results,
    stats,
    sampleHistory: history,
    elapsed: elapsed(),
  };
}

const task = await main();
console.debug(JSON.stringify(task, null, 2));

// 验收判定
const ok = task.results.every(r => r.delivery.deliveryId && r.steps.total < 3000);
console.debug(`\n=== 验收: ${ok ? 'PASS' : 'FAIL'} ===`);
console.debug(`推送 ${task.results.length} 个事件, 端到端最长 ${Math.max(...task.results.map(r => r.steps.total))}ms`);
console.debug(`bus 总投递: ${task.stats.totalDelivered}, channels: ${task.stats.channels}`);
process.exit(ok ? 0 : 1);
