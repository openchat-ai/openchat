# spec: dev-repl-smoke

> dev-repl 端到端 smoke 测试 (mock provider, 无 apiKey 也跑得通)

## 数据流
1. 加载 3 个 lib 模块（provider-health / slash-commands / repl-history）
2. 跑 4 段 14 用例：
   - 1. provider-health 契约（4 例）
   - 2. slash-commands 全部（3 例）
   - 3. repl-history 落盘+读取+续接+裁剪+防护（5 例）
   - 4. dev-repl 消息流模拟（2 例）
3. 报告: `node:assert` 严格模式 + `report.mjs` ok/ng 计数
4. 退出码: 0 全过 / 1 任一 fail

## 接口签名
```js
import { create } from '../../src/experiments/lib/report.mjs';
const r = create();
// 14 个 r.ok('...') 调用
r.report(NAME);
process.exit(r.ngCount > 0 ? 1 : 0);
```

## 边界条件
- 用户 `~/.config/openchat/config.json` 不存在 → diagnose 返回 ok:false, fix 含 "创建配置文件" ✅
- 用户 `~/.openchat/repl-history/<cid>.json` 不存在 → loadHistory 返回 [] ✅
- JSON 损坏 → loadHistory 返回 [] (不抛) ✅
- chatId 含 `../` → safeId 抛错 ✅
- 1100 条 append → 裁剪到 1000 ✅

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/tests/integration/dev-repl-smoke.mjs` | 14 用例端到端 smoke | 200 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `14/14 passed` | 全过 |
| C2 | `0 failed` | 无失败 |
| C3 | `exit=0` | 退出码 0 |

## 不变量
- 不依赖真 apiKey
- 不写盘（除 3d 测试临时文件, 用完即删）
- 不阻塞 dev-repl 启动（无副作用导入）
- 退出码 0 = 全过, 1 = 任一 fail (供 CI 集成)
