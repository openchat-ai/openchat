#!/usr/bin/env node

/**
 * OpenChat 本地LLM集成 - 快速开始指南
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const guide = `
╔══════════════════════════════════════════════════════════════════════════════╗
║            🚀 OpenChat 本地LLM集成 - 快速开始指南                           ║
║                     真实系统 × 本地运行 × 实时学习                          ║
╚══════════════════════════════════════════════════════════════════════════════╝

【5分钟快速开始】

方案A: 🎬 演示模式 (无需任何配置)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ node real-agent-runner.js --simulate

✅ 特点:
   • 真实的系统架构和执行流程
   • 真实的监控和日志系统
   • 模拟的LLM输出（用于演示）
   • 完全无需配置

📊 输出:
   ✓ 实时的迭代进度
   ✓ 质量评分和学习检测
   ✓ 完整的执行日志


方案B: 🦙 本地Ollama模型
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

步骤1: 安装 Ollama
   下载: https://ollama.ai/download (Windows版本)

步骤2: 启动 Ollama 服务 (需要新的终端)
   $ ollama serve

步骤3: 拉取模型 (需要新的终端)
   $ ollama pull deepseek-coder:1.3b    # 轻量级，推荐
   或
   $ ollama pull mistral               # 高质量
   或
   $ ollama pull neural-chat          # 通用

步骤4: 配置 OpenChat
   $ node setup-local-llm.js          # 交互式配置
   选择选项1: Ollama

步骤5: 运行 OpenChat
   $ node real-agent-runner.js

📊 优点:
   ✓ 完全本地运行，无需API Key
   ✓ 真实的LLM推理过程
   ✓ 支持多种模型选择
   ✓ 可离线使用


方案C: 🌐 API Key (DeepSeek/OpenAI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

步骤1: 获取API Key
   • DeepSeek: https://platform.deepseek.com/
   • OpenAI: https://platform.openai.com/
   • Anthropic: https://console.anthropic.com/

步骤2: 配置 OpenChat
   $ node setup-local-llm.js          # 交互式配置
   选择选项2: LLM API
   输入你的API Key

步骤3: 运行 OpenChat
   $ node real-agent-runner.js

📊 优点:
   ✓ 无需本地计算资源
   ✓ 支持最新的模型
   ✓ 更强大的推理能力


方案D: 🧪 混合模式 (最强)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

同时配置 Ollama 和 API Key:
   $ node setup-local-llm.js          # 交互式配置
   选择选项3: 混合模式

系统会自动:
   • 优先使用本地 Ollama
   • Ollama 出错时自动切换到 API
   • 确保可靠性和最优性能

📊 优点:
   ✓ 最高可靠性
   ✓ 最优性能
   ✓ 完全自动选择


【核心命令】

# 配置
node setup-local-llm.js              # 交互式配置向导
node local-llm-setup.js              # 另一个配置选项

# 运行
node real-agent-runner.js            # 使用已配置的LLM
node real-agent-runner.js --simulate # 演示模式
node real-agent-runner.js --monitor 8m  # 8分钟监控模式

# 分析
node real-system-monitor.js          # 系统架构分析
node 8-minute-detailed-analysis.js   # 8分钟观察分析


【推荐流程】

新手入门:
  1. $ node real-agent-runner.js --simulate      # 先看演示
  2. $ node setup-local-llm.js                   # 选择你的方式
  3. $ node real-agent-runner.js                 # 运行真实系统

深度体验:
  1. $ ollama serve                              # 启动Ollama
  2. $ ollama pull deepseek-coder:1.3b          # 拉取模型
  3. $ node setup-local-llm.js                   # 配置选择Ollama
  4. $ node real-agent-runner.js                 # 运行真实系统
  5. 观察日志: real-agent-execution.log

完整观察:
  1. 配置任意LLM方式
  2. $ node real-agent-runner.js --monitor 8m   # 长期观察
  3. $ node 8-minute-detailed-analysis.js       # 分析结果


【文件说明】

setup-local-llm.js               # 配置向导 (交互式)
local-llm-setup.js               # 配置方案说明
real-agent-runner.js             # 核心运行器 (无外部依赖)
real-system-monitor.js           # 系统架构分析
8-minute-detailed-analysis.js    # 8分钟观察分析

.env                             # 配置文件 (会自动生成)
real-agent-execution.log         # 执行日志 (运行后生成)


【常见问题】

Q: 我没有API Key，也不想装Ollama，怎么办？
A: 使用演示模式: node real-agent-runner.js --simulate
   可以完整理解系统工作流程。

Q: 装Ollama需要多少空间？
A: deepseek-coder:1.3b 约 800MB
   mistral 约 4GB
   neural-chat 约 4.4GB

Q: Ollama 在后台运行时是否消耗资源？
A: 闲置时几乎无消耗。使用时根据模型大小调用GPU/CPU。

Q: 可以切换不同的模型吗？
A: 可以。修改 .env 中的 OLLAMA_MODEL 或重新运行 setup-local-llm.js

Q: API调用会产生费用吗？
A: 会。DeepSeek 和 OpenAI 都是按tokens计费。
   建议先用演示模式或Ollama测试。

Q: 如何查看系统的实时学习过程？
A: 运行: node 8-minute-detailed-analysis.js
   或查看 real-agent-execution.log


【性能参考】

Ollama (本地):
  • 响应时间: 5-20秒 (取决于模型和硬件)
  • 成本: 0元
  • 隐私: 完全本地

API (DeepSeek/OpenAI):
  • 响应时间: 1-3秒
  • 成本: 按tokens计费
  • 隐私: 数据发送到云端

演示模式:
  • 响应时间: 1-3秒 (模拟延迟)
  • 成本: 0元
  • 用途: 学习系统工作流程


【下一步】

现在就开始:

  🎯 想要快速体验?
     $ node real-agent-runner.js --simulate

  🎯 想要真实LLM?
     $ node setup-local-llm.js

  🎯 想要深入了解?
     $ node real-system-monitor.js

  🎯 看完整分析?
     $ node 8-minute-detailed-analysis.js


╔══════════════════════════════════════════════════════════════════════════════╗
║                          准备好了吗? 开始运行吧!                            ║
║                    node real-agent-runner.js --simulate                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

console.log(guide);

// 保存为文件
try {
  fs.writeFileSync(path.join(__dirname, 'QUICKSTART.md'), guide);
  console.log('\n✅ 快速开始指南已保存: QUICKSTART.md\n');
} catch (e) {
  console.error('保存失败:', e.message);
}
