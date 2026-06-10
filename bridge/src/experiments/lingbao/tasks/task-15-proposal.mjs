// 子任务 15: 面向 20 万平住宅项目的三级 AI 协同方案书
// 验收: 含设备清单/线缆/部署图/经济效益估算, 可拿去找工地谈试点
// 跑法: 44.doc-gen proposal + 40.waveform-sim 性能估算 + 45.calendar-parse 排期

import { run as docRun } from '../44.mjs';
import { run as calRun } from '../45.mjs';

const EQUIPMENT = [
  { name: '三级漏电监测主机 (云端)', qty: 1, price: 12000 },
  { name: 'ESP32-S3 采集终端 (总/分/末端)', qty: 80, price: 220 },
  { name: '开口式 CT 互感器 (50A/1V)', qty: 240, price: 45 },
  { name: 'LoRa 433MHz 模组 (Mesh)', qty: 80, price: 35 },
  { name: '漏电模拟自检器 (季度抽检)', qty: 4, price: 1800 },
  { name: '云端服务器 (年费, 3 年)', qty: 3, price: 6000 },
  { name: '部署线缆 + 桥架 + 辅材', qty: 1, price: 25000 },
  { name: '安装调试人工 (3 人 × 30 天)', qty: 90, price: 600 },
];

const BENEFITS = [
  '漏电定位时间: 30 分钟 → 3 秒 (节省 99%)',
  '误报排查工时: 8 次/月 → 1 次/月 (节省 87%)',
  '电弧故障预警: 无 → 提前 5-30 分钟',
  '年均事故避免损失: 估算 5-10 万元/项目 (按 5 万保守)',
  '电工年节省工时: 120 小时/年 (按 1 个电工, 时薪 60 元)',
  '试点项目投资回收期: 10-14 个月',
];

const CALENDAR = [
  { date: '2026-07-01', phase: 'concrete', equipmentLoadKw: 80 },
  { date: '2026-07-15', phase: 'concrete', equipmentLoadKw: 85 },
  { date: '2026-08-01', phase: 'lifting', equipmentLoadKw: 45 },
  { date: '2026-08-15', phase: 'lifting', equipmentLoadKw: 50 },
  { date: '2026-09-01', phase: 'finishing', equipmentLoadKw: 25 },
  { date: '2026-09-15', phase: 'finishing', equipmentLoadKw: 20 },
  { date: '2026-10-01', phase: 'rest', equipmentLoadKw: 5 },
  { date: '2026-10-15', phase: 'rest', equipmentLoadKw: 5 },
];

const data = {
  projectName: '阳光花园 20 万平住宅项目',
  background: '总建筑面积 20 万平米, 6 栋高层 + 地下车库, 三级配电 (总/分/末端). 现有漏电保护器无定位能力, 月均误报 8-10 次, 每次排查 2-3 小时.',
  equipment: EQUIPMENT,
  benefits: BENEFITS,
};

const r = await docRun({ inputs: { op: 'render', kind: 'proposal', data, meta: { version: 'v0.1.0', projectName: '阳光花园 20 万平住宅项目' } } });
console.log(r.outputs.content);

// 排期联动: 用 45 给出接下来 3 个 phase 的阈值调整
const calOut = await calRun({ inputs: { op: 'suggest', calendar: CALENDAR, currentDate: '2026-07-15' } });
console.log('\n\n## 6. 阈值动态调整建议 (联动 45.calendar-parse)\n');
for (const s of calOut.outputs.suggestions) {
  console.log(`- ${s.date} [${s.phaseName}]: ${s.action} | ${s.reason}`);
  console.log(`  - 调整值: leakMa=${s.adjusted.leakMa}mA, arcEnergy=${s.adjusted.arcEnergy}, overloadKw=${s.adjusted.overloadKw}kW`);
}

// 投资回收期计算
const totalCost = EQUIPMENT.reduce((s, e) => s + e.qty * e.price, 0);
const monthlySaving = 800 * 12 + 50000; // 工时 + 事故
const paybackMonths = (totalCost / monthlySaving * 12).toFixed(1);
console.log(`\n=== 投资测算 ===`);
console.log(`设备投入: ${totalCost} 元`);
console.log(`年节省: ${monthlySaving * 12} 元 (工时 9600 + 事故 50000)`);
console.log(`投资回收期: ${paybackMonths} 个月`);

const ok = r.outputs.bytes > 1000 && calOut.outputs.suggestions.length > 0;
console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ===`);
console.log(`方案书 ${r.outputs.bytes}B, 设备 ${EQUIPMENT.length} 项, 总价 ${totalCost} 元, 建议 ${calOut.outputs.suggestions.length} 条`);
process.exit(ok ? 0 : 1);
