# spec: provider-health

> 启动 REPL 前的 LLM 健康诊断 (替换 dev-repl.mjs:127 的裸 `throw new Error('No available provider')`)

## 数据流
1. 读 `~/.config/openchat/config.json` (失败: 报 config-missing / parse-error)
2. 解析 `current.provider` (失败: 报 no-provider)
3. 构造降级链: `current` → `openrouter` → 其他有 `apiKey` 的 provider
4. 对每个候选查 `provider-kit.listPresetProviders()` 拿 `baseUrl` + `skipAuth`
5. 对每个候选真 `GET {baseUrl}/models` (Ollama 走 `/api/tags`)，3s 超时
6. 汇总 actionable 修复 (中文, 含具体命令)

## 接口签名
```js
diagnose({ configPath?: string, silent?: boolean })
  → Promise<{
      ok: boolean,                    // 任一 provider alive
      report: {                       // 结构化结果 (供机器读)
        checkedAt: ISO string,
        configPath: string,
        items: Array<{
          provider: string, model: string|null,
          baseUrl: string, hasApiKey: boolean, skipAuth: boolean,
          error?: string, fix?: string,
          alive?: boolean|null,       // null=跳过 ping
          ping?: { status, latencyMs, error }
        }>,
        firstAlive?: { name, model, baseUrl, ping },
        fix?: string
      },
      lines: string[],                // 已着色的可打印行 (silent 时不含 ANSI)
      firstAlive: object|null,
      fix: string|null
    }>
```

## 边界条件
- config 文件不存在 → `ok:false`, fix="创建配置文件: openchat config init..."
- config 是脏 JSON → `ok:false`, fix="修复 X 的 JSON 语法"
- current.provider 未设 → `ok:false`, fix="在 config.json 设 current.provider"
- provider 缺 apiKey（非 Ollama） → 该项 `error: 'no-api-key'`, fix 含具体 `config set` 命令
- Ollama 端点不可达 (timeout / ECONNREFUSED) → `alive:false`, fix="ollama serve"
- 端点返回 401/403 → `alive:false`, fix="重新设置 apiKey"
- 端点返回 404/429 → 算 alive=false (4xx 是配置错, 不算通)
- 端点返回 5xx → alive=false
- provider-kit 不可用 → presetMeta={}, 不影响主流程
- ping 网络层异常 → catch 写入 `error: e.message`, 不冒泡

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/provider-health.mjs` | 诊断核心 + actionable 报告 | 200 |
| `bridge/src/experiments/lib/dev-repl.mjs` | 调 diagnose() 替换 throw | (改 1 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `[provider-health] diagnose called` (待加) | 入口 |
| C2 | `provider {N} failed: {err}` | 降级链每项尝试 |
| C3 | `✓ {N} 存活` / `✗ {N} 不可达` | ping 结果 |
| C4 | `→ 修复: ...` | actionable 输出 |

## 不变量 (// === invariants === 块已嵌入源文件)
- 永不抛
- ping 硬超时 3s
- alive 判定: 2xx/3xx
- 不写盘
- silent 控制 ANSI
- 降级链顺序与 dev-repl.mjs 一致
- firstAlive 取首个存活
