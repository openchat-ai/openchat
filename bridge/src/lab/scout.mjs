import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { addGoal, listGoals, getNextPending, updateGoal } from './goal-queue.mjs';
import { addFinding } from './findings.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const LAB_DIR = join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'lab');
const PROJECTS_FILE = join(LAB_DIR, 'projects.json');
const CONCURRENCY = 3;
const MIN_PENDING = 10;

function log(msg) {
  console.log(`[scout] ${new Date().toISOString()} ${msg}`);
}

function readProjects() {
  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// === P5: Code review — file quality scan ===
function scanDir(dir, results = []) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) scanDir(full, results);
      else if (extname(e.name) === '.js' || extname(e.name) === '.mjs') results.push(full);
    }
  } catch {}
  return results;
}

function codeReviewP5(projectRoot, projectName) {
  const files = scanDir(join(projectRoot, 'src'));
  let goals = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const relPath = f.replace(projectRoot + '/', '');
      const lines = content.split('\n');
      if (lines.length > 200) {
        addGoal(`[code] ${relPath}: consider splitting for readability (${lines.length} lines)`, { priority: 5 });
        goals++;
      }
      if (/catch\s*\{[\s]*\}/.test(content)) {
        addGoal(`[code] ${relPath}: empty catch block`, { priority: 5 });
        goals++;
      }
      if (/console\.(log|warn)\(/.test(content)) {
        addGoal(`[code] ${relPath}: console.log left in production code`, { priority: 5 });
        goals++;
      }
      if (/(?:^|\n)\s*(let|var)\s+(?!for\s*\()/.test(content)) {
        addGoal(`[code] ${relPath}: uses var/let instead of const`, { priority: 5 });
        goals++;
      }
    } catch {}
  }
  if (goals > 0) addFinding(projectName, 'codesmell', `${goals} code issue(s) enqueued`);
  return goals;
}

// === P1: Critical / P2: Performance ===
function ensureQueueLevel(projectName, targetPending, priority, label) {
  const pending = listGoals({ pending: true }).length;
  if (pending >= targetPending) {
    log(`${label}: ${pending} pending, enough`);
    return true;
  }
  log(`${label}: ${pending} < ${targetPending}, entering next level`);
  return false;
}

// === P4: Major bumps ===
async function checkMajorBumps(projectRoot, projectName) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const { execSync } = await import('child_process');
    const out = execSync('npm outdated --json', { cwd: projectRoot, encoding: 'utf8', timeout: 15000 });
    const outdated = JSON.parse(out);
    let count = 0;
    for (const [name, info] of Object.entries(outdated)) {
      if (info.wanted && info.latest && info.wanted !== info.latest) {
        addGoal(`evaluate upgrading ${name}: ${info.current} → ${info.latest} (major bump)`, { priority: 4 });
        count++;
      }
    }
    if (count > 0) {
      addFinding(projectName, 'npm', `${count} major bump eval(s) enqueued`);
      log(`[${projectName}] major: ${count} major bump eval(s) enqueued`);
    }
  } catch {}
}

// === Main round ===
export async function runScoutRound() {
  // import guard: only run if called as main
  if (process.argv[1] && !process.argv[1].includes('scout')) return;

  const projects = readProjects();
  log(`started (pid=${process.pid}, projects=${Object.keys(projects).length})`);
  log('discover start');

  for (const [name, cfg] of Object.entries(projects)) {
    const root = cfg.path || cfg.root;
    if (!root || !existsSync(root)) continue;
    // P5: code review
    const p5Count = codeReviewP5(root, name);
    if (p5Count > 0) log(`[${name}] code review: ${p5Count} issue(s)`);
    // P4: major bumps
    await checkMajorBumps(root, name);
  }

  // Queue management
  if (!ensureQueueLevel('all', MIN_PENDING, 1, 'p1')) {
    if (!ensureQueueLevel('all', MIN_PENDING, 2, 'p2')) {
      log('p2: still low, entering p4');
    }
  }

  // Drain
  const pending = listGoals({ pending: true }).length;
  if (pending > 0) {
    const batch = Math.min(pending, CONCURRENCY);
    log(`cycle: ${pending} pending, draining (max ${CONCURRENCY})`);
    const { runNext } = await import('./runner.mjs');
    let ok = 0;
    for (let i = 0; i < batch; i++) {
      const r = await runNext();
      if (r?.ok) ok++;
    }
    log(`drain: ${ok}/${batch} ok`);
  } else {
    log('cycle: 0 pending, skip');
  }
}
