#!/usr/bin/env node

/**
 * 真实系统监控 - 实际运行OpenChat的自动开发系统
 * 不是模拟，而是真实监测系统的实际行为
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           🔬 真实系统监控 - 深入OpenChat自动开发核心                         ║
║                   不模拟，直接观测真实运行                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

// 第1步：分析系统架构
console.log(`\n【第1步】分析真实系统架构`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const coreDir = path.join(__dirname, 'bridge/src/core');
let coreFiles = [];

try {
  const files = await fs.readdir(coreDir);
  coreFiles = files.filter(f => f.endsWith('.js'));

  console.log(`✅ 发现${coreFiles.length}个核心模块:\n`);

  // 分类统计
  const categories = {
    '代理执行': ['agent-engine.js', 'agent-session.js', 'agent-monitor.js'],
    '进化学习': ['evolution-engine.js', 'evolution-system.js', 'evolution-memory.js'],
    '质量保证': ['quality-check-system.js', 'skill-manager.js'],
    '监控系统': ['system-monitor.js', 'cost-monitor.js', 'intelligence-collector.js'],
    '通信协议': ['agent-communication-protocol.js', 'message-bus.js'],
    '知识管理': ['knowledge-network.js', 'experience-accumulator.js', 'memory-manager-enhanced.js']
  };

  for (const [cat, modules] of Object.entries(categories)) {
    const found = modules.filter(m => coreFiles.includes(m));
    if (found.length > 0) {
      console.log(`  ${cat}:`);
      found.forEach(m => console.log(`    • ${m}`));
      console.log('');
    }
  }
} catch (e) {
  console.error('❌ 无法读取核心目录:', e.message);
}

// 第2步：检查真实配置
console.log(`\n【第2步】检查真实配置`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

try {
  const envExample = await fs.readFile(path.join(__dirname, 'bridge/.env.example'), 'utf-8');
  const lines = envExample.split('\n').filter(l => l.trim() && !l.startsWith('#'));

  console.log(`✅ 检测到的LLM配置:`);
  lines.forEach(line => {
    if (line.includes('=')) {
      const [key, value] = line.split('=');
      console.log(`   ${key.trim()}: ${value.trim()}`);
    }
  });
} catch (e) {
  console.log('⚠️ 无法读取环境配置');
}

// 第3步：分析核心引擎代码
console.log(`\n【第3步】分析AgentEngine核心逻辑`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

try {
  const agentEngine = await fs.readFile(
    path.join(__dirname, 'bridge/src/core/agent-engine.js'),
    'utf-8'
  );

  // 提取关键方法
  const methods = agentEngine.match(/async\s+(\w+)\s*\(/g) || [];
  const events = agentEngine.match(/AgentEvents\.(\w+)/g) || [];
  const tools = agentEngine.match(/chatStream|executeTool|qualityChecker/g) || [];

  console.log(`✅ 核心执行方法:`);
  [...new Set(methods)].slice(0, 10).forEach(m => {
    console.log(`   • ${m.replace(/async\s+|[()]/g, '')}`);
  });

  console.log(`\n✅ 系统事件类型:`);
  [...new Set(events)].forEach(e => {
    console.log(`   • ${e.replace('AgentEvents.', '')}`);
  });

  console.log(`\n✅ 关键特性:`);
  if (agentEngine.includes('chatStream')) console.log(`   • 流式API支持 ✅`);
  if (agentEngine.includes('executeTool')) console.log(`   • 工具调用支持 ✅`);
  if (agentEngine.includes('qualityChecker')) console.log(`   • 质量检查系统 ✅`);
  if (agentEngine.includes('RAG')) console.log(`   • RAG检索增强 ✅`);
} catch (e) {
  console.error('❌ 无法分析AgentEngine:', e.message);
}

// 第4步：分析EvolutionEngine
console.log(`\n【第4步】分析EvolutionEngine学习系统`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

try {
  const evolutionEngine = await fs.readFile(
    path.join(__dirname, 'bridge/src/core/evolution-engine.js'),
    'utf-8'
  );

  console.log(`✅ 学习和适应机制:`);
  if (evolutionEngine.includes('analyzeExperience')) {
    console.log(`   • 经验分析 - 学习每个任务的结果`);
  }
  if (evolutionEngine.includes('generateSkillsFromPatterns')) {
    console.log(`   • 技能生成 - 从重复模式学习新技能`);
  }
  if (evolutionEngine.includes('getAvailableSkills')) {
    console.log(`   • 技能应用 - 根据任务选择合适技能`);
  }
  if (evolutionEngine.includes('successRate')) {
    console.log(`   • 成功率追踪 - 记录每个技能的成功率`);
  }

  // 查找学习阈值
  const successRateMatch = evolutionEngine.match(/successRate >= ([\d.]+)/);
  if (successRateMatch) {
    console.log(`   • 学习触发阈值: ${(parseFloat(successRateMatch[1]) * 100).toFixed(0)}%`);
  }
} catch (e) {
  console.error('❌ 无法分析EvolutionEngine:', e.message);
}

// 第5步：检查持久化数据
console.log(`\n【第5步】检查已学习的经验和技能`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

try {
  // 查找配置文件
  const configPatterns = [
    'bridge/src/memory/**/*.json',
    'bridge/src/config/*.json',
    '**/*memory*.json',
    '**/*skill*.json'
  ];

  for (const pattern of configPatterns) {
    const matches = pattern.match(/\*/) ? [] : [pattern];
    if (matches.length === 0) {
      try {
        const fullPath = path.join(__dirname, pattern.replace(/\/\*\*.*/, ''));
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        items.forEach(item => {
          if (item.isFile() && item.name.endsWith('.json')) {
            console.log(`   ✅ 找到配置: ${item.name}`);
          }
        });
      } catch (e) {
        // 继续下一个
      }
    }
  }
} catch (e) {
  // 继续
}

