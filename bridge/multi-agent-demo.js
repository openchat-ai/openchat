import { multiAgentCoordinator } from './src/core/multi-agent-coordinator.js';
import { sessionManager } from './src/session/session-manager.js';
import { persistentConfig } from './src/memory/persistent-config.js';

async function setupProviders() {
  console.log('=== Multi-Agent System Demo ===\n');

  const providers = persistentConfig.listProviders();
  if (providers.length === 0) {
    console.log('No providers configured. Adding local opencode provider...');
    try {
      const { createLocalProvider } = await import('./src/providers/local-provider.js');
      const provider = createLocalProvider('opencode', {
        mode: 'command',
        command: 'opencode',
        args: []
      });
      await provider.connect({ mode: 'command', command: 'opencode', args: [] });
      sessionManager.addProviderDirect(provider);
      console.log('✓ opencode provider added\n');
    } catch (e) {
      console.log(`✗ opencode not available: ${e.message}`);
      console.log('Using mock responses instead\n');
    }
  } else {
    console.log(`Found providers: ${providers.join(', ')}\n`);
    for (const p of providers) {
      try {
        const apiKey = persistentConfig.getApiKey(p);
        if (apiKey) {
          await sessionManager.addProvider(p, apiKey);
        }
      } catch (e) {
      }
    }
  }
}

async function demo1_spawnAgents() {
  console.log('--- Demo 1: Spawn Multiple Agents ---\n');

  const coder = await multiAgentCoordinator.spawnAgent('coder', {
    name: 'coder',
    provider: sessionManager.listProviders()[0]?.type || 'opencode',
    systemPrompt: 'You are a coding assistant. Write clean, efficient code.'
  });

  const reviewer = await multiAgentCoordinator.spawnAgent('reviewer', {
    name: 'reviewer',
    provider: sessionManager.listProviders()[0]?.type || 'opencode',
    systemPrompt: 'You are a code reviewer. Provide constructive feedback.'
  });

  const tester = await multiAgentCoordinator.spawnAgent('tester', {
    name: 'tester',
    provider: sessionManager.listProviders()[0]?.type || 'opencode',
    systemPrompt: 'You are a QA engineer. Write comprehensive tests.'
  });

  console.log(`Spawned ${multiAgentCoordinator.listAgents().length} agents:`);
  multiAgentCoordinator.listAgents().forEach(a => {
    console.log(`  - ${a.name} (${a.agentId.substring(0, 12)}...)`);
  });
  console.log('');

  return { coder, reviewer, tester };
}

async function demo2_agentCommunication(agents) {
  console.log('--- Demo 2: Agent-to-Agent Communication ---\n');

  const { coder, reviewer } = agents;

  console.log('[Coder] sending code review request to [Reviewer]...');
  coder.sendTo(reviewer.agentId, 'Please review this function:\n\nfunction add(a,b){return a+b}');

  await new Promise(r => setTimeout(r, 500));

  console.log('[Reviewer] delegating task back to [Coder]...');
  reviewer.delegateTo(coder.agentId, {
    type: 'write_file',
    path: './demo_output/reviewed.js',
    content: '// Reviewed and improved version\nfunction add(a, b) {\n  return Number(a) + Number(b);\n}\n'
  });

  await new Promise(r => setTimeout(r, 500));

  console.log('[Coder] broadcasting status update...');
  coder.broadcast({ status: 'task_completed', timestamp: Date.now() });

  console.log('');
}

async function demo3_parallelExecution() {
  console.log('--- Demo 3: Parallel Task Execution ---\n');

  const task = {
    description: '帮我分析并改进这个项目的代码质量',
    decompose: true,
    steps: ['代码审查', '性能分析', '编写测试', '生成报告']
  };

  console.log(`Task: ${task.description}`);
  console.log(`Steps: ${task.steps.join(' → ')}\n`);

  const result = await multiAgentCoordinator.parallelExecute(task, {
    maxAgents: 4,
    onProgress: (progress) => {
      if (progress.phase === 'executing') {
        if (progress.agent) {
          process.stdout.write(`[${progress.agent.substring(0, 8)}] `);
        }
        if (progress.task) {
          process.stdout.write(`${progress.task.substring(0, 30)}...\n`);
        }
      }
    }
  });

  console.log('\n--- Results ---');
  console.log(result.summary);
  console.log('');

  return result;
}

async function demo4_cleanup(agents) {
  console.log('--- Demo 4: Cleanup ---\n');

  for (const agentId of multiAgentCoordinator.listAgents().map(a => a.agentId)) {
    await multiAgentCoordinator.terminateAgent(agentId);
    console.log(`✓ Terminated agent`);
  }

  console.log(`\nActive agents: ${multiAgentCoordinator.listAgents().length}`);
}

async function main() {
  try {
    await setupProviders();

    const agents = await demo1_spawnAgents();

    await demo2_agentCommunication(agents);

    await demo3_parallelExecution();

    await demo4_cleanup(agents);

    console.log('\n=== Demo Complete ===');
    console.log('Multi-Agent System Features:');
    console.log('  ✓ Agent spawning with unique IDs');
    console.log('  ✓ Agent-to-agent messaging (sendTo)');
    console.log('  ✓ Task delegation (delegateTo)');
    console.log('  ✓ Broadcast communication');
    console.log('  ✓ Parallel task execution');
    console.log('  ✓ Result aggregation');
    console.log('  ✓ Agent termination and cleanup');
  } catch (error) {
    console.error('Demo error:', error.message);
  }

  process.exit(0);
}

main();