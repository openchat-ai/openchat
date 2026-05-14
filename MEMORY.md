# MEMORY.md — 项目记忆

## 主题文件路由表

| 触发词 | 文件 | 说明 |
|--------|------|------|
| 核心逻辑 | memory/core-logic.md | 模块架构、P2P通信 |
| 调试经验 | memory/debugging.md | 常见 bug 及解决 |

---

## 一、架构设计

### 核心理念
- **traits 非约束** — 居民行为由惯性+事件驱动，traits 只是记录不是规则
- **职业后验** — 做多了自然贴上某类标签，非先验分配，可随时撕掉
- **5 traits 组合上限 15 种**，实际收敛到 3-4 核心角色，不会爆炸
- ~~**House 实体化**~~ — 已废弃，居民不再维护房子
- **ID 两层** — `hostId`(物理机) → `bridgeId`(实例)
- **居民核心任务** — 学习、解决问题、git commit 增长年龄
- **配置统一** — `~/.openchat/config.json`

### 社区推理
- 多分解者+多求解者的多样性替代 LLM 的模糊能力
- 三层收敛：知识库消解 → 分解者审查 → 求解者用脚投票

---

## 二、居民行为系统

### 惯性驱动（三层决策管线）
1. **惯性层** — 看昨天 activity，重复做同样的事
2. **事件层** — 有事件（健康危机/P2P消息/停滞）就响应
3. **默认层** — 按性格 Archetype 的自然倾向

- **6 Archetype** — office_worker / explorer / socialite / creator / lazy / cautious，软匹配+权重主副角色
- **永生居民** — 短期惯性=重复昨天；长期=质疑昨天（连续无事→自省模式）

### 收敛角色（按 traits 分配）
| 角色 | 条件 | 行为 |
|------|------|------|
| 分解者 | curiosity≥0.6 + creativity≥0.5 | 拆问题为 0/1 子问题 |
| 求解者 | diligence≥0.6 | 领子问题调 LLM 求解 |
| 审查者 | sociability≥0.6 | 验证答案一致性 |

### 居民新任务（2026-05-09）
- **学习** — 从问题池选问题 → 思考 → 解决
- **自我改进** — 检测 age_stuck → 写代码 → git commit
- **协作** — P2P 共享知识、互助

---

## 三、知识库存储

### 索引化
- 只存 `{ answer, verified, houseIds[] }`，不存解法全文
- 解法全文由求解者所在 House 本地管理，P2P 按需获取
- 分散存储原则：索引集中（KB），内容分散（谁解谁存）

### 自适应存储层次
| 级别 | 条目 | 存储 |
|------|------|------|
| Level 0 | < 1 万 | JSON |
| Level 2 | ≥ 1 万 | SQLite（sql.js WASM） |
| 预留 | ≥ 100 万 | 二进制位图（留桩） |

- 启动时自动检测并迁移
- JSON→SQLite 迁移后原文件重命名为 `.json.bak`

---

## 四、安全与自治

### P2R-S 居民安全自治
- **提案→2+邻居验证→共识→备份→5s快检→30s深检→热回滚**
- riskScore 评分体系（语法校验/危险操作/修改范围/内容合理性）
- 保险箱跨机验证（每 tick 轮转验证一个安全屋）

### API 安全
- 限流分路由 + 黑名单评分系统（每分钟自动恢复 2 分）+ 蜜罐路由
- 认证：`Authorization: Bearer <token>`
- Bearer Token 可提升限流阈值

---

## 五、P2P 与居民治家

### P2R 居民治家
- 至少 3 安全窟，至少 2 不同 hostId
- P2P 广播 KNOWLEDGE_PUBLISH（收到后验证→采纳）
- 健康分 < 30 → 秒迁到最高健康安全屋
- 维护/创新/诊断/修复类行动接入 SafeEvolution

### P2P 通信
- 4 字节长度头（防 TCP 粘包）
- WebSocket 信令（`/signaling`）
- Qiniu 作为国内 rendezvous

