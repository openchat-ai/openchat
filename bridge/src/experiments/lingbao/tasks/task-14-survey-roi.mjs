// 子任务 14: 工地电工访谈问卷 + ROI 测算模板
// 验收: 10 题问卷模板 + 1 份 Excel ROI 表 (节省工时/避免事故)
// 跑法: 44.doc-gen 渲 questionnaire + roi, 两个 CSV 拼出完整交付物

import { run as docRun } from '../44.mjs';

// === invariants ===
// - 问卷固定 10 题 (1-10), 顺序不可改
// - ROI 行数 >= 8 (覆盖 8 个核心指标)
// - 输出两个独立 .csv, 文件名固定
const QUESTIONS = [
  '您工地每月平均发生几次漏电报警? (A: <3  B: 3-10  C: >10)',
  '误报率大概多少? (A: <10%  B: 10-30%  C: >30%)',
  '现有漏电保护器响应时间? (A: <100ms  B: 100-500ms  C: >500ms)',
  '您是否能区分电弧故障 vs 普通漏电? (A: 能  B: 部分  C: 不能)',
  '您希望在手机 APP 上看到哪些信息? (多选: 漏电位置/电流曲线/电弧预警/历史)',
  '您接受每月多少费用用于升级? (A: <500  B: 500-2000  C: 2000-5000  D: >5000)',
  '您工地有几个电工? (填空)',
  '您对三级保护 (总/分/末端) 的态度? (A: 必要  B: 视情况  C: 不必要)',
  '您是否愿意试点 3 个月? (A: 愿意  B: 看价格  C: 不愿意)',
  '其他建议: ____________',
];

const ROI_ROWS = [
  { key: '电工时薪(元/小时)', value: 60 },
  { key: '误报导致人工排查次数/月', value: 8 },
  { key: '每次排查工时(小时)', value: 2 },
  { key: '每月节省工时(小时)', value: 12 },
  { key: '每年节省工时成本(元)', value: 8640 },
  { key: '电弧故障事故年均损失(元, 假设)', value: 50000 },
  { key: '事故降低率(AI 预警假设)', value: '60%' },
  { key: '年均事故避免损失(元)', value: 30000 },
  { key: '设备投入(20 万平项目, 元)', value: 147400 },
  { key: '年总节省(元)', value: 38640 },
  { key: '投资回收期(月)', value: 45.8 },
  { key: '5 年总收益(元)', value: 45800 },
];

const q = await docRun({ inputs: { op: 'render', kind: 'questionnaire', data: { items: QUESTIONS } } });
const roi = await docRun({ inputs: { op: 'render', kind: 'roi', data: { rows: ROI_ROWS } } });

// 写到 lingbao/tasks/output/ 让用户能直接拿走
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const outDir = 'output';
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'questionnaire-10q.csv'), q.outputs.content, 'utf8');
await writeFile(join(outDir, 'roi-template.csv'), roi.outputs.content, 'utf8');

console.debug('=== 问卷 (10 题) ===');
console.debug(q.outputs.content);
console.debug(`\n=== ROI 模板 (${ROI_ROWS.length} 行) ===`);
console.debug(roi.outputs.content);

const ok = q.outputs.bytes > 100 && q.outputs.content.includes('Q10') === false && QUESTIONS.length === 10
  && roi.outputs.bytes > 100 && ROI_ROWS.length >= 8;
console.debug(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
console.debug(`问卷: ${q.outputs.bytes}B → output/questionnaire-10q.csv`);
console.debug(`ROI: ${roi.outputs.bytes}B → output/roi-template.csv`);
process.exit(ok ? 0 : 1);
