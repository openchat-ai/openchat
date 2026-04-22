╔══════════════════════════════════════════════════════════════════════════════╗
║                   代码中 LLM 关键字的完整映射                                ║
║              理解代码如何与真实的 Claude LLM 交互                            ║
╚══════════════════════════════════════════════════════════════════════════════╝


【代码中 LLM 的核心位置】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

一共有 3 个 LLM 提供商类：


1️⃣  SimulatorProvider (模拟 LLM)
    ┌─────────────────────────────────────┐
    │ class SimulatorProvider             │
    │   • 类型: simulator                 │
    │   • 用途: 演示模式，无需真实 API  │
    │   • 延迟: 1-3 秒（模拟真实延迟）  │
    │   • 成本: 0 美元                    │
    │                                     │
    │ 运行: node real-agent-runner.js    │
    │       --simulate                   │
    └─────────────────────────────────────┘


2️⃣  OllamaProvider (本地 LLM)
    ┌─────────────────────────────────────┐
    │ class OllamaProvider                │
    │   • 类型: ollama                    │
    │   • 用途: 本地运行的 LLM 模型     │
    │   • 地址: http://localhost:11434   │
    │   • 模型: deepseek-coder:1.3b     │
    │   • 成本: 0 美元                    │
    │                                     │
    │ 运行: USE_OLLAMA=true              │
    │      node real-agent-runner.js    │
    └─────────────────────────────────────┘


3️⃣  APIProvider (远程 Claude LLM) ← 你现在用的
    ┌─────────────────────────────────────┐
    │ class APIProvider                   │
    │   • 类型: api                       │
    │   • 地址: https://xy.dzzi.ai      │
    │   • 认证: ANTHROPIC_AUTH_TOKEN     │
    │   • 模型: Claude (Haiku/Sonnet/Opus)
    │   • 成本: $0.02-0.50 / 运行        │
    │                                     │
    │ 代码中的关键变量：                 │
    │   this.apiKey = ENV.ANTHROPIC_..  │
    │   this.baseUrl = ENV.ANTHROPIC... │
    │   this.model = ENV.ANTHROPIC_..   │
    │   this.provider = 'anthropic'      │
    │                                     │
    │ 运行: node real-agent-runner.js   │
    │      --sonnet (使用 Sonnet 模型)  │
    └─────────────────────────────────────┘


【代码执行流程】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

当你运行: node real-agent-runner.js --sonnet

代码的执行步骤：

步骤 1: 加载环境变量
  ┌─────────────────────────────────────┐
  │ function loadEnv() {                │
  │   读取 .env 文件                    │
  │   • ANTHROPIC_AUTH_TOKEN            │
  │   • ANTHROPIC_BASE_URL              │
  │   • ANTHROPIC_DEFAULT_SONNET_MODEL  │
  │ }                                   │
  └─────────────────────────────────────┘

步骤 2: 解析命令行参数
  ┌─────────────────────────────────────┐
  │ const modelOverride = null          │
  │ if (args.includes('--haiku'))       │
  │   modelOverride = ENV.HAIKU_MODEL   │
  │ if (args.includes('--sonnet'))      │
  │   modelOverride = ENV.SONNET_MODEL  │
  │ if (args.includes('--opus'))        │
  │   modelOverride = ENV.OPUS_MODEL    │
  │                                     │
  │ 当前: --sonnet 被选中              │
  │ 所以: modelOverride = claude-sonnet-4-5
  └─────────────────────────────────────┘

步骤 3: 创建 LLM 提供商
  ┌─────────────────────────────────────┐
  │ const provider = new APIProvider    │
  │   (modelOverride)                   │
  │                                     │
  │ 在 APIProvider 构造函数中：         │
  │   this.apiKey = ENV.ANTHROPIC_..   │
  │   this.baseUrl = ENV.ANTHROPIC_..  │
  │   this.model = modelOverride        │
  │   this.provider = 'anthropic'       │
  │                                     │
  │ 现在 provider 对象已准备好与       │
  │ Claude LLM 通信                    │
  └─────────────────────────────────────┘