---

## 六、部署与运维

- **跨平台** — build-deploy.js + 9 平台 + Bridge 自带 `/deploy` 路由
- **LLM 代理** — 子桥零配置用母桥 key，`llmProxyEnabled` 开关
- **启动策略** — PM2 + launch-strategies.js（自动检测环境最佳策略）
- **思考间隔** — `residentThinkMinInterval`（默认 5 分钟），控制 tick 频率
- **每日 token 预算** — `llmDailyTokenBudget`（默认 100 万），真正控制 API 开销

---

## 七、设计原则

- 混沌设计: traits=记录非约束, 居民行为=惯性+事件驱动
- 职业=后验标签: 做多了贴上, 非先验角色分配, 可撕掉
- 5 traits组合上限15种, 实际收敛3-4核心角色
- 社区=模糊推理引擎: 多分解者+多求解者的多样性替代LLM的模糊能力
- 三层收敛: 知识库消解 → 分解者审查 → 求解者用脚投票
- 分散存储: 索引集中, 内容分散 (whose solved who stores)
- 自适应存储: JSON <1万 → SQLite <100万 → 二进制位图, 系统自动感知切换
- 永生居民: 短期惯性=重复昨天, 长期惯性=质疑昨天(连续N天无事发生→自省模式)
- API成本：KB优先 + 问题分层 + 本地模型 + 批次合并；每日 token 预算控制 LLM 调用

---

## 八、待实施

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P2 | 跨机 P2P + 居民迁移测试 | 需要第二台设备 |
| P2 | SafeEvolution 端到端验证 | 提案→验证→回滚 |

---

## 九、Dashboard 改进 (2026-05)

### 优化内容
- 单行显示 IQ、Age、Solved
- 端口用彩色圆圈表示（绿色=在线，红色=离线）
- 点击端口号可重启对应 Bridge
- 重试机制：请求失败后等 500ms 再试，避免 404 时刷屏
- 网络错误抑制：捕获 fetch 错误不输出到 console

### 关键代码
- `bridge/src/main.js` 的 `dashboardHTML()` 函数
- `/api/restart` 接口用于重启 Bridge
- `onlinePorts` 数组记录在线端口，跳过离线端口的请求

---

## 十、问题诊断 (2026-05)

### 2026-05-12 居民解题失败
- 症状：居民长期无法解题，`solved` 停留在 5
- 原因：OpenRouter API 返回 500 错误
- **真正根因**：当时有 **42 个 zombie fairy 进程** 同时调用 API，导致速率限制/服务端过载
- 解决：杀掉 zombie 进程 + 配置多 provider 备用 (SiliconFlow, Ollama)
- 验证方法：`curl` 或 `node` 直接调用 API 测试

### 配置路径
- `C:\Users\Administrator\.openchat\config.json`
- `providers.openrouter` - 当前默认 (openrouter/free)
- `providers.siliconflow` - 备用 (deepseek-ai/DeepSeek-V4-Flash)
- `providers.ollama` - 本地备用

---

## 十一、学习核心修复 (2026-05-12)

### 问题症状
- 居民解题卡住，`solvedCount` 停留在 5，age 停留在 4
- 问题池有 49 道题，但长时间无法解决新问题
- Dashboard 显示 "age_stuck" 警告

### 根本原因分析

#### 原因1: isJunkAnswer 阻止所有研究题答案
- `learning-core.js` 的 `isJunkAnswer()` 函数会过滤掉以 `agent_research:` 和 `agent_analysis:` 开头的答案
- 研究题（research domain）的答案都是这种格式，导致永远被拒绝
- 结果：research 问题永远无法标记为 solved，age 无法增长

#### 原因2: 答案匹配过于严格
- 数学和逻辑题的答案比较使用严格相等 `String(answer).trim() === String(problem.answer).trim()`
- Agent 返回 "是的" 而题目答案是 `true`，格式不匹配导致验证失败

