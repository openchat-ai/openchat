# 🚀 OpenChat 开发者快速参考

> 快速了解 2026-04-24 实施的新功能

---

## 📦 新增模块

### 1. REST API (31 端点)
```
位置: bridge/src/api/
启动: const api = new APIServer({port: 3001})

端点:
- /api/v1/agents        (8 个)
- /api/v1/feedback      (聚合)
- /api/v1/decisions     (决策)
- /api/v1/p2p           (8 个)
- /api/v1/updates       (5 个)
- /api/v1/skills        (7 个)
- /api/v1/versions      (4 个)
- /api/v1/resources     (3 个)
- /api/v1/metrics       (指标)
```

### 2. P2P 通信
```
位置: bridge/src/p2p/

核心文件:
- swarm.js          P2P 网络管理
- discovery.js      节点发现
- priority-queue.js 优先级队列
- offline-queue.js  离线消息
- messages.js       6 种消息类型
```

### 3. Agent 角色
```
位置: bridge/src/agents/roles/

角色:
- security-auditor       安全审计
- code-quality-analyzer  代码质量
- performance-analyzer   性能分析
- test-engineer          测试工程
- custom                自定义
```

使用:
```javascript
const agent = AgentRoleFactory.create('security_auditor', {
  name: 'My Security Agent',
  task: 'Analyze code for vulnerabilities'
});
await agent.execute(task);
```

### 4. 热更新
```
位置: bridge/src/updates/

功能:
- 动态代码加载（无需重启）
- 2 层 Watchdog (5s + 30s)
- 自动回滚
- 版本快照管理

使用:
```javascript
const hotUpdate = new HotUpdateManager();
await hotUpdate.applyUpdate('2.1.0');
```

### 5. 资源优化
```
位置: bridge/src/optimization/

模块:
- compression.js   gzip/brotli 压缩
- cache.js         单层缓存
- cleanup.js       智能清理
- network-detector.js WiFi/Mobile 检测
```

---

## 🔧 快速开始

### 启动 API 服务器
```javascript
import APIServer from './src/api/server.js';

const server = new APIServer({port: 3001});
await server.start();
```

### 创建 Agent
```javascript
import AgentRoleFactory from './src/agents/agent-role-factory.js';

const agent = AgentRoleFactory.create('code_quality_analyzer');
const result = await agent.execute({
  code: 'function test() { ... }',
  language: 'javascript'
});
```

### 聚合反馈
```javascript
import FeedbackAggregator from './src/agents/feedback-aggregator.js';

const aggregator = new FeedbackAggregator();
const result = aggregator.aggregate(feedbackList, {
  normalize: true,
  deduplicate: true,
  prioritize: true
});
```

### P2P 通信
```javascript
import P2PSwarm from './src/p2p/swarm.js';

const swarm = new P2PSwarm();
await swarm.start();
swarm.broadcast({ type: 'message', content: 'hello' });
```

---

## 📊 API 端点速查

### Agents
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /api/v1/agents | 创建 Agent |
| GET | /api/v1/agents | 列表 |
| GET | /api/v1/agents/:id | 详情 |
| GET | /api/v1/agents/:id/feedback | 反馈 |
| DELETE | /api/v1/agents/:id | 终止 |

### P2P
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /api/v1/p2p/messages | 发送消息 |
| GET | /api/v1/p2p/inbox | 收件箱 |
| GET | /api/v1/p2p/peers | 节点列表 |
| POST | /api/v1/p2p/peers/:id/connect | 连接 |
| DELETE | /api/v1/p2p/peers/:id | 断开 |
| GET | /api/v1/p2p/stats | 统计 |

### Updates
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/v1/updates/available | 可用更新 |
| POST | /api/v1/updates/:version/apply | 执行更新 |
| POST | /api/v1/updates/:version/rollback | 回滚 |
| GET | /api/v1/updates/history | 历史 |

### Skills
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /api/v1/skills | 创建 |
| GET | /api/v1/skills | 列表 |
| GET | /api/v1/skills/search | 搜索 |
| POST | /api/v1/skills/:id/validate | 验证 |
| POST | /api/v1/skills/:id/publish | 发布 |
| POST | /api/v1/skills/:id/rate | 评分 |

### Resources
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | /api/v1/resources/status | 状态 |
| PUT | /api/v1/resources/policy | 策略 |
| POST | /api/v1/resources/cleanup | 清理 |

---

## ⚙️ 配置

### 环境变量
```bash
PORT=3000           # 主程序端口
API_PORT=3001       # API 服务器端口
P2P_ENABLED=true    # 启用 P2P
ENABLE_METRICS=true # 启用指标
```

---

## 🧪 测试

```bash
# 测试 API 服务器
cd bridge
npm install
node -e "const s=require('./src/api/server.js');new s().start()"

# 测试 Agent 创建
node -e "
const f=require('./src/agents/agent-role-factory.js');
const a=f.create('security_auditor');
a.initialize().then(()=>console.log('OK'));
"
```

---

## 🛡️ 安全配置

### 认证方式
- 使用 Bearer Token: `Authorization: Bearer <token>`
- 环境变量: `API_KEYS=key1,key2`

### 限流策略（分路由）
| 用户类型 | 端点 | 限制/分钟 |
|----------|------|-----------|
| 未认证 | 全部 | 50 |
| 已认证 | `/p2p` | 200 |
| 已认证 | `/agents/feedback/decisions` | 300 |
| 已认证 | `/skills/versions` | 100 |
| 已认证 | `/updates` | 50 |
| 已认证 | `/resources/metrics` | 200 |
| 已认证 | 其他 | 500 |

### 黑名单评分系统
| 行为 | 加分 |
|------|------|
| 超限 1 次 | +10 |
| 认证失败 | +20 |
| 请求错误率高 | +5 |
| 访问蜜罐 | 直接拉黑24H |

**阈值**:
- >= 50 分 → 警告
- >= 100 分 → 拉黑 1 小时
- >= 200 分 → 拉黑 24 小时

**封禁到期**: 到期自动释放，剩余 score 会慢慢恢复

### 蜜罐路由
- `/admin`, `/.env`, `/wp-admin`, `/phpinfo`
- 访问直接 +50 分并返回 404

---

**更多信息**: 查看 `CODE-REVIEW-REPORT.md`