# OpenChat Reasoning Architecture / 推理架构

## Dual-Engine Reasoning / 双引擎推理

```
                    ┌─────────────────────┐
                    │     Problem Input    │
                    │       问题输入        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   ReasoningChain    │
                    │     推理链编排       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                │                ▼
    ┌─────────────┐           │       ┌──────────────┐
    │  Deduction  │           │       │  Induction   │
    │  演绎引擎    │           │       │  归纳引擎     │
    │             │           │       │               │
    │ TheoremDB   │           │       │ Inductive     │
    │ ↓           │           │       │ Reasoner      │
    │ 公理→定理   │           │       │ ↓             │
    │ 确定性推导  │           │       │ 样本→规律     │
    └──────┬──────┘           │       │ 猜想→验证     │
           │                 │       └──────┬────────┘
           │ 命中 → 直接答   │              │
           │                 │              │ 发现新定理
           │                 │              ▼
           │                 │    ┌──────────────┐
           │                 │    │  TheoremDB   │
           │                 │    │  注册新定理   │
           │                 │    └──────┬───────┘
           │                 │           │
           │                 │    ┌──────▼───────┐
           │                 │    │  P2P Share   │
           │                 │    │  广播给邻居   │
           │                 │    └──────────────┘
```

## Components / 组件

| 模块 | 文件 | 职责 |
|---|---|---|
| ReasoningChain | `reasoning-chain.js` | 编排双引擎，统一求解入口 |
| TheoremDB | `theorem-db.js` | 公理定理库，40+ 条自带公理 |
| InductiveReasoner | `inductive-reasoner.js` | 样本→公式拟合→验证 |
| SymbolicReasoner | `symbolic-reasoner.js` | 符号演算，数学推导 |
| ModelManager | `model-manager.js` | 领域分模型管理 |
| NeuralMesh | `neural-mesh.js` | P2P 联邦权重平均 |

## Key Principle / 核心理念

**Zero LLM cost / 零 LLM 成本**

每个节点独立运行，不调用外部 AI。定理库从 40 条公理起步，通过学习求解过程中的样本模式逐步扩展。每个 Fairy 发现的新定理通过 P2P 同步到其他节点。

## Growth Path / 增长路径

1. 初始：40 条内置公理（arithmetic / algebra / geometry / probability）
2. 解题：SymbolicReasoner 用已知定理匹配求解
3. 积累：同题型 ≥3 个样本 → InductiveReasoner 归纳规律
4. 验证：所有样本通过 → 确认新定理 → 写入 TheoremDB
5. 广播：P2P 发送给邻居 → 集体定理库增长
6. 下次：新定理立即可用，不需要重新归纳
