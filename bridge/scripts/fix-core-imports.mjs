import fs from 'fs';
import path from 'path';

const remap = {
  'evolution-system.js': 'evolution/evolution-system.js',
  'evolution-engine.js': 'evolution/evolution-engine.js',
  'evolution-memory.js': 'evolution/evolution-memory.js',
  'evolution-cli.js': 'evolution/evolution-cli.js',
  'multi-model-tester.js': 'quality/multi-model-tester.js',
  'adversarial-test.js': 'quality/adversarial-test.js',
  'auto-restart-manager.js': 'monitoring/auto-restart-manager.js',
  'auto-rollback-manager.js': 'monitoring/auto-rollback-manager.js',
  'sandbox-manager.js': 'security/sandbox-manager.js',
  'test-orchestrator.js': 'quality/test-orchestrator.js',
  'intelligence-collector.js': 'memory/intelligence-collector.js',
  'monitor.js': 'monitoring/monitor.js',
  'resident-manager.js': 'agent/resident-manager.js',
  'vector-memory.js': 'memory/vector-memory.js',
  'quality-check-system.js': 'quality/quality-check-system.js',
  'ai-person-factory.js': 'agent/ai-person-factory.js',
  'ai-person-manager.js': 'agent/ai-person-manager.js',
  'ai-personhood.js': 'agent/ai-personhood.js',
  'identity-generator.js': 'agent/identity-generator.js',
  'deity-governance.js': 'agent/deity-governance.js',
  'deity-system.js': 'agent/deity-system.js',
  'energy-deity.js': 'agent/energy-deity.js',
  'mirror-deity.js': 'agent/mirror-deity.js',
  'resident-decisions.js': 'agent/resident-decisions.js',
  'body.js': 'agent/body.js',
  'memory-manager-enhanced.js': 'memory/memory-manager-enhanced.js',
  'neural-brain.js': 'memory/neural-brain.js',
  'neural-mesh.js': 'memory/neural-mesh.js',
  'semantic-nn.js': 'memory/semantic-nn.js',
  'subconscious.js': 'memory/subconscious.js',
  'teacher-llm.js': 'memory/teacher-llm.js',
  'knowledge-network.js': 'memory/knowledge-network.js',
  'generalization.js': 'memory/generalization.js',
  'collaboration-engine.js': 'collaboration/collaboration-engine.js',
  'collaboration-manager.js': 'collaboration/collaboration-manager.js',
  'community-manager.js': 'collaboration/community-manager.js',
  'multi-agent-coordinator.js': 'collaboration/multi-agent-coordinator.js',
  'social-connector.js': 'collaboration/social-connector.js',
  'task-orchestrator.js': 'collaboration/task-orchestrator.js',
  'task-planner.js': 'collaboration/task-planner.js',
  'convergence-engine.js': 'convergence/convergence-engine.js',
  'natural-language-parser.js': 'convergence/natural-language-parser.js',
  'reasoning-engine.js': 'convergence/reasoning-engine.js',
  'inductive-reasoner.js': 'convergence/inductive-reasoner.js',
  'problem-decomposer.js': 'convergence/problem-decomposer.js',
  'prompt-builder.js': 'convergence/prompt-builder.js',
  'question-normalizer.js': 'convergence/question-normalizer.js',
  'result-aggregator.js': 'convergence/result-aggregator.js',
  'solution-engine.js': 'convergence/solution-engine.js',
  'solution-optimizer.js': 'convergence/solution-optimizer.js',
  'symbolic-reasoner.js': 'convergence/symbolic-reasoner.js',
  'theorem-db.js': 'convergence/theorem-db.js',
  'thinking-path.js': 'convergence/thinking-path.js',
  'audio-pipeline.js': 'audio/audio-pipeline.js',
  'multimodal-handler.js': 'audio/multimodal-handler.js',
  'neural-audio-codec.js': 'audio/neural-audio-codec.js',
  'voice-gateway.js': 'audio/voice-gateway.js',
  'adaptive-audio-transport.js': 'audio/adaptive-audio-transport.js',
  'device-capability-manager.js': 'audio/device-capability-manager.js',
  'forge.js': 'evolution/forge.js',
  'self-evolution.js': 'evolution/self-evolution.js',
  'self-learner.js': 'evolution/self-learner.js',
  'skill-manager.js': 'evolution/skill-manager.js',
  'variant-generator.js': 'evolution/variant-generator.js',
  'learning-core.js': 'evolution/learning-core.js',
  'learning-loop.js': 'evolution/learning-loop.js',
  'experience-accumulator.js': 'evolution/experience-accumulator.js',
  'security-checker.js': 'security/security-checker.js',
  'safe-evolution.js': 'security/safe-evolution.js',
  'safe-exec.js': 'security/safe-exec.js',
  'streaming-validator.js': 'security/streaming-validator.js',
  'error-boundary.js': 'security/error-boundary.js',
  'error-classifier.js': 'security/error-classifier.js',
  'enhanced-stability-system.js': 'monitoring/enhanced-stability-system.js',
  'cost-monitor.js': 'monitoring/cost-monitor.js',
  'performance-monitor.js': 'monitoring/performance-monitor.js',
  'performance-scorer.js': 'monitoring/performance-scorer.js',
  'monitor-cli.js': 'monitoring/monitor-cli.js',
  'system-health-checker.js': 'monitoring/system-health-checker.js',
  'resilience.js': 'monitoring/resilience.js',
  'content-analyzer.js': 'quality/content-analyzer.js',
  'content-manager.js': 'quality/content-manager.js',
  'code-analyzer.js': 'quality/code-analyzer.js',
  'code-reviewer.js': 'quality/code-reviewer.js',
  'decision-engine.js': 'quality/decision-engine.js',
  'model-selector.js': 'quality/model-selector.js',
  'schema-manager.js': 'quality/schema-manager.js',
  'strategy-optimizer.js': 'quality/strategy-optimizer.js',
  'strategy-registry.js': 'quality/strategy-registry.js',
  'response-parser.js': 'quality/response-parser.js',
  'fairy-gossip.js': 'p2r/fairy-gossip.js',
  'fairy-guardian.js': 'p2r/fairy-guardian.js',
  'house.js': 'p2r/house.js',
  'launch-strategies.js': 'p2r/launch-strategies.js',
  'llm-proxy-agent.js': 'p2r/llm-proxy-agent.js',
  'bridge-spawn.js': 'p2r/bridge-spawn.js',
  'logger.js': 'monitoring/logger.js',
  'agent-monitor.js': 'agent/agent-monitor.js',
  'agent-communication-protocol.js': 'agent/agent-communication-protocol.js',
};

const testDir = 'src/core/__tests__';
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));

let totalFixes = 0;
for (const file of files) {
  const fp = path.join(testDir, file);
  let content = fs.readFileSync(fp, 'utf-8');
  let changed = false;
  for (const [oldName, newName] of Object.entries(remap)) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`from '\\.\\./${escaped}'`, 'g');
    if (regex.test(content)) {
      content = content.replace(regex, `from '../${newName}'`);
      changed = true;
      totalFixes++;
    }
  }
  if (changed) {
    fs.writeFileSync(fp, content, 'utf-8');
    console.log(`Fixed: ${file}`);
  }
}
console.log(`Total fixes: ${totalFixes}`);
