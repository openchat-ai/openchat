# OpenChat Multi-Agent 架构评估与实施方案

> 评估日期: 2026-04-13
> 参照项目: Hermes Agent (NousResearch), Claude Managed Agents

---

## 一、现状评估

### 1.1 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Router                               │
│  (消息路由: Gateway -> Handler -> Provider/Tool)             │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │ Gateway  │        │ Session  │        │  Plugin  │
    │  (WS/CLI)│        │ Manager  │        │ Manager  │
    └──────────┘        └──────────┘        └──────────┘
                              │                   │
                              ▼                   ▼
                      ┌────────────┐       ┌────────────┐
                      │ AiProvider │       │   Tools    │
                      │ (单实例)   │       │ (顺序执行) │
                      └────────────┘       └────────────┘
```

### 1.2 差距分析

| 需求 | 当前状态 | Hermes Agent | Claude Managed | 差距 |
|------|---------|-------------|----------------|------|
| 多 Agent 并行 | ❌ 无 | ✅ 子进程隔离 | ✅ 原生协调 | **重大** |
| Agent 通讯 | ❌ 无 | ✅ RPC | ✅ 内部消息 | **重大** |
| 持久记忆 | ✅ MEMORY.md | ✅ Skills + Honcho | ✅ 托管 | 中等 |
| 指令简化 | ❌ CLI 命令 | ✅ 自然语言 | ✅ 自然语言 | **重大** |
| API Key 安全 | ❌ 明文内存 | ✅ 环境变量 | ✅ 托管 | **重大** |

---

## 二、目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Master Agent                              │
│  (自然语言理解 -> 任务分解 -> 子Agent调度)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Agent-A     │ ══▶  │  Agent-B     │ ══▶  │  Agent-C     │
│ (独立Session)│ 通讯 │ (独立Session)│ 通讯 │ (独立Session)│
└──────────────┘      └──────────────┘      └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Message Bus    │
                    │  (Agent 通讯中枢) │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Memory Store   │
                    │  (~/.openchat/) │
                    └─────────────────┘
```

---

## 三、实施方案

### 3.1 用户指令简化

**目标**: 从 `provider add openai KEY` → `我使用 OpenAI`

**实现方式**:

```javascript
// src/core/natural-language-parser.js

const COMMAND_ALIASES = {
  // 简单指令映射
  '我用 openai': { action: 'provider_add', provider: 'openai' },
  '我用 claude': { action: 'provider_add', provider: 'claude' },
  '切换模型': { action: 'model_switch', prompt: '请选择模型' },
  '新建会话': { action: 'session_create' },
  '并行处理': { action: 'parallel_mode' },
  
  // 复杂任务自动分解
  '帮我分析代码': { action: 'decompose', steps: ['read', 'analyze', 'report'] },
  '帮我写测试': { action: 'decompose', steps: ['read_code', 'write_tests', 'run_tests'] },
};
```

### 3.2 持久记忆改进

**当前问题**:
- MEMORY.md 在项目目录，每次新建项目需重新配置
- API Key 仍在代码/环境变量中

**改进方案**:

```javascript
// src/memory/persistent-config.js

const CONFIG_PATH = path.join(os.homedir(), '.openchat', 'config.json');

class PersistentConfig {
  constructor() {
    this.config = this.load();
  }

  getApiKey(provider) {
    // 优先使用 ~/.openchat/config.json
    // 其次使用环境变量
    // 最后才要求用户输入
    return this.config.apiKeys?.[provider] 
        || process.env[`${provider.toUpperCase()}_API_KEY`]
        || null;
  }

  setApiKey(provider, key) {
    // 加密存储到 ~/.openchat/config.json
    this.config.apiKeys[provider] = this.encrypt(key);
    this.save();
  }
}
```

**配置目录结构**:
```
~/.openchat/
├── config.json      # API Keys (加密)
├── memory/          # 记忆文件
│   ├── core-logic.md
│   ├── debugging.md
│   └── user-preferences.md
├── skills/          # 自定义技能
└── sessions/       # 会话历史
```

### 3.3 多 Agent 并行

**实现方案**:

```javascript
// src/core/multi-agent-coordinator.js

class MultiAgentCoordinator {
  constructor() {
    this.agents = new Map();  // agentId -> AgentSession
    this.messageBus = new EventEmitter();
  }

  async spawnAgent(agentId, config) {
    const agent = new AgentSession(agentId, config);
    this.agents.set(agentId, agent);
    
    // 订阅消息总线
    this.messageBus.on(`agent:${agentId}`, (msg) => agent.receive(msg));
    
    return agent;
  }

  async parallelExecute(task) {
    // 1. 分解任务
    const subtasks = this.decompose(task);
    
    // 2. 并行生成 Agent
    const agents = await Promise.all(
      subtasks.map((st, i) => this.spawnAgent(`subagent-${Date.now()}-${i}`, st))
    );
    
    // 3. 并行执行
    const results = await Promise.all(
      agents.map(agent => agent.run())
    );
    
    // 4. 聚合结果
    return this.aggregateResults(results);
  }

  // Agent 间通讯
  sendTo(fromAgentId, toAgentId, message) {
    this.messageBus.emit(`agent:${toAgentId}`, {
      from: fromAgentId,
      content: message,
      timestamp: Date.now()
    });
  }
}
```