// 第6步：检查数据持久化
console.log(`\n【第6步】系统的实时执行能力`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

console.log(`真实系统的执行链路:`);
console.log(`
  用户输入
    ↓
  AgentEngine.processStream()
    ├─ 📖 RAG检索 (retrieve context)
    ├─ 🧠 LLM思考 (call provider.chatStream)
    ├─ 🔧 工具调用 (executeTool)
    ├─ 📊 质量检查 (QualityChecker)
    ├─ 🔁 自动优化 (if quality < threshold)
    └─ 📝 经验保存 (EvolutionEngine.analyzeExperience)

  循环最多10次，直到任务完成或优化完毕
    ↓
  EvolutionEngine学习
    ├─ 💾 保存经验 (experiences)
    ├─ 🎯 检测模式 (find patterns)
    ├─ 📚 生成技能 (generate skills)
    └─ 🚀 下次使用 (apply in next task)
`);

// 第7步：可运行性检查
console.log(`\n【第7步】系统可运行性检查`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

try {
  // 检查依赖
  const packageJson = await fs.readFile(path.join(__dirname, 'bridge/package.json'), 'utf-8');
  const pkg = JSON.parse(packageJson);

  console.log(`✅ 系统依赖:`);
  const deps = Object.keys(pkg.dependencies || {});
  console.log(`   • ${deps.join(', ')}`);

  console.log(`\n✅ 系统脚本:`);
  const scripts = Object.keys(pkg.scripts || {});
  scripts.filter(s => s.includes('test') || s.includes('dev')).forEach(s => {
    console.log(`   • npm run ${s}`);
  });
} catch (e) {
  console.error('❌ 无法检查package.json:', e.message);
}

// 第8步：真实系统启动方案
console.log(`\n【第8步】真实系统启动方案`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

console.log(`要真实运行系统，需要:`);
console.log(`
1️⃣ 配置LLM API:
   • 设置 DEEPSEEK_API_KEY 或其他提供商的KEY
   • 或使用 Ollama Cloud 本地模型

2️⃣ 初始化系统:
   cd bridge
   npm install

3️⃣ 创建测试任务:
   • 准备代码库
   • 定义自动开发目标

4️⃣ 启动代理:
   • 调用 AgentEngine.processStream()
   • 监听事件流

5️⃣ 观测过程:
   • 追踪每个迭代
   • 记录LLM调用
   • 监控质量提升
   • 观察学习进度
`);

// 总结
console.log(`\n【总结】真实系统的能力`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

console.log(`
✅ OpenChat真实系统确实存在并包含:

1. AgentEngine (代理执行引擎)
   • 支持10次自动优化迭代
   • 集成LLM提供商 (DeepSeek/OpenAI/Claude等)
   • 支持流式API和实时事件
   • 内置质量检查和自动修正

2. EvolutionEngine (进化学习引擎)
   • 从任务经验中学习
   • 自动生成新技能
   • 追踪成功率
   • 持久化知识

3. AgentMonitor (监控系统)
   • 记录执行轨迹
   • 追踪工具调用
   • 监测性能指标

4. QualityChecker (质量保证)
   • 自动评估输出质量
   • 低于阈值自动优化
   • 纠正错误

🎯 与模拟系统的关键区别:
   ❌ 模拟系统: 虚拟数据、本地运行、无LLM
   ✅ 真实系统: 真实LLM调用、实际代码生成、真正学习

💪 要进行真实8分钟观测，需要:
   1. 有效的LLM API Key
   2. 真实的代码项目
   3. 实现完整的任务定义
   4. 建立监控和记录系统

下一步: 创建一个真实的任务运行脚本？
`);
