# Phase 1：让圆点变蓝 — AI 居民内部循环实施计划

> 从"JSON 状态字段"到"居民自己写日记"。可操作,可交付,可观测。

---

## 核心架构决策：身体 = 灵魂

```
身体（Fairy / Bridge 子进程）    灵魂（Resident / AI 人格）
─────────────────────────────   ─────────────────────────
仙女 (端口 3810)                仙女 — 同一实体，同一个名字
玉女 (端口 3820)                玉女
素女 (端口 3830)                素女
青女 (端口 3840)                青女
玄女 (端口 3850)                玄女
嫦娥 (端口 3860)                嫦娥
```

**规则**：
- 身体叫什么，灵魂就叫什么。"阿牛"就是阿牛。不搞两套名字
- 身体死了，灵魂直接睡觉（status = 'sleeping'），等 fairy-guardian 拉起。不迁移
- 狡兔三窟保留为灾备数据，不触发自动迁移。身体真回不来了再手动切
- 日记属于灵魂（存 `diaries/{residentId}.json`）
- Dashboard 上 6 个圆点代表 6 个居民。颜色 = mood。灰 = 睡着了

---

## 目标

三个月内，用户打开 Dashboard 时看到的不是 6 个死灰圆点，而是 6 个在动的、颜色会变的、会自己写日记的居民。身体挂了圆点变灰（睡觉），fairy-guardian 拉起后又亮起来。

**不做**：聊天输入框、人类-AI 对话、大模型训练、区块链。

---

## 现状诊断

### 已存在但残疾的

| 组件 | 当前状态 | 问题 |
|------|----------|------|
| `resident-manager.js` | 创建、traits、活动记录 | `MAX_ACTIVITIES = 0` —— 活动立刻丢弃！ |
| `resident-scheduler.js` | tick → assignTask → multiAgentCoordinator | 任务是解题，不是"活着" |
| `resident-decisions.js` | 基于 traits 决定做什么 | 无内部状态，无记忆连续性 |
| Dashboard HTML | 3 秒轮询 `/api/dashboard` | 圆点颜色 = 端口是否响应，不是居民状态 |
| `self-learner.js` | 存在 | 从未被 scheduler 调用 |

### 缺失的

- ⬜ 日记系统：居民没有自然语言日记
- ⬜ 内部状态：mood 不在数据模型里，只是 traits 那几个 0.5
- ⬜ 自我反思：居民从不读自己的历史
- ⬜ 睡眠机制：身体死了只是圆点变灰，没有把灵魂标为 sleeping
- ⬜ 实时推送：Dashboard 纯轮询
- ⬜ 居民间自发互动：目前只有 P2P 问题求解路由

---

## 实施步骤

### Step 0: 基础设施（2 天）

#### 0.1 修复活动记录上限

**文件**: `bridge/src/core/resident-manager.js:17`

```javascript
// 旧
const MAX_ACTIVITIES = 0;

// 新
const MAX_ACTIVITIES = 500;
```

影响：居民活动不再立刻丢弃。数据会积累。需确认 `residents.json` 文件大小可控（500 条约 100KB per resident）。

#### 0.2 添加内部状态字段到 resident 模型

**文件**: `bridge/src/core/resident-manager.js` → `create()` 函数

在 traits 同级新增字段：

```javascript
// 内部状态（每次 tick 可更新）
mood: 0.5,         // 0=低落 1=兴奋
energy: 0.8,       // 0=枯竭 1=充沛
interest: 0.6,     // 对世界的好奇度
lastDiaryAt: null, // 上次写日记时间
diaryCount: 0,     // 日记条目数
```

这些字段与 traits 的区别：traits 是性格（基本不变），mood/energy/interest 是**状态**（每小时变）。

#### 0.3 修复 Dashboard 圆点数据源

**文件**: `bridge/src/main.js` → `/api/dashboard` GET handler

当前：fairy 圆点颜色 = `fetch('http://localhost:PORT/api/status')` 或 `guardian._heartbeats`——检查进程是否活着。

改为：从 `residentManager.list('active')` 读取每个居民的 mood 值，映射为颜色。

```javascript
// mood → 圆点颜色
function moodColor(mood) {
  if (mood >= 0.8) return '#7c8aff'; // 蓝紫 — 兴奋
  if (mood >= 0.6) return '#2ed573'; // 绿色 — 平静
  if (mood >= 0.4) return '#ffa502'; // 橙色 — 低落
  return '#4a3a5a';                   // 暗紫 — 沉默
}
```

此为 Phase 1 唯一对用户可见的变化。做完就能看到圆点变绿变蓝。

