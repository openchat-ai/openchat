# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

## 技术栈

- **运行时**: Node.js (ESM)
- **核心模块**: 多代理系统、API 桥接、P2P 通信
- **配置文件**: `C:\Users\Administrator\.openchat\config.json`

---

## 关键命令

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 启动 Bridge
node src/main.js

# 运行 API 服务器
node scripts/start-api-server.js
```

---

## 代码规范

### 模块拆分原则
- 单个文件不超过 2000 行
- 独立功能提取为单独模块
- 使用 ESM import/export

### 新增模块示例
```javascript
// src/core/ 新模块命名
import { NewModule } from './new-module.js';
```

### 配置管理
- 所有配置集中在 `C:\Users\Administrator\.openchat\config.json`
- 项目级运行时数据在 `.openchat/` 目录

---

## 安全规范

### 认证方式
- 使用 Bearer Token: `Authorization: Bearer <token>`
- 环境变量: `API_KEYS=key1,key2`

### 限流策略
- 未认证: 50次/分钟
- 已认证: 按路由区分 (50-500次/分钟)

### 黑名单评分
| 行为 | 加分 |
|------|------|
| 超限 | +10 |
| 认证失败 | +20 |
| 访问蜜罐 | 直接拉黑24H |

- >= 100分 → 拉黑 1小时
- >= 200分 → 拉黑 24小时
- 每分钟无异常 → 扣2分（自动恢复，约50分钟恢复100分）
- 封禁到期自动释放

### 蜜罐路由
- `/admin`, `/.env`, `/wp-admin`, `/phpinfo` - 访问直接拉黑 24 小时