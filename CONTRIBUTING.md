# Contributing

## Quick start

```bash
git clone https://github.com/peertalk-ai/peertalk.git
cd bridge
npm install
npm test    # 60+ tests should pass
npm start   # Start Bridge locally
```

## First time? Start here

- Browse **good first issue** labeled issues on GitHub
- Read the [ARCHITECTURE-OVERVIEW](docs/ARCHITECTURE/ARCHITECTURE-OVERVIEW.md) for system design
- Join the discussion in existing PRs before opening a new one
- Have a question? Open a Discussion, not an Issue

## FAQ / 常见问题

**Bridge 启动报 hyperswarm/hyperdht 错误？**
这是已知的 Node 24 兼容性问题。如不需要 P2P，用 `--headless --no-p2p` 启动。

**怎么测试泛化求解器？**
```bash
cd bridge
node -e "await import('./src/core/generalization.js').then(m=>m.generalizationEngineV2.solve({question:'苹果味圆形7苹果味星形7，桃子味圆形9桃子味星形6，西瓜味圆形8西瓜味星形4'}).then(r=>console.log(r.content)))"
```

**embedding 搜索需要配置？**
设置 `SILICONFLOW_API_KEY` 环境变量。未设置时自动降级为 TF-IDF。

**测试怎么跑？**
```bash
cd bridge && npm test        # 后端 80+ 测试
cd openchat-flutter && flutter test  # 前端 12 测试
```

## Git workflow

```bash
# Start a new feature
git checkout master
git pull
git checkout -b feat/your-feature

# Work on it, commit often
git add .
git commit -m "feat: your change description"

# Push opens a PR (direct push to master is blocked by pre-push hook)
git push origin feat/your-feature

# After PR review and merge, delete local branch
git checkout master
git pull
git branch -d feat/your-feature
```

## Where to contribute

| Area | Files | Good for |
|------|-------|----------|
| LLM providers | `modules/provider-kit/src/providers/` | Adding new provider adapters |
| Agent loop | `bridge/src/core/agent-engine.js` | Improving Think-Act-Verify |
| Memory | `bridge/src/core/evolution-memory.js` | Memory recall/search strategies |
| Web UI | `bridge/src/main.js` (_mountLegacyRoutes) | Dashboard / live chat |
| Flutter | `openchat-flutter/` | Mobile client |

## Branch strategy

- `master` — stable release branch. Protected, requires PR review to merge.
- `feat/*` — feature branches. Naming: `feat/short-description`.
- `fix/*` — bug fix branches. Naming: `fix/short-description`.
- `release/*` — release preparation branches.
- Direct pushes to `master` are disabled. All changes go through PRs.

## Release process

1. Branch `release/vX.Y.Z` from `master`
2. Bump version in `bridge/package.json`, update `CHANGELOG.md`
3. Create tag `vX.Y.Z` on `master` after merge
4. Github Actions builds artifacts automatically

## Commit format

```
type: short description (English)

type: feat / fix / refactor / test / docs / chore
```

## Before submitting

- `npm test` passes (bridge)
- `npm test` passes (modules/provider-kit)
- `npm audit` passes
