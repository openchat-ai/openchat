# 🤖 AI Agent测试框架集成指南

## 环境设置

### 1. 安装依赖
```bash
npm install axios dotenv
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写你的LLM API密钥：
```bash
cp .env.example .env
# 编辑 .env 文件填入你的 API 密钥
```

### 3. 支持的LLM提供商

#### DeepSeek API
```env
LLM_API_BASE=https://api.deepseek.com
LLM_API_KEY=sk-your-deepseek-key
LLM_MODEL=deepseek-v3
```

#### OpenAI API
```env
LLM_API_BASE=https://api.openai.com
LLM_API_KEY=sk-your-openai-key  
LLM_MODEL=gpt-4o
```

#### 其他兼容API
任何支持OpenAI格式的API提供商都可以使用。

## 运行测试

### 单个测试套件
```bash
# LLM智能评测
npm run test:llm-judge

# 属性测试
npm run test:property

# 回归测试
npm run test:replay

# 混沌测试
npm run test:chaos
```

### 完整测试流水线
```bash
# 运行所有测试
npm run test:llm-judge && npm run test:property && npm run test:replay && npm run test:chaos

# 生成测试报告
npm run test:coverage
```

## 测试结果

测试结果保存在以下目录：
- `./test-results/` - LLM评测结果
- `./test-traces/` - 执行轨迹记录
- `./replay-results/` - 回归测试结果
- `./chaos-results/` - 混沌测试结果
- `./coverage/` - 代码覆盖率报告

## 自定义测试用例

### 添加新的评测用例
编辑 `test-utils/llm-judge.js` 中的 `loadTestCases()` 方法：

```javascript
{
  id: 'your-test-case',
  description: '测试描述',
  prompt: '用户提示',
  expectedActions: ['tool1', 'tool2'],
  expectedOutcome: '预期结果描述'
}
```

### 添加混沌场景
编辑 `test-utils/chaos-test.js` 中的 `getChaosScenarios()` 方法。

## 性能优化

### 批量处理
对于大量测试用例，可以启用批量处理：
```javascript
// 在 llm-judge.js 中
const BATCH_SIZE = 3; // 同时处理3个测试用例
```

### 缓存优化
LLM响应可以缓存以避免重复调用：
```javascript
// 启用响应缓存
USE_RESPONSE_CACHE=true
CACHE_TTL=3600000 // 1小时
```

## 故障排除

### 常见问题

1. **API调用失败**
   - 检查API密钥是否正确
   - 确认API端点可访问
   - 查看网络连接

2. **JSON解析错误**
   - LLM可能没有返回严格的JSON格式
   - 启用备用评估模式

3. **超时问题**
   - 调整 `TEST_TIMEOUT` 环境变量
   - 减少并发测试数量

### 调试模式
启用详细日志：
```bash
LOG_LEVEL=debug npm run test:llm-judge
```

## 扩展测试框架

### 添加新的测试类型
1. 在 `test-utils/` 创建新的测试文件
2. 在 `package.json` 添加对应的脚本
3. 集成到主测试流水线中

### 自定义评估标准
编辑 `test-utils/eval-setup.json` 来调整评测权重和标准。