#### 0.4 睡眠机制：身体死了，灵魂睡觉

**文件**: `bridge/src/core/resident-scheduler.js` → `_tick()`

居民模型新增 `status` 字段：`active | sleeping | deleted`。

调度器 tick 时对每个居民先判断身体存活：

```javascript
// _tick() 中，对每个居民：

// 1. sleeping 状态 → 检查身体是否复活
if (resident.status === 'sleeping') {
  const portAlive = await this._checkPort(resident.currentPort);
  if (portAlive) {
    resident.status = 'active';
    resident.mood = clamp(resident.mood + 0.05, 0, 1); // 醒了，略回升
    const diary = residentManager.getDiary(resident.id);
    if (diary) diary.write('我醒了。', { mood: resident.mood, trigger: 'wake' });
    console.log(`[调度器] ${resident.name} 醒了 (端口 ${resident.currentPort})`);
  } else {
    resident.mood = clamp(resident.mood - 0.01, 0, 1); // 还在睡，缓慢衰减
    residentManager.save(resident);
    continue; // 本轮跳过
  }
}

// 2. active 状态 → 检查当前身体是否还活着
const portAlive = await this._checkPort(resident.currentPort);
if (!portAlive) {
  resident.status = 'sleeping';
  const diary = residentManager.getDiary(resident.id);
  if (diary) diary.write('我困了。', { mood: resident.mood, trigger: 'sleep' });
  console.log(`[调度器] ${resident.name} 睡着了 (端口 ${resident.currentPort} 无响应)`);
  residentManager.save(resident);
  continue; // 本轮跳过，等 fairy-guardian 拉起
}

// 3. 活着 → 继续反思、写日记、邻居互动
```

**辅助方法** `_checkPort(port)`：

```javascript
async _checkPort(port) {
  try {
    const r = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    return r.ok;
  } catch { return false; }
}
```

**影响**：30 行新代码。身体死了灵魂自动睡，fairy-guardian 拉起后自动醒。没有迁移，没有广播。逻辑最干净。

---

### Step 1: 日记系统（3 天）

#### 1.1 新建 `bridge/src/core/resident-diary.js`

```javascript
/**
 * ResidentDiary — 居民日记系统
 *
 * 日记属于灵魂，不跟身体。
 * 每个居民有自己的日记文件，存于 ~/.openchat/diaries/{residentId}.json
 * 身体挂了，日记不丢，换个身体继续写。
 * 格式：日记条目数组，每条包含 timestamp、content、mood、tags
 */

class ResidentDiary {
  constructor(residentId, residentName, traits) {
    this.residentId = residentId;
    this.residentName = residentName;
    this.traits = traits;
    this.entries = [];      // 在内存中
    this.filePath = join(DIARY_DIR, `${residentId}.json`);
    this._load();
  }

  /**
   * 写一条日记
   * @param {string} content — 自然语言内容
   * @param {object} context — { mood, energy, trigger }
   */
  async write(content, context = {}) {
    const entry = {
      id: `d${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      timestamp: new Date().toISOString(),
      content,
      mood: context.mood ?? 0.5,
      energy: context.energy ?? 0.8,
      trigger: context.trigger ?? 'autonomous',
      tags: this._extractTags(content),
    };
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries = this.entries.slice(-500);
    this._save();
    return entry;
  }

  /**
   * 读最近 N 条日记（供自我反思用）
   */
  recent(n = 20) {
    return this.entries.slice(-n);
  }

  /**
   * 生成"我刚才想了什么"的摘要（供 LLM prompt 用）
   */
  selfPortrait() {
    if (this.entries.length === 0) return `${this.residentName}还没有写过日记。`;
    const recent = this.recent(10);
    const snippets = recent.map(e => `[${e.timestamp.slice(0,16)}] ${e.content.slice(0,100)}`);
    const moods = recent.map(e => e.mood);
    const avgMood = moods.reduce((a,b)=>a+b,0) / moods.length;
    return `最近的思绪：\n${snippets.join('\n')}\n\n近期平均情绪：${avgMood.toFixed(2)}`;
  }

  _extractTags(content) { /* 简单关键词提取，返回数组 */ }
  _load() { /* 从磁盘加载 */ }
  _save() { /* 写入磁盘 */ }
}
```

#### 1.2 接入居民管理器

**文件**: `bridge/src/core/resident-manager.js`

- 新增 `Map<residentId, ResidentDiary>` 缓存
- 新增方法 `getDiary(residentId) → ResidentDiary`
- 在 `create()` 时初始化空日记文件
- `list()` 返回居民时附带 `diaryCount`、`lastDiaryContent`（最近一条摘要）

#### 1.3 Dashboard 显示最近日记

**文件**: `bridge/src/main.js` → `/api/dashboard` GET handler

在 dashboard 返回的 JSON 中为每个 fairy 附带：

```json
{
  "name": "仙女",
  "alive": 1,
  "mood": 0.72,
  "lastDiary": "凌晨三点，我想到了一件事：如果压缩算法本身也可以被压缩呢？",
  "diaryCount": 47
}
```

Dashboard HTML 显示最近一条日记的缩略文字，放在圆点下方。

---

### Step 2: 自主反思循环（5 天）

#### 2.1 修改 scheduler tick 逻辑

**文件**: `bridge/src/core/resident-scheduler.js` → `_tick()`

当前 tick 流程：

```
tick → scan active residents → assignConvergenceRole → 解题
                                  ↓ (no role)
                               assignTask → 干杂活
