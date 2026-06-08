import { spawn } from 'child_process';
const proc = spawn('node', ['bin/openchat.js'], { cwd: import.meta.dirname, stdio: ['pipe', 'inherit', 'inherit'], shell: true });
setTimeout(() => { proc.stdin.write('给我看看当前项目干嘛的\n'); }, 15000);
setTimeout(() => { proc.stdin.write('exit\n'); }, 60000);
setTimeout(() => process.exit(0), 75000);
