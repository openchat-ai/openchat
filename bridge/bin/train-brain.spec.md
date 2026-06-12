# spec: train-brain

> NeuralBrain 手动 seed + stats CLI (Step 4 / L2 局部辅助)

## 数据流
1. CLI 解析 args → 调对应分支
2. stats: 调 brain.getStats() → 打 console
3. predict: 调 predict/vectorize → 打 difficulty + domain + canLocal
4. bootstrap: 喂 20 个 seed sample → trainOnSolvedProblems
5. train: 单 sample train (复用 trainOnSolvedProblems)

## 接口签名
```
node bin/train-brain.mjs --stats
node bin/train-brain.mjs --predict "text"
node bin/train-brain.mjs --bootstrap
node bin/train-brain.mjs --text "..." --domain <math|logic|research|code_review> --difficulty <0-3> --label <success|fail>
```

## 边界条件
- 无 args → 打 usage
- 失败 label → 训练时 domain 换 'logic', difficulty +1
- 持久化: NeuralBrain 内部 writeFile ~/.openchat/brain/weights.json

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bin/train-brain.mjs` | CLI wrapper | 80 |
| `bin/train-brain.spec.md` | 本 spec | 50 |