### 3.4 Agent 间消息协议

```javascript
// src/protocol/agent-message.js

const MESSAGE_TYPES = {
  REQUEST: 'agent:request',      // A -> B 请求协助
  RESPONSE: 'agent:response',    // B -> A 响应结果
  BROADCAST: 'agent:broadcast',  // A -> All 广播
  DELegate: 'agent:delegate',    // A -> B 委托任务
  RESULT: 'agent:result',        // B -> A 任务结果
};

const messageSchema = {
  id: 'uuid',
  type: 'REQUEST|RESPONSE|BROADCAST|DELEGATE|RESULT',
  from: 'agentId',
  to: 'agentId | *',
  content: {
    action: 'string',
    payload: 'any',
    replyTo: 'messageId'  // 用于关联请求响应
  },
  timestamp: 'number'
};
```

---

## 四、实施步骤

### Phase 1: 指令简化 (1天)

- [ ] 实现 `NaturalLanguageParser`
- [ ] 添加常用指令别名
- [ ] 实现 `PersistentConfig` 统一配置存储

### Phase 2: 持久记忆 (1天)

- [ ] 重构配置存储到 `~/.openchat/`
- [ ] API Key 加密存储
- [ ] 用户偏好持久化

### Phase 3: 多 Agent 基础 (2天)

- [ ] 实现 `MultiAgentCoordinator`
- [ ] 实现 `MessageBus`
- [ ] 实现 `AgentSession`

### Phase 4: Agent 通讯 (1天)

- [ ] 实现消息协议
- [ ] 实现 `sendTo()` / `broadcast()`
- [ ] 实现委托机制

### Phase 5: 并行执行 (1天)

- [ ] 实现任务分解
- [ ] 实现 `Promise.all` 并行调度
- [ ] 实现结果聚合

---

## 五、API Key 安全管理改进

### 5.1 改进前

```javascript
// ai-provider.js - 直接接收明文 API Key
async connect(apiKey, endpoint) {
  this.apiKey = apiKey;  // ❌ 风险
}
```

### 5.2 改进后

```javascript
// providers/secure-provider.js

class SecureProvider extends AiProvider {
  async connect(config) {
    // 1. 优先从持久化配置读取
    this.apiKey = await persistentConfig.getApiKey(this.id);
    
    // 2. 如果没有，检查是否提供临时 key
    if (!this.apiKey && config.tempKey) {
      this.apiKey = config.tempKey;
      this.isTemporary = true;  // 标记为临时，不持久化
    }
    
    // 3. 如果都没有，抛出明确错误
    if (!this.apiKey) {
      throw new Error(`请先配置 ${this.id} 的 API Key:\n  openchat config set ${this.id}`);
    }
  }
}
```

### 5.3 加密存储

```javascript
// 使用 Node.js crypto 进行简单加密
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class SecureStorage {
  encrypt(text, password = process.env.OPENCHAT_MASTER_KEY) {
    const iv = randomBytes(16);
    const key = crypto.scryptSync(password, 'salt', 32);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return iv.toString('hex') + ':' + cipher.update(text, 'utf8', 'hex') + ':' + cipher.final('hex');
  }

  decrypt(encrypted, password = process.env.OPENCHAT_MASTER_KEY) {
    const [ivHex, ...rest] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(password, 'salt', 32);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(rest.join(':'), 'hex', 'utf8') + decipher.final('utf8');
  }
}
```

---

## 六、使用示例

### 6.1 首次设置 (一次配置，永久生效)

```bash
$ openchat
> 我使用 openai sk-xxxxx
✓ OpenAI API Key 已加密保存到 ~/.openchat/config.json

> 我用 deepseek sk-xxxxx  
✓ DeepSeek API Key 已加密保存

> 记住我喜欢用 qwen 模型
✓ 已记住您的偏好
```

### 6.2 多 Agent 并行

```bash
> 帮我分析这个文件夹里所有文件的代码质量
✓ 正在启动 3 个并行 Agent...

  [Agent-1] 分析中: src/utils/*.js
  [Agent-2] 分析中: src/components/*.js  
  [Agent-3] 分析中: src/services/*.js

✓ 汇总完成，发现 12 个问题，建议优先修复...
```

### 6.3 Agent 间协作

```bash
> 帮我写一个用户注册功能并测试它
✓ 任务分解:
  [Agent-写代码] 正在编写用户注册逻辑...
  [Agent-写测试] 正在编写测试用例...
  [Agent-审核] 等待代码完成进行审核...

  [Agent-写代码] → [Agent-审核]: 代码已就绪
  [Agent-审核] → [Agent-写代码]: 建议改进: 添加邮箱验证
  
✓ 最终交付: 注册功能 + 测试覆盖率 92%
```

---

## 七、验收标准

| 功能 | 验收条件 |
|------|---------|
| 指令简化 | 用户说"我用 openai"即可配置，无需记忆命令 |
| 持久记忆 | 重启后 API Key 和偏好仍然有效 |
| 多 Agent | 同一任务可并行执行，100% 利用多核 |
| Agent 通讯 | Agent 间可相互发送消息并接收响应 |
| API Key 安全 | Key 以加密形式存储，有审计日志 |
