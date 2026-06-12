# spec: swap-m2

> Mirror spec for `bin/swap-m2.mjs`. Ops 工具 — M2/M3 provider 切换, 跑跨模型对比用. Required by `verify-commit` quality gate.

## 数据流
1. CLI parse `process.argv.slice(2)` → 命令 (`--restore`/`--status`/`--help`/default-swap)
2. Default swap 路径:
   - 读 `~/.config/openchat/config.json`
   - 备份到 `.m2swap.bak` (如未备份)
   - 验 `cfg.providers.openrouter.apiKey` 存在 → 不在则报错 + exit 1
   - 改 `cfg.current = { provider: 'openrouter', model: <M2_DEFAULT_MODEL | --model 参数> }`
   - 写回 cfg, 创建 `.m2swap-active` marker
3. `--restore` 路径:
   - 检查 marker 存在 → 不存在则 no-op + 提示
   - 读 `.m2swap.bak` → 写回 `config.json`
   - 删 marker
4. `--status` 路径:
   - 读 cfg → 打印 provider/model/key/swap 状态 (不修改任何文件)

## 接口签名
```js
// CLI entry
node bin/swap-m2.mjs                 → swap to M2 (default: anthropic/claude-sonnet-4-6)
node bin/swap-m2.mjs --model <m>     → swap to custom model (openrouter path)
node bin/swap-m2.mjs --restore       → restore from .m2swap.bak
node bin/swap-m2.mjs --status        → print current state (read-only)
node bin/swap-m2.mjs --help          → usage

// 内部
async readConfig() → object               // JSON.parse(config.json)
async writeConfig(cfg) → void              // JSON.stringify + write
async isSwapped() → bool                   // fs.access(SWAP_MARKER)
async setSwapped(flag) → void              // create/unlink marker
async doSwap(model) → void
async doRestore() → void
async doStatus() → void

// 常量
CONFIG_PATH = ~/.config/openchat/config.json
BACKUP_PATH = CONFIG_PATH + '.m2swap.bak'
SWAP_MARKER = ~/.config/openchat/.m2swap-active
M2_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'
M3_DEFAULT = { provider: 'minimax', model: 'MiniMax-M3' }
```

## 边界条件
- config.json 不存在 → readFile throws → 进程崩 (无 catch, 故意)
- openrouter.apiKey 缺失 → stderr 报错 + exit 1, 不动 cfg
- 已 swap 状态再次 swap → 跳过备份步骤 (不覆盖原备份), 仍写新 cfg
- `--restore` 时 marker 不存在 → no-op 提示, exit 0
- `--restore` 时备份文件被删 → readFile throws → catch + 报错 + exit 1
- `--model` 后没参数 → 退回 M2_DEFAULT_MODEL
- 同时传 `--restore` 和 `--status` → `--restore` 先匹配, 走 restore 路径

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| `bin/swap-m2.mjs` | swap 主脚本 | 200 |
| `bin/swap-m2.spec.md` | 本 spec | - |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|--------------|------|
| 1 | `[swap] ✓ 切到 M2` | swap 成功 |
| 2 | `[swap] ✓ 已恢复` | restore 成功 |
| 3 | `[swap] 错误: config.providers.openrouter.apiKey 不存在` | key 缺失 |
| 4 | `[swap] 未在 swap 状态` | restore 无 marker |
| 5 | `swap 状态 = ` | `--status` 输出末尾标志位 |

## 已知局限
- 只支持 openrouter 作为目标 provider (其它 provider 切换要改 `cfg.current.provider`)
- 不处理 config.json 并发写入 (假设单进程操作)
- 备份只保留一份 (重复 swap 不会再备份, 防覆盖)
- 不验证目标 model 在 openrouter 实际可用 (运行时再失败)
