/**
 * Legacy Compatibility Layer
 * 旧版 App 请求兼容层 — 已认证 (Bearer Token)
 * 合并 main.js 原始 HTTP 服务器的所有路由
 */

import express from 'express';
import { persistentConfig } from '../../core/persistent-config.js';
import * as providerService from '../../core/provider-service.js';
import { sessionManager } from '../../core/session-manager.js';
import { memoryManager } from '../../memory/memory-manager.js';
import { pluginManager } from '../../plugins/plugin-manager.js';

const router = express.Router();

let bridgeRef = null;

// === Workspace + Patch 工具 ===

import fs from 'fs/promises';
import path from 'path';

async function ensureWorkspace(workspace) {
  const workspacePath = path.resolve('workspaces', workspace);
  try {
    await fs.mkdir(workspacePath, { recursive: true });
  } catch {}
  return workspacePath;
}

async function writeWithGit(workspace, filePath, newContent) {
  const workspacePath = await ensureWorkspace(workspace);
  const fullPath = path.join(workspacePath, filePath);
  const { execSync } = await import('child_process');

  // 确保 git 仓库已初始化
  const gitDir = path.join(workspacePath, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    try {
      execSync('git init', { cwd: workspacePath, stdio: 'pipe' });
      execSync('git config user.email "agent@openchat" && git config user.name "OpenChat Agent"', { cwd: workspacePath, stdio: 'pipe' });
    } catch {}
  }

  let result = { action: 'created', path: filePath, size: newContent.length, commit: null };

  try {
    const existing = await fs.readFile(fullPath, 'utf8');
    if (existing !== newContent) {
      await fs.writeFile(fullPath, newContent, 'utf8');
      try {
        execSync('git add .', { cwd: workspacePath, stdio: 'pipe' });
        const msg = `${new Date().toISOString()} update ${filePath}`;
        const hash = execSync(`git commit -m "${msg}"`, { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
        result = { action: 'committed', path: filePath, size: newContent.length, commit: hash.slice(0, 8) };
      } catch {
        result = { action: 'written', path: filePath, size: newContent.length, commit: null };
      }
    } else {
      result = { action: 'unchanged', path: filePath, size: newContent.length };
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, newContent, 'utf8');
      try {
        execSync('git add .', { cwd: workspacePath, stdio: 'pipe' });
        const msg = `${new Date().toISOString()} create ${filePath}`;
        const hash = execSync(`git commit -m "${msg}"`, { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
        result = { action: 'committed', path: filePath, size: newContent.length, commit: hash.slice(0, 8) };
      } catch {
        result = { action: 'created', path: filePath, size: newContent.length, commit: null };
      }
    } else {
      throw e;
    }
  }

  return result;
}

export function setBridgeContext(bridge) {
  bridgeRef = bridge;
}

// 1. 状态检查 (扩展版)
router.get('/status', async (req, res, next) => {
  try {
    const memStats = await memoryManager.getStats();
    res.json({
      status: 'running',
      uptime: Math.floor(process.uptime()),
      currentProvider: persistentConfig.getPreference('currentProvider'),
      currentModel: persistentConfig.getPreference('currentModel'),
      wsClients: bridgeRef?.clients?.size || 0,
      memory: memStats
    });
  } catch (e) { next(e); }
});

// 2. Provider 列表
router.get('/providers', (req, res) => {
  const providers = providerService.listAll();
  const current = persistentConfig.getPreference('currentProvider');
  res.json({ current, providers });
});

// 3. 会话列表
router.get('/sessions', (req, res) => {
  const sessions = sessionManager.listSessions();
  res.json({ sessions });
});

// 3.5 直通 LLM 端点 — 不走 agent loop，直接调 LLM 返回原始结果
router.post('/direct', async (req, res, next) => {
  try {
    const { message, system } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = persistentConfig.getPreference('currentModel') || 'openrouter/free';
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    msgs.push({ role: 'user', content: message });
    const result = await provider.chat(model, msgs);
    res.json({ response: result.content, model: result.model, source: 'direct' });
  } catch (e) {
    console.error('[direct] error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// 3.7 探测模型能力：测试模型支持什么输出格式
router.post('/probe', async (req, res, next) => {
  try {
    const { message, model: probeModel } = req.body;
    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = probeModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });

    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);

    // 测试1：JSON格式请求
    const testPrompt = message || '请用JSON格式回复，只输出 {"answer":"你收到的消息内容"} 这样的格式，不要加其他内容';

    const tests = [];

    // 测试各种格式
    const testCases = [
      { name: 'simple_answer', prompt: '回复 "hello"' },
      { name: 'json_format', prompt: '用JSON格式回复: {"answer":"hello"}' },
      { name: 'tool_call', prompt: '调用 write_file 工具写入 tests/test.txt 内容是 test' },
    ];

    for (const tc of testCases) {
      const start = Date.now();
      try {
        const result = await provider.chat(model, [
          { role: 'user', content: tc.prompt }
        ]);
        const elapsed = Date.now() - start;
        tests.push({
          name: tc.name,
          prompt: tc.prompt,
          model: result.model,
          elapsed_ms: elapsed,
          output: result.content?.substring(0, 500),
          has_think: result.content?.includes('<think>'),
          is_json: false,
          is_action: false,
          is_final: false,
        });
        // 检测格式
        const c = result.content || '';
        if (c.trim().startsWith('{')) {
          try { JSON.parse(c); tests[tests.length-1].is_json = true; } catch {}
        }
        if (c.includes('ACTION:') || c.includes('<tool_call>')) tests[tests.length-1].is_action = true;
        if (c.includes('FINAL:')) tests[tests.length-1].is_final = true;
      } catch (e) {
        tests.push({ name: tc.name, prompt: tc.prompt, error: e.message });
      }
    }

    res.json({ provider: providerName, model, tests });
  } catch (e) {
    console.error('[probe] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 4. Spec-first 工作流：分析需求生成 SPEC.md
router.post('/spec', async (req, res, next) => {
  try {
    const { message, model: customModel } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const prompt = `你是一个顶级需求分析师。请分析以下需求，生成详细的 SPEC.md 文档（施工蓝图，不是高层概述）：

需求：${message}

SPEC.md 格式（每个章节必须填满，不准写"TBD"或省略）：

# spec: [模块名]
> 简短描述 (1-2 行)

## 数据流
逐步骤描述（不是概述）：
1. 用户操作 X → 调用 Y → 更新 Z → 渲染 W
2. ...
列出每个用户操作触发的完整数据流路径

## 接口签名
完整类型化签名（不是空函数名）：
\`\`\`
class ClassName:
  constructor(param: Type)
  methodName(arg1: Type1, arg2: Type2): ReturnType
function helperName(input: Type): ReturnType
\`\`\`
包含所有类、函数、参数类型、返回类型

## 边界条件
- 输入为空时：[处理方式]
- 输入非法时：[处理方式]
- 并发场景：[处理方式]
- 错误状态：[处理方式]
至少 5 条

## 文件清单
| 文件 | 职责 | 行数上限 |
| --- | --- | --- |
| index.html | 入口+DOM+初始化 | 80 |
| script.js | 核心逻辑 | 150 |

## 调试检查点
| C | grep 关键词 | 预期 |
| --- | --- | --- |
| C1 | "[init]" | 初始化时打印 |
| C2 | "[input]" | 每次输入时打印 |
| C3 | "[result]" | 计算完成时打印 |

## 不变量
// === invariants ===
// - currentValue 始终是字符串
// - ...

请严格按照格式输出，所有章节必须填满详细具体内容。SPEC 是代码生成器的输入，不是给人看的概述。`;

    const result = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。' },
      { role: 'user', content: prompt }
    ]);

    const spec = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/, '').trim() || '';

    res.json({
      spec,
      model: result.model,
      source: 'spec'
    });
  } catch (e) {
    console.error('[spec] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 4.5 根据 SPEC.md 生成骨架文件（框架、空实现）
router.post('/skeleton', async (req, res, next) => {
  try {
    const { spec, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const prompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const result = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的代码架构师，擅长生成骨架代码。' },
      { role: 'user', content: prompt }
    ]);

    const output = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';

    // 解析骨架文件
    const fileInfos = [];
    const fileMatches = output.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    // 写入 workspace
    const writeResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      writeResults.push(r);
    }

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      files: writeResults,
      model: result.model,
      source: 'skeleton'
    });
  } catch (e) {
    console.error('[skeleton] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5. 根据 SPEC.md 执行实现（确定性路由，不走 agent loop）
// 从文本中提取代码内容
function extractCode(output, filename) {
  // 1. 尝试从 markdown code block 提取
  const codeBlockMatch = output.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // 2. 尝试从指定文件名提取 "```filename\n...```"
  const namedMatch = output.match(new RegExp(`\`\`\`\\w*\\n?([\\s\\S]*?)\`\`\``, 'g'));
  if (namedMatch && namedMatch.length > 0) {
    // 返回最后一个 code block（通常包含完整代码）
    const last = namedMatch[namedMatch.length - 1];
    const inner = last.match(/```[\w]*\n?([\s\S]*?)```/);
    if (inner) return inner[1].trim();
  }
  // 3. 如果没有 code block，返回整段（去掉 <think> 等标记）
  return output.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').replace(/```[\s\S]*?```/g, '').trim();
}

router.post('/implement', async (req, res, next) => {
  try {
    const { spec, tasks, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const results = [];
    const taskList = tasks || [];

    for (const task of taskList) {
      const start = Date.now();
      try {
        const filePath = task.filename || task.path || task.file;
        const workspacePath = path.resolve('workspaces', workspace);
        const fullPath = path.join(workspacePath, filePath);

        let existingContent = '';
        try {
          existingContent = await fs.readFile(fullPath, 'utf8');
        } catch {}

        const prompt = `你是一个代码实现助手。请根据以下 SPEC 实现任务：

SPEC:
${spec}

当前任务:
${task.description}
${existingContent ? `现有文件内容（请在次基础上修改，不要简单覆盖整个文件）：\n\`\`\`\n${existingContent}\n\`\`\`` : ''}

要求：
- 基于现有内容修改，只改必要的部分
- 用 markdown code block 包裹完整文件内容输出
- 不要输出其他内容`;

        const result = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: prompt }
        ], null, { timeout: 180000 });

        const output = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, filePath);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, filePath, code);
          results.push({
            task: task.description || filePath,
            status: writeResult.action === 'unchanged' ? 'unchanged' : 'success',
            ...writeResult,
            elapsed: Date.now() - start
          });
        } else {
          results.push({
            task: task.description,
            status: 'skipped',
            output: output.substring(0, 200),
            elapsed: Date.now() - start
          });
        }
      } catch (e) {
        results.push({
          task: task.description,
          status: 'error',
          error: e.message,
          elapsed: Date.now() - start
        });
      }
    }

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      results,
      model,
      source: 'implement'
    });
  } catch (e) {
    console.error('[implement] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5.5 完整构建：skeleton + implement 流水线
router.post('/build', async (req, res, next) => {
  try {
    const { spec, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    // Step 1: 生成完整可运行代码（不是骨架）
    const skeletonPrompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const skeletonResult = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的代码架构师，擅长生成骨架代码。' },
      { role: 'user', content: skeletonPrompt }
    ]);

    const skeletonOutput = skeletonResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    const fileInfos = [];
    const fileMatches = skeletonOutput.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    // Step 2: 写入骨架文件
    const skeletonResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      skeletonResults.push(r);
    }

    // Step 3: 并行实现所有文件
    const implementPromises = fileInfos.map(async (f) => {
      const start = Date.now();
      const implementPrompt = `你是一个代码实现助手。请为以下文件实现完整代码：

SPEC:
${spec}

目标文件:
${f.path}

当前骨架:
${f.content}

要求：
- 基于骨架实现完整代码
- 用 markdown code block 包裹代码输出`;

      try {
        const implResult = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: implementPrompt }
        ]);

        const output = implResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, f.path);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, f.path, code);
          return { file: f.path, ...writeResult, elapsed: Date.now() - start };
        } else {
          return { file: f.path, status: 'skipped', output: output.substring(0, 200), elapsed: Date.now() - start };
        }
      } catch (e) {
        return { file: f.path, status: 'error', error: e.message, elapsed: Date.now() - start };
      }
    });

    const implementResults = await Promise.all(implementPromises);

    // Step 4: 列出 workspace 中的文件
    const workspacePath = path.resolve('workspaces', workspace);
    let fileList = [];
    try {
      const entries = await fs.readdir(workspacePath, { recursive: true });
      fileList = entries.map(e => ({
        path: path.relative(workspacePath, path.join(workspacePath, String(e))),
        type: e.endsWith('.patch') ? 'patch' : 'source'
      }));
    } catch {}

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      skeletonResults,
      implementResults,
      fileList,
      model,
      source: 'build'
    });
  } catch (e) {
    console.error('[build] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5.6 一键生成：用户说需求 → 自动 spec → skeleton → implement → 最终文件
router.post('/generate', async (req, res, next) => {
  try {
    const { description, workspace, model: customModel } = req.body;
    if (!description) return res.status(400).json({ error: 'DESCRIPTION_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    // Step 1: 自然语言 → SPEC.md
    const specPrompt = `你是一个需求分析师。用户想要：

${description}

请生成一个完整的 SPEC.md 文档，包含：
1. 项目名称和简短描述
2. 文件清单（哪些文件，每个文件职责）
3. 数据流（输入→处理→输出）
4. 接口设计（关键类/函数签名）
5. 入口行为（页面加载后做什么）

只输出 SPEC.md 内容，不要加其他说明。`;

    const specResult = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。' },
      { role: 'user', content: specPrompt }
    ]);

    const spec = specResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    if (!spec) throw new Error('SPEC_GENERATION_FAILED');

    // Step 2: SPEC → 完整可运行代码
    const skeletonPrompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const skeletonResult = await provider.chat(model, [
      { role: 'system', content: '你是一个顶级代码生成器，根据详细 SPEC 直接生成完整可运行代码。' },
      { role: 'user', content: skeletonPrompt }
    ]);

    const skeletonOutput = skeletonResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    const fileInfos = [];
    const fileMatches = skeletonOutput.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    if (fileInfos.length === 0) throw new Error('SKELETON_GENERATION_FAILED');

    // Step 3: 写入骨架 + 并行实现
    const skeletonResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      skeletonResults.push(r);
    }

    // Step 4: 并行实现每个文件
    const implementPromises = fileInfos.map(async (f) => {
      const start = Date.now();
      const implementPrompt = `你是一个代码实现助手。请为以下文件实现完整代码：

${spec}

目标文件:
${f.path}

当前骨架:
${f.content}

要求：
- 基于骨架实现完整代码
- 用 markdown code block 包裹代码输出`;

      try {
        const implResult = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: implementPrompt }
        ], null, { timeout: 180000 });

        const output = implResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, f.path);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, f.path, code);
          return { file: f.path, ...writeResult, elapsed: Date.now() - start };
        } else {
          return { file: f.path, status: 'skipped', output: output.substring(0, 200), elapsed: Date.now() - start };
        }
      } catch (e) {
        return { file: f.path, status: 'error', error: e.message, elapsed: Date.now() - start };
      }
    });

    const implementResults = await Promise.all(implementPromises);

    // Step 5: 列出 workspace 中的文件
    const workspacePath = path.resolve('workspaces', workspace);
    let fileList = [];
    try {
      const entries = await fs.readdir(workspacePath, { recursive: true });
      fileList = entries.map(e => ({
        path: path.relative(workspacePath, path.join(workspacePath, String(e))),
        type: e.endsWith('.patch') ? 'patch' : 'source'
      }));
    } catch {}

    res.json({
      description,
      workspace,
      spec,
      skeletonResults,
      implementResults,
      fileList,
      model,
      source: 'generate'
    });
  } catch (e) {
    console.error('[generate] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 6. 聊天接口 (走 agent-engine 工具循环)
router.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    let providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = persistentConfig.getPreference('currentModel');
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });

    if (!sessionManager.getProvider(providerName)) {
      await sessionManager.addProvider(providerName, apiKey);
    }

    let sid = sessionId;
    if (!sid || !sessionManager.getSession(sid)) {
      const created = await sessionManager.createSession(providerName, model);
      sid = created.id;
    }

    const { agentEngine } = await import('../../core/agent/agent-engine.js');
    const result = await agentEngine.process(sid, 'mobile-user', message);
    res.json({ response: result, sessionId: sid, source: 'agent' });
  } catch (e) {
    console.error('[chat] error:', e.message);
    next(e);
  }
});

// 5. 流式聊天 (SSE)
router.post('/chat/stream', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    if (bridgeRef?._handleChatStreamViaSSE) {
      bridgeRef._handleChatStreamViaSSE(req, res);
    } else {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sessionId || `session_${Date.now()}` })}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Response to: ${message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', content: 'Response complete' })}\n\n`);
        res.end();
      }, 500);
    }
  } catch (e) { next(e); }
});

// 6. 配置管理
router.get('/config', (req, res) => {
  res.json({
    currentProvider: persistentConfig.getPreference('currentProvider'),
    currentModel: persistentConfig.getPreference('currentModel'),
    configuredProviders: persistentConfig.listProviders()
  });
});

router.post('/config', async (req, res, next) => {
  try {
    const { provider, model, apiKey } = req.body;
    if (apiKey) persistentConfig.setApiKey(provider, apiKey);
    if (provider) persistentConfig.setPreference('currentProvider', provider);
    if (model) persistentConfig.setPreference('currentModel', model);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// 7. 内存管理
router.get('/memory', async (req, res, next) => {
  try {
    const stats = await memoryManager.getStats();
    res.json(stats);
  } catch (e) { next(e); }
});

router.post('/memory', async (req, res, next) => {
  try {
    const { action, fact, query } = req.body;
    if (action === 'remember' && fact) {
      const id = await memoryManager.saveFact('default', fact);
      res.json({ success: true, id });
    } else if (action === 'recall' && query) {
      const results = await memoryManager.queryFacts('default', query);
      res.json({ results });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (e) { next(e); }
});

// 8. Provider 连接配置
router.post('/provider/connect', async (req, res, next) => {
  try {
    const { providerId, apiKey, baseUrl } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId required' });
    const result = await providerService.configure(providerId, { apiKey, baseUrl });
    if (result.success) {
      const models = providerService.getModels(providerId);
      res.json({ success: true, providerId, modelCount: models.length, models: models.slice(0, 20) });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (e) { next(e); }
});

router.get('/provider/models', async (req, res, next) => {
  try {
    const { providerId } = req.query;
    if (!providerId) return res.status(400).json({ error: 'providerId required' });
    const models = providerService.getModels(providerId) || [];
    res.json({ providerId, models: models.slice(0, 50) });
  } catch (e) { next(e); }
});

router.post('/provider/set', (req, res) => {
  const { provider } = req.body;
  if (provider) persistentConfig.setPreference('currentProvider', provider);
  res.json({ success: true });
});

// 9. Peer 列表
router.get('/peers', (req, res) => {
  const p2p = bridgeRef?.p2p;
  const peers = p2p ? [...p2p.connectedPeers.keys()].map(id => ({
    peerId: id.slice(0, 8),
    info: p2p.peerInfo.get(id) || {}
  })) : [];
  res.json({ peers });
});

// 14. 当前 Provider 信息
router.get('/ai/main', (req, res) => {
  const provider = persistentConfig.getPreference('currentProvider');
  const model = persistentConfig.getPreference('currentModel');
  res.json({
    id: provider || 'default',
    name: provider || 'Primary AI',
    model: model || 'default',
    status: 'ready'
  });
});

export default router;