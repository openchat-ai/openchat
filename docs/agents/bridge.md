# Bridge / Node（按需）
```
cd bridge
npm start | npm run dev | npm run lint | npm test | npm run push
npm run pm2:start|stop|status
```
- ESM only · 2 空格 · 单引号 · 分号 · camelCase · 禁空 catch · fs/promises
- Node 本地用 22（engines `>=20.10.0 <23`）；端口 **3800** `GET /health`
- provider-kit: 改模块 → npm version patch → publish → bridge install 新版（禁 xcopy）
- 实验: `bridge/src/experiments/` · 树 `EXPERIMENT_TREE.md` · `node src/experiments/run-all.mjs`
- DNA: `.dna/project-dna.json`；查询用 exp42 / coding-tools，勿默认全量注入