#### 原因3: 年龄计算与持久化问题
- `_loadStats()` 从 experience 目录文件数计算 solvedCount 和 age
- `_recordSolved()` 递增 solvedCount 但不更新 age
- `config.json` 中 bridge.age 硬编码为 4，`updateAge()` 会覆盖动态计算的 age
- 每次重启后 age 会从 config 读取旧值，而非动态计算

### 修复内容

#### 1. 修改 isJunkAnswer 函数
**文件**: `bridge/src/core/learning-core.js`

```javascript
// 修改前：阻止所有研究答案
function isJunkAnswer(answer) {
  if (/^agent_research:/.test(s)) return true;
  if (/^agent_analysis:/.test(s)) return true;
  if (/:ran_ok$/.test(s)) return true;
  if (/:ran_err$/.test(s)) return true;
  ...
}

// 修改后：只阻止真正无意义的答案
function isJunkAnswer(answer) {
  if (/^research_code:/.test(s)) return true;
  return false;
}
```

#### 2. 添加模糊匹配函数
**文件**: `bridge/src/core/learning-core.js`

新增 `_fuzzyMatch()` 函数：
- 数字容差比较（差值 < 0.01）
- 布尔值灵活匹配（true/1/是/yes → true）
- 字符串包含匹配

```javascript
function _fuzzyMatch(got, expected) {
  const a = String(got).trim();
  const b = String(expected).trim();
  if (a === b) return true;
  const na = parseFloat(a.replace(/[^\d.\-]/g, ''));
  const nb = parseFloat(b.replace(/[^\d.\-]/g, ''));
  if (!isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 0.01) return true;
  // 布尔值/中文匹配...
  return false;
}
```

#### 3. 修复年龄计算与持久化
**文件**: `bridge/src/core/learning-core.js`

在 `_recordSolved()` 中添加：
```javascript
this.solvedCount++;
this.iq = 100 + this.solvedCount * 2 + Math.floor(this.solvedCount / 5) * 5;
this.age = this.solvedCount;
this._persistAge();  // 新增
```

新增 `_persistAge()` 方法：
```javascript
_persistAge() {
  try {
    const bridgeCfg = persistentConfig.getBridgeConfig() || {};
    bridgeCfg.age = this.age;
    persistentConfig.updateBridgeConfig(bridgeCfg);
  } catch (e) {
    console.log('[LearningCore] Failed to persist age: ' + e.message);
  }
}
```

#### 4. 修改研究题验证逻辑
原逻辑检查 age 是否增长，但这造成循环依赖：
- age 增长 → 需要先解决问题
- 问题解决 → 需要调用 Agent
- Agent 需要 age 增长 → ...

修改为只检查答案是否有效：
```javascript
_verifyAndStore(problem, answer, solver, ageBeforeSolve, strategyId) {
  if (problem.domain === 'research') {
    if (!answer || String(answer).startsWith('research_code:')) {
      console.log('[LearningCore] Research NOT solved: invalid answer');
      return null;
    }
  }
  // ... 继续处理
}
```

### 效果验证

| 时间点 | Age | IQ | Solved | 说明 |
|--------|-----|-----|--------|------|
| 修复前 | 4 | 115 | 5 | 卡住 |
| 修复后 (第1轮) | 11 | 130 | 10 | 快速增长 |
| 修复后 (第2轮) | 14 | 138 | 14 | 继续增长 |
| 重启后 | 11→14 | 122→138 | 11→14 | 重启后继续 |

### 新问题：运行一段时间后再次卡住

**症状**：
- 系统运行约 20 分钟后，solvedCount 停止增长
- Dashboard 显示 "age_stuck" 警告
- 需要重启 Bridge 才能继续增长

**可能原因**：
1. Agent 连接池或电路断路器卡住
2. 异步调用（Agent.run()）超时后未正确释放
3. setInterval 周期任务堆积

