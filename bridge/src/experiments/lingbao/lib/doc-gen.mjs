// doc-gen: 4 种纯文本报告生成器 (Markdown / CSV / JSON 风格)
// 无外部依赖, 适合 sub-task 13/14/15 文档输出

// === invariants ===
// - 4 种 kind 各自固定 ext: report/proposal→md, questionnaire/roi→csv
// - 输出 UTF-8 字符串, bytes = Buffer.byteLength
// - 空 data 也输出有效模板
// - 不做 HTML 转义 (Markdown 安全上下文)

function escapeCsv(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function renderReport(data, meta) {
  const m = meta || {};
  const title = m.title || data.title || '灵保 MVP 实测报告';
  const date = m.date || new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 日期: ${date}  |  作者: ${m.author || '灵保实验组'}`);
  lines.push('');
  lines.push('## 一、电路设计');
  lines.push('');
  if (data.circuit) {
    lines.push('```');
    lines.push(data.circuit);
    lines.push('```');
  } else {
    lines.push('_(电路图占位)_');
  }
  lines.push('');
  lines.push('## 二、BOM 清单');
  lines.push('');
  if (Array.isArray(data.bom) && data.bom.length) {
    lines.push('| 物料 | 型号 | 数量 | 单价(元) |');
    lines.push('|------|------|------|----------|');
    for (const r of data.bom) {
      lines.push(`| ${escapeCsv(r.part)} | ${escapeCsv(r.model)} | ${r.qty} | ${r.price} |`);
    }
  } else {
    lines.push('_(BOM 占位)_');
  }
  lines.push('');
  lines.push('## 三、采集代码');
  lines.push('');
  if (data.code) {
    lines.push('```cpp');
    lines.push(data.code);
    lines.push('```');
  } else {
    lines.push('_(代码占位)_');
  }
  lines.push('');
  lines.push('## 四、分析脚本');
  lines.push('');
  if (data.script) {
    lines.push('```python');
    lines.push(data.script);
    lines.push('```');
  } else {
    lines.push('_(脚本占位)_');
  }
  lines.push('');
  lines.push('## 五、验收标准');
  lines.push('');
  if (Array.isArray(data.acceptance) && data.acceptance.length) {
    for (const a of data.acceptance) lines.push(`- [ ] ${a}`);
  } else {
    lines.push('- [ ] 漏电 30mA 触发报警');
    lines.push('- [ ] 定位准确率 >90%');
    lines.push('- [ ] 推送延迟 <3s');
  }
  return lines.join('\n');
}

function renderQuestionnaire(data) {
  const items = Array.isArray(data.items) && data.items.length
    ? data.items
    : [
        '您工地每月平均发生几次漏电报警?',
        '误报率大概多少?',
        '现有漏电保护器响应时间?',
        '您是否能识别电弧故障 vs 普通漏电?',
        '您希望在手机上看哪些信息?',
        '您接受每月多少费用用于升级?',
        '您工地有几个电工?',
        '您对三级保护(总/分/末端)的态度?',
        '您是否愿意试点 3 个月?',
        '其他建议: ____________',
      ];
  const lines = ['序号,问题'];
  items.forEach((q, i) => {
    lines.push(`${i + 1},${escapeCsv(q)}`);
  });
  return lines.join('\n');
}

function renderRoi(data) {
  const rows = Array.isArray(data.rows) && data.rows.length
    ? data.rows
    : [
        { key: '电工时薪(元/小时)', value: 50 },
        { key: '误报导致人工排查次数/月', value: 8 },
        { key: '每次排查工时(小时)', value: 2 },
        { key: '每月节省工时成本(元)', value: 800 },
        { key: '电弧故障事故年均损失(元)', value: 50000 },
        { key: '事故降低率(假设)', value: '60%' },
        { key: '年均事故节省(元)', value: 30000 },
        { key: '设备投入(20万平项目,元)', value: 80000 },
        { key: '投资回收期(月)', value: 10 },
      ];
  const lines = ['项目,数值'];
  for (const r of rows) {
    lines.push(`${escapeCsv(r.key)},${escapeCsv(r.value)}`);
  }
  return lines.join('\n');
}