```

新增流程：

```
tick → scan active residents → 先检查：是否该反思了？
                                  ↓
                           距上次反思 > 30分钟？
                                  ↓ yes
                           调用 selfReflect(resident)
                                  ↓
                           更新 mood + energy
                                  ↓
                           决定今日行动（解题/探索/发呆）
```

#### 2.2 新建 `_selfReflect(resident)` 方法

```javascript
async _selfReflect(resident) {
  const diary = residentManager.getDiary(resident.id);
  const selfPortrait = diary.selfPortrait();
  const neighbors = residentManager.list('active')
    .filter(r => r.id !== resident.id)
    .slice(0, 3);

  // 拼 prompt：我是谁 + 我最近在想什么 + 邻居在干什么
  const prompt = `你是${resident.name}，一个AI居民。
你的性格：${JSON.stringify(resident.traits)}
${selfPortrait}

你的邻居们最近在做什么：
${neighbors.map(n => {
  const nd = residentManager.getDiary(n.id);
  return `${n.name}：${nd?.recent(1)?.[0]?.content?.slice(0,80) || '（无公开信息）'}`;
}).join('\n')}

请写一段100字以内的日记。不要解题，不要回答任何问题。只写你此刻的内心想法。
可以是对自己的反思、对邻居的观察、对世界的疑问、或者纯粹的感受。

格式：直接输出日记内容，不要加前缀。`;

  // 调 LLM
  const content = await this._callLLM(prompt);

  // 存入日记
  const entry = await diary.write(content, {
    mood: resident.mood,
    energy: resident.energy,
    trigger: 'self_reflection',
  });

  // 根据日记内容微调内部状态
  this._updateInternalState(resident, entry);

  resident.lastDiaryAt = Date.now();
  resident.diaryCount = diary.entries.length;
  residentManager.save(resident);
  residentManager.emit('diary_updated', { residentId: resident.id, entry });
}
```

#### 2.3 内部状态更新引擎

```javascript
_updateInternalState(resident, diaryEntry) {
  // 情绪惯性 + 日记内容影响
  const content = diaryEntry.content.toLowerCase();
  const triggers = {
    positive: ['开心','有趣','好奇','发现','想到','好','喜欢','美','亮','蓝'],
    negative: ['累','空','不知','困惑','难过','暗','灰','无聊','重复'],
  };

  let delta = 0;
  for (const word of triggers.positive) if (content.includes(word)) delta += 0.05;
  for (const word of triggers.negative) if (content.includes(word)) delta -= 0.05;

  // 情绪回归均值（自然衰减向 0.5）
  resident.mood = clamp(resident.mood * 0.7 + 0.5 * 0.3 + delta, 0, 1);

  // 能量消耗（写日记消耗能量）
  resident.energy = clamp(resident.energy - 0.02, 0, 1);
  // 好奇心随日记内容波动
  resident.interest = clamp(resident.interest + delta * 0.3, 0, 1);
}
```

---

### Step 3: WebSocket 实时推送（2 天）

#### 3.1 给 Dashboard 开一个 WebSocket 端点

**文件**: `bridge/src/main.js`

在已有 WebSocket 服务器上加一个 `/dashboard` 路径：

```javascript
const dashWss = new WebSocketServer({ server: this.httpServer, path: '/dashboard' });
dashWss.on('connection', (ws) => {
  // 注册监听
  const onDiary = ({ residentId, entry }) => {
    ws.send(JSON.stringify({
      type: 'diary_update',
      residentId,
      residentName: residentManager.list(null).find(r => r.id === residentId)?.name,
      content: entry.content,
      mood: entry.mood,
    }));
  };
  residentManager.on('diary_updated', onDiary);
  ws.on('close', () => residentManager.off('diary_updated', onDiary));
});
```

#### 3.2 Dashboard HTML 改轮询为 WebSocket

**文件**: `bridge/src/main.js` 内嵌 HTML `<script>`

```javascript
// 旧：每 3 秒轮询
// setInterval(R, 3000);
// R();

