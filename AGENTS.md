# 项目开发指南（常驻核 · 省 token）
> 每轮只注入本文件。细节按路由 **按需 read**，禁止默认读全文。
> 完整备份: `docs/agents/AGENTS-FULL.md`

## 铁律
1. 回复 ≤4 行；先做后说；Fix>report。
2. 改代码后：path-trace · 验证 · 对抗评审 → 问「可以推吗？」再 push。
3. 后台任务不准占主线；scope 只动任务相关路径。
4. Secrets 不进日志/PR/明文 prefs。Commit: `type: description` 全小写。
5. 一功能一提交；diff≤500；`.kt/.dart`≤200；>100 行要 `// === invariants ===`；新文件>50 行要 `.spec.md`。

## 路由（任务相关才读）
| 任务 | 只读 |
|------|------|
| mobile-agent-android | `mobile-agent-android/docs/PRODUCTION-LANDING-PROMPT.md` + baseline |
| Flutter / SDUI / 编译边界 | `docs/agents/flutter-sdui.md` |
| Qiniu/S3 | `docs/agents/qiniu.md` |
| Bridge/Node 命令与规范 | `docs/agents/bridge.md` |
| Spec-First / R1-R6 | `docs/agents/spec-rules.md` |
| 专家点评 `z` | `docs/agents/experts.md` |
| 记忆 | `MEMORY.md` 路由段 only |
| DNA 索引 | 需要时再查 `.dna/` / exp 42，不默认注入 |

## 技术栈（一行）
Bridge Node≥20 ESM Express · Flutter Riverpod · Qiniu S3 · 原生 mobile-agent 独立于 Flutter。

## 验证默认
- mobile-agent：**只认** `.github/workflows/mobile-agent-android.yml`（禁本地 gradle 宣称通过）
- bridge：`cd bridge && npm test` / lint
- flutter：能 SDUI/file:write/debug cmd 就不改 Dart、不编 APK

## 反模式
全文读 AGENTS-FULL · 重贴源码 · 本地假绿 · 静默 push · 双写 runtime 快照 · resume 重规划
