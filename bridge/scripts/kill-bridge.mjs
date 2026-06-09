// Kill bridge on port 3800 only
import { execSync } from 'child_process';

const PORT = process.argv[2] || 3800;
try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8', timeout: 3000 });
    const lines = out.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid)) {
        execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 });
        console.log(`[kill-bridge] Killed PID ${pid} on port ${PORT}`);
      }
    }
  } else {
    try { execSync(`lsof -ti:${PORT} | xargs kill -9`, { timeout: 3000 }); console.log(`[kill-bridge] Killed process on port ${PORT}`); } catch {}
  }
} catch (e) {
  if (!e.message?.includes('ENDTABLE')) console.log(`[kill-bridge] Port ${PORT} free`);
}
