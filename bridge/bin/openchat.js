#!/usr/bin/env node

import { autoDetect } from '../src/cli/auto-detect.js';
import { startBridge } from '../src/main.js';

// 解析命令行参数
const args = process.argv.slice(2);
const isInteractive = args.includes('--cli') || args.includes('-i');

process.stdout.write('\n🔍 Detecting local AI tools...\n');

const detected = await autoDetect();

if (detected.length > 0) {
  console.log('');
  console.log('✅ Detected local AI tools:');
  detected.forEach(tool => {
    console.log(`   • ${tool.name} (${tool.type}) - ${tool.command}`);
  });
  console.log('');
  console.log('These providers have been pre-configured.');
  console.log('Use "provider list" to see all configured providers.');
  console.log('');
} else {
  console.log('');
  console.log('⚠️  No local AI tools detected.');
  console.log('Install Claude Code, OpenCode, or OpenX to use local AI.');
  console.log('');
}

await new Promise(resolve => setTimeout(resolve, 100));

// 传递 headless 选项
await startBridge(detected, { headless: !isInteractive });