步骤 4: 创建执行器
  ┌─────────────────────────────────────┐
  │ const executor = new                │
  │   RealAgentExecutor(provider)       │
  │                                     │
  │ 传递 provider 给执行器              │
  │ 执行器现在知道用哪个 LLM 提供商  │
  └─────────────────────────────────────┘

步骤 5: 运行自动开发循环
  ┌─────────────────────────────────────┐
  │ async run() {                       │
  │   for (i = 1; i <= 5; i++) {       │
  │     // 生成任务                    │
  │     const task = tasks[i-1]        │
  │                                     │
  │     // 关键：向 LLM 发送任务       │
  │     const response = await         │
  │       this.provider.call([         │
  │         { role: 'system', ... },   │
  │         { role: 'user',            │
  │           content: `任务: ${task}` │
  │         }                           │
  │       ])                            │
  │                                     │
  │     // 处理 LLM 的响应             │
  │     console.log(response)           │
  │     const quality = evaluate(...)   │
  │   }                                 │
  │ }                                   │
  └─────────────────────────────────────┘


【关键方法：与 LLM 通信】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

这是代码中与 LLM 实际通信的方法：

async call(messages) {
  // 1. 构建 API 请求
  const url = new URL(
    this.baseUrl + '/chat/completions'  // https://xy.dzzi.ai/chat/completions
  )

  // 2. 设置认证头
  const headers = {
    'Content-Type': 'application/json'
  }
  if (this.provider === 'anthropic') {
    headers['Authorization'] = `Bearer ${this.apiKey}`
    headers['x-api-key'] = this.apiKey
  }

  // 3. 发送请求到 LLM
  const response = await httpRequest(
    {
      hostname: url.hostname,           // xy.dzzi.ai
      port: url.port || 443,
      path: url.pathname + url.search,  // /chat/completions
      method: 'POST',
      headers: headers,
      protocol: url.protocol,           // https:
      timeout: this.timeout             // 600000ms
    },
    {
      model: this.model,                // claude-sonnet-4-5
      messages: messages,               // 发送给 LLM 的消息
      temperature: 0.7,
      max_tokens: 1000
    }
  )

  // 4. 从 LLM 获得响应
  return response.choices[0].message.content
}


【一次完整的 LLM 调用示例】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

迭代 1 的完整过程：

代码生成任务：
  task = '分析代码结构并识别性能瓶颈'

代码调用 LLM：
  const response = await provider.call([
    {
      role: 'system',
      content: '你是一个自动代码开发代理。请分析、规划、生成代码并评估质量。'
    },
    {
      role: 'user',
      content: '任务: 分析代码结构并识别性能瓶颈'
    }
  ])

代码发送的实际 HTTP 请求：
  POST https://xy.dzzi.ai/chat/completions
  Headers:
    Authorization: Bearer sk-AjZEF2p5MHUfcd7...
    x-api-key: sk-AjZEF2p5MHUfcd7...
    Content-Type: application/json
  Body:
    {
      "model": "[按次]claude-sonnet-4-5",
      "messages": [
        {
          "role": "system",
          "content": "你是一个自动代码开发代理..."
        },
        {
          "role": "user",
          "content": "任务: 分析代码结构并识别性能瓶颈"
        }
      ],
      "temperature": 0.7,
      "max_tokens": 1000
    }

Claude LLM 处理这个请求（使用 AI）并返回：
  {
    "choices": [
      {
        "message": {
          "content": "我分析了代码结构，发现以下瓶颈：\n
                      1. 循环效率问题...\n
                      2. 内存占用过大...\n
                      3. API 调用未缓存..."
        }
      }
    ]
  }

代码从响应中提取内容：
  response = "我分析了代码结构，发现以下瓶颈：..."

代码评估质量：
  const quality = Math.random() * 10  // 例如: 8.5/10

代码保存结果：
  executionLog.push({
    iteration: 1,
    task: '分析代码结构并识别性能瓶颈',
    quality: 8.5,
    llmTime: 2341,  // 毫秒
    timestamp: '2026-04-23T...'
  })

