/**
 * 构建知识档案数据（供 Dashboard 展示）
 */
export async function buildKnowledge() {
  const domains = {};
  const recent = [];
  let evoCount = 0;
  let offlineCount = 0;
  try {
    const { readFile, readdir } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    const expDir = join(homedir(), '.openchat', 'experience');
    const evoFile = join(homedir(), '.openchat', 'memory', 'evolution-experiences.json');

    try {
      const raw = await readFile(evoFile, 'utf8');
      const evos = JSON.parse(raw);
      evoCount = Array.isArray(evos) ? evos.length : 0;
      if (Array.isArray(evos)) {
        for (const ev of evos) {
          if (!ev.success) continue;
          const task = (ev.task || '').toLowerCase();
          let domain = 'general';
          if (task.includes('math') || task.includes('数学') || task.includes('计算') || task.includes('概率')) domain = 'math';
          else if (task.includes('code') || task.includes('代码') || task.includes('编程') || task.includes('python')) domain = 'code';
          else if (task.includes('logic') || task.includes('逻辑') || task.includes('推理')) domain = 'logic';
          else if (task.includes('visual') || task.includes('可视化') || task.includes('图像') || task.includes('图')) domain = 'visual';
          else if (task.includes('network') || task.includes('网络') || task.includes('p2p')) domain = 'network';
          else if (task.includes('ai') || task.includes('模型') || task.includes('机器学习')) domain = 'ai';
          domains[domain] = (domains[domain] || 0) + 1;
          recent.push({ task: (ev.task || '').replace(/\n.*/s, '').slice(0, 40), domain, solvedAt: ev.timestamp, source: 'evolution' });
        }
      }
    } catch {}

    try {
      const files = (await readdir(expDir).catch(() => [])).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = await readFile(join(expDir, f), 'utf8');
          const e = JSON.parse(raw);
          const domain = (e.domain === 'reason' ? 'logic' : e.domain) || 'general';
          domains[domain] = (domains[domain] || 0) + 1;
          offlineCount++;
          if (e.solvedAt) recent.push({ task: e.question, domain, solvedAt: e.solvedAt, source: 'offline' });
        } catch {}
      }
    } catch {}
  } catch {}
  recent.sort((a, b) => (b.solvedAt || 0) - (a.solvedAt || 0));
  return { domains, recent: recent.slice(0, 8), total: evoCount + offlineCount, evoCount, offlineCount };
}

/**
 * 构建神经训练数据（供 Dashboard 展示）
 */
export async function buildNeural() {
  try {
    const { readFile } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    const logFile = join(homedir(), '.openchat', 'brain', 'training-log.json');
    const weightsFile = join(homedir(), '.openchat', 'brain', 'weights.json');

    const log = JSON.parse(await readFile(logFile, 'utf8'));
    const first = log[0], last = log[log.length - 1];
    const durH = ((last.time - first.time) / 3600000).toFixed(1);
    const samples = last.samples;
    const samplesGrowth = last.samples - first.samples;
    const accNow = (last.accuracy * 100).toFixed(1);
    const accFirst = (first.accuracy * 100).toFixed(1);
    const accDelta = ((last.accuracy - first.accuracy) * 100).toFixed(1);

    let weightsSize = 0;
    try { const stat = await import('fs/promises').then(m => m.stat(weightsFile)); weightsSize = stat.size; } catch {}

    const trend = [];
    const step = Math.max(1, Math.floor(log.length / 20));
    for (let i = 0; i < log.length; i += step) {
      trend.push({ s: log[i].samples, a: +(log[i].accuracy * 100).toFixed(1), t: log[i].time });
    }
    trend.push({ s: last.samples, a: +(last.accuracy * 100).toFixed(1), t: last.time });

    return { entries: log.length, samples, samplesGrowth, accNow, accFirst, accDelta, durH, weightsSize, trend };
  } catch { return null; }
}