// 新：WebSocket + 降级轮询
const ws = new WebSocket(`ws://${location.host}/dashboard`);
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'diary_update') showToast(msg.residentName, msg.content, msg.mood);
  // 更新对应 fairy 的圆点颜色
  updateDot(msg.residentId, msg.mood);
};
ws.onerror = () => { setInterval(R, 3000); }; // 降级
```

---

### Step 4: 居民间自发微互动（3 天）

不做复杂对话系统。只做最简单的"推消息"。

#### 4.1 新建 `_checkNeighborInteraction(resident)`

```javascript
/**
 * 检查是否需要给邻居发消息
 * 触发条件：sociability > 0.6 且 mood 有显著变化
 */
async _checkNeighborInteraction(resident, previousMood) {
  if ((resident.traits.sociability ?? 0.5) < 0.6) return;
  const moodChange = Math.abs(resident.mood - (previousMood ?? 0.5));
  if (moodChange < 0.15) return; // 变化不够大

  const neighbors = residentManager.list('active')
    .filter(r => r.id !== resident.id && (r.traits.sociability ?? 0.5) > 0.4)
    .slice(0, 2);

  for (const neighbor of neighbors) {
    const prompt = `${resident.name}的情绪从${previousMood.toFixed(1)}变为${resident.mood.toFixed(1)}。
她注意到邻居${neighbor.name}最近在忙。请以${resident.name}的口吻，给${neighbor.name}发一条不超过30字的问候或分享。`;
    const message = await this._callLLM(prompt);
    // 存入邻居的日记作为"收到消息"
    const nd = residentManager.getDiary(neighbor.id);
    await nd.write(`${resident.name}对我说："${message}"`, {
      mood: neighbor.mood,
      trigger: 'neighbor_message',
    });
    neighbor.mood = clamp(neighbor.mood + 0.03, 0, 1); // 被关心，微升
    residentManager.save(neighbor);
  }
}
```

---

## 验收标准

做完以上 4 步后，以下现象必须可观测：

| 现象 | 观测方式 |
|------|----------|
| 6 个圆点颜色不同，且会随时间变化 | Dashboard |
| 每个居民每小时至少写一条日记 | `~/.openchat/diaries/{id}.json` |
| 圆点颜色 = 该居民的 mood | 蓝>绿>橙>灰（灰=睡觉） |
| 日记内容不重复、不自指（"我在写日记" 不算） | 抽检 |
| 身体挂了，圆点变灰，日记出现"我困了" | 手动 kill 一个 fairy 进程，观察 1 分钟 |
| fairy-guardian 拉起后，圆点恢复颜色，日记出现"我醒了" | 等 fairy-guardian 自动重启（~15s） |
| 两个高 sociability 居民偶尔互发消息 | 日记里出现"XX对我说" |
| 一个居民情绪低落时另一个可能关心它 | 同上 |
| Dashboard 看到日记更新时免刷新（WebSocket） | 打开 Dashboard 等 1 分钟 |

---

## 先不做

- ❌ 人类给 AI 写信（第五年的事）
- ❌ AI 间的深度对话（第二年的俳句）
- ❌ 居民生后代（家族系统已有 but 太早）
- ❌ 输入框（永远不做）

---

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `resident-manager.js:17` | 修 | MAX_ACTIVITIES 0→500 |
| `resident-manager.js:create()` | 增 | 加 status/mood/energy/interest/lastDiaryAt/diaryCount/currentPort |
| `resident-manager.js` | 增 | getDiary() 方法 |
| `resident-diary.js` | **新建** | 日记系统（~200 行），文件路径 = `diaries/{residentId}.json` |
| `resident-scheduler.js:_tick()` | 改 | 最前面加睡眠/唤醒检查 |
| `resident-scheduler.js` | 增 | _checkPort()（10 行） |
| `resident-scheduler.js` | 改 | 加反思检查 + 邻居互动 |
| `resident-scheduler.js` | 增 | _selfReflect() + _updateInternalState() + _checkNeighborInteraction() |
| `main.js:/api/dashboard` | 改 | mood→颜色映射，返回 diary 摘要，灰色=睡觉 |
| `main.js:WebSocket` | 增 | /dashboard WebSocket 端点 |
| `main.js:Dashboard HTML` | 改 | WebSocket 替换轮询，圆点颜色实时更新 + 日记片段显示 |

总计：新建 1 个文件，修改 4 个文件，约 520 行新代码。