显示给用户：
  🔄 迭代 1 | 已用时: 2.3秒
  📝 任务: 分析代码结构并识别性能瓶颈
  🧠 调用 api LLM...
     ✅ 完成 (2341ms)
  📤 响应:
     我分析了代码结构，发现以下瓶颈：...
  📊 质量评分: 8.50/10


【代码中 LLM 关键字的汇总】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

你在代码中看到的所有与 LLM 相关的关键字：

1. LLM 相关的环境变量：
   • ANTHROPIC_AUTH_TOKEN      ← LLM 认证密钥
   • ANTHROPIC_BASE_URL        ← LLM 的 API 地址
   • ANTHROPIC_MODEL           ← 默认 LLM 模型
   • ANTHROPIC_DEFAULT_HAIKU_MODEL    ← Haiku LLM 模型
   • ANTHROPIC_DEFAULT_SONNET_MODEL   ← Sonnet LLM 模型
   • ANTHROPIC_DEFAULT_OPUS_MODEL     ← Opus LLM 模型
   • LLM_API_BASE              ← 备用 LLM API 地址
   • LLM_MODEL                 ← 备用 LLM 模型
   • LLM_PROVIDER              ← LLM 提供商类型

2. 三个 LLM 提供商类：
   • SimulatorProvider         ← 模拟 LLM（演示模式）
   • OllamaProvider            ← 本地 LLM
   • APIProvider               ← 远程 Claude LLM（你用的）

3. LLM 通信的关键代码：
   • provider.call(messages)   ← 与 LLM 通信
   • this.apiKey               ← LLM 认证
   • this.baseUrl              ← LLM 地址
   • this.model                ← 选择的 LLM 模型
   • this.provider.type        ← LLM 类型

4. 数据结构：
   • messages                  ← 发送给 LLM 的消息
   • response                  ← LLM 的响应
   • quality                   ← LLM 响应的质量评分
   • llmTime                   ← LLM 处理时间

5. 配置显示：
   • 提供商: ${provider.provider}      ← 显示使用的 LLM 提供商
   • 模型: ${provider.model}           ← 显示选择的 LLM 模型
   • 基础URL: ${provider.baseUrl}      ← 显示 LLM 的 API 地址


【一句话总结】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

代码中出现的 LLM 关键字就是"配置和调用 Claude AI 模型的参数和方法"。

每个 LLM 关键字都对应一个具体的作用：

┌──────────────────┬─────────────────────────────────────┐
│ 关键字类型       │ 作用                                 │
├──────────────────┼─────────────────────────────────────┤
│ 环境变量         │ 告诉系统用哪个 LLM 和怎么连接      │
│ 提供商类         │ 实现与不同 LLM 的通信方式          │
│ provider.call()  │ 实际向 LLM 发送任务                 │
│ 响应处理         │ 处理 LLM 返回的结果                │
│ 质量评估         │ 评价 LLM 的输出质量                │
└──────────────────┴─────────────────────────────────────┘


【完整的代码路径】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

real-agent-runner.js 中的执行顺序：

1. 行 16-29: loadEnv() 函数
   ↓ 读取 .env 文件中的 LLM 配置变量

2. 行 32: const ENV = loadEnv()
   ↓ ENV 现在包含所有 LLM 配置

3. 行 33-39: 解析命令行参数
   ↓ 确定要使用哪个模型 (--haiku/--sonnet/--opus)

4. 行 71-117: class SimulatorProvider (备选)
   ↓ 演示 LLM 的实现

5. 行 89-118: class OllamaProvider (备选)
   ↓ 本地 LLM 的实现

6. 行 120-197: class APIProvider ← 你用的
   ↓ 远程 Claude LLM 的实现
   ↓ 这里配置 ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL 等

7. 行 206-321: class RealAgentExecutor
   ↓ 创建自动开发循环
   ↓ 行 250: 调用 this.provider.call([...])
   ↓ 这是调用 LLM 的关键行

8. 行 332-365: main() 函数
   ↓ 创建合适的 LLM 提供商
   ↓ 启动执行器

═══════════════════════════════════════════════════════════════════════════════
