#!/usr/bin/env node
/**
 * OpenChat Quick Start — launches Bridge and opens Web UI
 *
 * Usage: node scripts/quickstart.mjs
 *
 * What it does:
 *   1. Checks if .env exists, if not creates from .env.example
 *   2. Runs npm install if needed
 *   3. Starts Bridge in headless mode
 *   4. Opens http://localhost:3800/live
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bridgeDir = join(root, 'bridge');
const envFile = join(bridgeDir, '.env');
const envExample = join(bridgeDir, '.env.example');

console.log('=== OpenChat Quick Start ===\n');

// Step 1: .env
if (!existsSync(envFile)) {
  if (existsSync(envExample)) {
    execSync(`copy "${envExample}" "${envFile}"`, { shell: true });
    console.log('[1/3] Created .env from .env.example');
    console.log('  -> Edit bridge/.env and add your LLM API keys');
  }
} else {
  console.log('[1/3] .env found');
}

// Step 2: npm install check
console.log('[2/3] Checking dependencies...');
if (!existsSync(join(bridgeDir, 'node_modules'))) {
  execSync('npm install', { cwd: bridgeDir, stdio: 'inherit' });
}
console.log('  -> Dependencies ready');

// Step 3: Start Bridge
console.log('[3/3] Starting Bridge...\n');
const bridge = spawn('node', ['src/main.js', '--headless', '--port=3800'], {
  cwd: bridgeDir,
  stdio: 'inherit',
  env: { ...process.env, DISABLE_API_AUTH: 'true' },
});

console.log('\n  Open http://localhost:3800/live to see AI residents\n');
console.log('  Press Ctrl+C to stop\n');

process.on('SIGINT', () => { bridge.kill(); process.exit(); });
process.on('SIGTERM', () => { bridge.kill(); process.exit(); });