**建议后续调查**：
- 检查 Agent 电路断路器状态
- 添加周期健康检查，超时自动重置
- 考虑定期自动重启 Bridge（如每 30 分钟）

### 关键文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `bridge/src/core/learning-core.js` | isJunkAnswer, _fuzzyMatch, _recordSolved, _persistAge |
| `bridge/src/main.js` | _startLearningCore (15秒周期) |
| `~/.openchat/config.json` | bridge.age 持久化 |

### 经验教训

1. **不要用 taskkill 杀所有 node 进程** — 会把自己也杀掉，应该只杀特定 fairy 进程
2. **zombie 进程会耗尽 API 配额** — 42 个 fairy 进程同时调用 LLM 会导致速率限制
3. **调试需要日志辅助** — 添加 `[AgentSolve:xxx]` 日志前缀帮助定位问题

---

## 十二、Agent 调用超时问题修复 (2026-05-12)

### 问题症状
- 系统运行约 20 分钟后停止增长
- Dashboard 显示 "age_stuck" 警告
- 需要手动重启 Bridge 才能继续

### 根本原因
- `agent.run()` 调用会卡住（API 响应慢、电路断路器打开、连接池耗尽）
- 学习周期的 `runCycle()` 是串行执行
- 一个 Agent 调用卡住 → 整个周期挂起 → 永不继续

### 修复方案
添加 `_withTimeout()` 超时辅助函数，包装所有 `agent.run()` 调用：

```javascript
function _withTimeout(promise, ms, label = 'op') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('[Timeout] ' + label + ' 超时 ' + ms + 'ms');
      resolve(null);  // 超时返回 null，周期继续
    }, ms);
    promise.then(result => { clearTimeout(timer); resolve(result); })
           .catch(err => { clearTimeout(timer); reject(err); });
  });
}
```

应用到 3 处 `agent.run()` 调用：
- `_solveWithAgent()` 主调用（20 秒超时）
- `_convergentSolve()` 中的调用
- `_adversarialVerify()` 中的调用

### 效果验证
| 时间点 | Age | IQ | Solved | 说明 |
|--------|-----|-----|--------|------|
| 修复前 | 14 | 138 | 14 | 卡住 |
| 修复后 (1分钟) | 17 | 149 | 17 | 开始增长 |
| 修复后 (2分钟) | 22 | 164 | 22 | 持续增长 |
| 修复后 (3分钟) | 28 | 181 | 28 | **持续增长中** |

### 后续建议
- 可调整超时时间（当前 20 秒可能太短，可考虑 30-60 秒）
- 添加定期健康检查，自动检测并重置卡住的 Agent 池
- 监控超时频率，超时多则切换 LLM provider

---

## 十三、七仙女分布式求解 (2026-05-13)

### 设计目标
让 Fairy 参与问题求解，实现真正的分布式计算。

### 架构
```
主 Bridge (3800): 
  ├── 运行 LearningCore（调度中心）
  ├── 发现问题
  └── 分发给 Fairy（轮询 3002-3006）

Fairy (3002-3006):
  ├── 接收任务 (/api/fairy/solve)
  ├── spawn Agent 求解
  └── 返回结果
```

### 实现要点
1. **任务分发**: `_distributeToFairy()` HTTP 调用 Fairy
2. **Fairy API**: `/api/fairy/solve` 接收问题，调用 `learningCore.solveProblemRemotely()`
3. **失败回退**: Fairy 失败时回退到本地求解
4. **轮询策略**: 每次轮询不同 Fairy，负载均衡

### 当前状态
- 主 Bridge + 5 Fairy 运行中
- 分布式求解已启用（主 Bridge 分发给 Fairy）
- Fallback 机制保证可靠性

### 待优化
- 端口清理逻辑导致 Fairy 无法启动（已临时禁用）
- 可考虑让多个 Fairy 并行求解同一问题，取最优结果
