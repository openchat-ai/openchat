import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'System Exec — LLM 宿主机命令执行';

async function testSystemExec() {
  // 1. system-exec.mjs 可加载，TOOLS 数组完整
  let tools;
  try {
    tools = await import('../../src/tools/system-exec.mjs');
    ok('system-exec.mjs 可加载');
  } catch (e) {
    ng('system-exec 加载失败', e);
    report(NAME); return;
  }

  if (Array.isArray(tools.TOOLS) && tools.TOOLS.length > 0) ok(`TOOLS 数组有 ${tools.TOOLS.length} 个工具`);
  else ng('TOOLS 数组缺失或为空');

  const execTool = tools.TOOLS.find(t => t.function?.name === 'exec_command');
  if (execTool) ok('exec_command 工具已定义');
  else ng('exec_command 缺失');

  // 2. schema 格式验证 (OpenAI function-calling)
  if (execTool.function.parameters?.properties?.command) ok('command 参数已定义');
  else ng('command 参数缺失');
  if (execTool.function.parameters?.required?.includes('command')) ok('command 为必需参数');
  else ng('command 未设为必需');

  // 3. isSafeCommand 白名单
  const safeCmds = ['ls', 'ls -la', 'echo hello', 'node --version', 'npm --version', 'git status', 'pwd', 'whoami', 'date', 'dir', 'type nul'];
  for (const cmd of safeCmds) {
    if (tools.isSafeCommand(cmd)) ok(`安全命令通过: ${cmd}`);
    else ng(`安全命令被拒: ${cmd}`);
  }

  // 4. isSafeCommand 黑名单
  const unsafeCmds = ['rm -rf /', 'sudo rm', 'del /f *.*', 'shutdown /s', 'reboot', 'mv file1 file2', 'cp file1 file2', 'chmod +x file'];
  for (const cmd of unsafeCmds) {
    if (!tools.isSafeCommand(cmd)) ok(`危险命令被拒: ${cmd.substring(0, 20)}`);
    else ng(`危险命令漏过: ${cmd.substring(0, 20)}`);
  }

  // 5. execCommand 安全执行
  try {
    const r1 = tools.execCommand('echo hello');
    if (r1.stdout === 'hello') ok('echo hello → stdout=hello');
    else ng(`echo hello → stdout="${r1.stdout}"`);
  } catch (e) {
    ng('echo hello 执行失败', e);
  }

  try {
    const r2 = tools.execCommand('node --version');
    if (r2.stdout && r2.exitCode === 0) ok(`node --version → ${r2.stdout}`);
    else ng(`node --version → stdout="${r2.stdout}" code=${r2.exitCode}`);
  } catch (e) {
    ng('node --version 执行失败', e);
  }

  // 6. execCommand 拒绝危险命令
  try {
    tools.execCommand('rm -rf /');
    ng('rm -rf / 应该被拒绝但没拒绝');
  } catch (e) {
    ok(`危险命令被拒绝: ${e.message.substring(0, 60)}`);
  }

  // 7. executeTool 路由
  try {
    const res = tools.executeTool('exec_command', { command: 'echo hi' });
    const parsed = JSON.parse(res);
    if (parsed.stdout === 'hi') ok('executeTool 路由正确');
    else ng(`executeTool 返回: ${res}`);
  } catch (e) {
    ng('executeTool 失败', e);
  }

  try {
    tools.executeTool('unknown_tool', {});
    ng('未知工具应该抛异常');
  } catch (e) {
    ok('未知工具被拒绝');
  }

  // 8. 验证 processText 已集成 tools 支持
  try {
    const agent = await import('../../../apps/bridge/skeleton-agent.mjs');
    ok('skeleton-agent 可加载');
    const src = await import('fs/promises').then(fs => fs.readFile('../apps/bridge/skeleton-agent.mjs', 'utf8'));
    if (src.includes('TOOLS') && src.includes('executeTool')) ok('processText 已集成工具循环');
    else ng('工具循环未集成');
    if (src.includes('MAX_TOOL_LOOP')) ok('工具循环有上限');
    else ng('工具循环无上限');
  } catch (e) {
    ng('skeleton-agent 验证失败', e);
  }

  report(NAME);
}

testSystemExec().catch(e => { ng('System-Exec 实验异常', e); report(NAME); });