function renderProposal(data, meta) {
  const m = meta || {};
  const projectName = m.projectName || data.projectName || '20 万平住宅项目';
  const lines = [];
  lines.push(`# 三级 AI 协同漏电防护方案 — ${projectName}`);
  lines.push('');
  lines.push(`> 版本: ${m.version || 'v0.1'}  |  日期: ${m.date || new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## 1. 项目背景');
  lines.push(data.background || '住宅项目三级配电, 漏电保护分级覆盖总/分/末端, 现有保护器无法定位故障回路与区分故障类型。');
  lines.push('');
  lines.push('## 2. 设备清单');
  lines.push('');
  if (Array.isArray(data.equipment) && data.equipment.length) {
    lines.push('| 设备 | 数量 | 单价(元) | 小计(元) |');
    lines.push('|------|------|----------|----------|');
    let total = 0;
    for (const e of data.equipment) {
      const sub = e.qty * e.price;
      total += sub;
      lines.push(`| ${escapeCsv(e.name)} | ${e.qty} | ${e.price} | ${sub} |`);
    }
    lines.push(`| **合计** | | | **${total}** |`);
  } else {
    lines.push('| 设备 | 数量 | 单价(元) | 小计(元) |');
    lines.push('|------|------|----------|----------|');
    lines.push('| 三级漏电监测主机 | 1 | 8000 | 8000 |');
    lines.push('| ESP32-S3 终端 | 20 | 200 | 4000 |');
    lines.push('| 开口式 CT | 60 | 50 | 3000 |');
    lines.push('| 漏电模拟器 | 1 | 2000 | 2000 |');
    lines.push('| **合计** | | | **17000** |');
  }
  lines.push('');
  lines.push('## 3. 部署图');
  lines.push('');
  lines.push('```');
  lines.push('[市电] → [总开关 + ESP32#1] → [分配电箱×3 + ESP32#2-4] → [末端×20 + ESP32#5-24]');
  lines.push('         ↓ LoRa Mesh <1ms 同步');
  lines.push('[云端 MQTT Broker] ← 4G/WiFi ← ESP32#1');
  lines.push('         ↓ WebSocket');
  lines.push('[电工 APP] + [云端分析]');
  lines.push('```');
  lines.push('');
  lines.push('## 4. 经济效益估算');
  lines.push('');
  if (Array.isArray(data.benefits) && data.benefits.length) {
    for (const b of data.benefits) lines.push(`- ${b}`);
  } else {
    lines.push('- 漏电定位时间: 30 分钟 → 3 秒 (节省 99%)');
    lines.push('- 误报排查工时: 8 次/月 → 1 次/月');
    lines.push('- 电弧故障预警: 无 → 提前 5-30 分钟');
    lines.push('- 年均事故避免损失: 估算 5-10 万元/项目');
  }
  lines.push('');
  lines.push('## 5. 试点建议');
  lines.push('');
  lines.push('1. 第 1 个月: 1 个 5 万平项目试点, 部署 1 套主机 + 5 个终端');
  lines.push('2. 第 2 个月: 扩展到 3 个项目, 收集数据');
  lines.push('3. 第 3 个月: 全面推广到 20 万平项目');
  return lines.join('\n');
}

function render(kind, data, meta) {
  if (!data || typeof data !== 'object') throw new RangeError('data must be object');
  switch (kind) {
    case 'report':
      return { content: renderReport(data, meta), ext: 'md', bytes: 0 };
    case 'questionnaire':
      return { content: renderQuestionnaire(data), ext: 'csv', bytes: 0 };
    case 'roi':
      return { content: renderRoi(data), ext: 'csv', bytes: 0 };
    case 'proposal':
      return { content: renderProposal(data, meta), ext: 'md', bytes: 0 };
    default:
      throw new RangeError(`unknown kind: ${kind} (expected report|questionnaire|roi|proposal)`);
  }
}

function renderWithBytes(kind, data, meta) {
  const r = render(kind, data, meta);
  r.bytes = Buffer.byteLength(r.content, 'utf8');
  return r;
}

export { render, renderWithBytes };
export default { render, renderWithBytes };
