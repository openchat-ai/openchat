import { execSync } from 'child_process';

const REPO = 'https://github.com/openchat-ai/openchat.git';
const GITEE = 'https://gitee.com/openchat-ai/openchat.git';
const BRANCH = 'main';
const ROOT = new URL('../../', import.meta.url).pathname;

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 120000, ...opts });
    return { ok: true, out: out.toString().trim() };
  } catch (e) {
    return { ok: false, err: e.stderr?.toString()?.trim() || e.message };
  }
}

// === Strategy 1: HTTP/1.1 (most reliable behind GFW) ===
console.log('[push] trying: git -c http.version=HTTP/1.1 push');
let r = run(`git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin ${BRANCH} 2>&1`);
if (r.ok) { console.log('[push] OK (HTTP/1.1)'); process.exit(0); }

// === Strategy 2: HTTPS origin (token) ===
console.log('[push] trying: git push origin main (HTTPS)');
r = run(`git push origin ${BRANCH} 2>&1`);
if (r.ok) { console.log('[push] OK'); process.exit(0); }

// === Strategy 3: add gitee remote and push ===
console.log('[push] HTTPS failed, trying Gitee mirror...');
run(`git remote remove gitee 2>&1`, { stdio: 'pipe' });
r = run(`git remote add gitee ${GITEE} 2>&1`);
if (r.ok) {
  r = run(`git push gitee ${BRANCH} 2>&1`);
  if (r.ok) { console.log('[push] OK (Gitee)'); process.exit(0); }
  console.log('[push] Gitee failed:', r.err?.slice(0, 100));
}

// === Strategy 4: SSH ===
console.log('[push] trying SSH...');
r = run(`git remote set-url origin git@github.com:openchat-ai/openchat.git && git push origin ${BRANCH} 2>&1`);
if (r.ok) {
  console.log('[push] OK (SSH)');
  run(`git remote set-url origin ${REPO}`, { stdio: 'pipe' });
  process.exit(0);
}
run(`git remote set-url origin ${REPO}`, { stdio: 'pipe' });

console.error('[push] ALL STRATEGIES FAILED');
console.error('[push] To push manually via proxy:');
console.error('  git -c http.proxy=http://127.0.0.1:7890 push origin main');
console.error('  git push origin main  # from non-China network');
process.exit(1);
