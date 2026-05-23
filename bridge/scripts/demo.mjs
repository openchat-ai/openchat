import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = resolve(__dirname, '..');

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║                                                          ║');
console.log('║               OPENCHAT DEMO — SANDBOX MODE               ║');
console.log('║                                                          ║');
console.log('║   No LLM provider required. No network needed.           ║');
console.log('║   Chat with AI residents right away.                     ║');
console.log('║                                                          ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log('Starting Bridge in sandbox mode...');
console.log('');

const child = spawn(process.execPath, [
  'src/main.js',
  '--sandbox',
  '--cli',
], {
  cwd: bridgeRoot,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, NODE_ENV: 'development' },
});

child.on('error', (err) => {
  console.error('Failed to start Bridge:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`\n[Demo] Bridge exited (code ${code}).`);
  process.exit(code || 0);
});

// Forward stdin to child
process.stdin.pipe(child.stdin);

// Handle graceful shutdown
process.on('SIGINT', () => {
  child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
