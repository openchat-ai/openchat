// CLI output compressor — rtk-inspired token saving.
// === invariants ===
// - compressOutput(cmd, stdout, stderr) returns { stdout, stderr, meta }
// - MAX_DEFAULT_LINES: 50 lines, beyond that → truncate with head/tail
// - Known commands get specialized compression (git, ls, test runners, linters)
// - Error output is never compressed (except dedup)
// - Meta includes original/originalBytes/compressedBytes/ratio
// - Line dedup removes consecutive duplicate lines only

const MAX_DEFAULT_LINES = 50;
const MAX_LINE_LENGTH = 500;
const TAIL_LINES = 10;

export function compressOutput(cmd, stdout, stderr) {
  const origBytes = (stdout + stderr).length;
  const meta = { origBytes, compressedBytes: 0, ratio: 1, strategy: 'none' };

  // Error output: never truncate, just dedup
  const stderrClean = _dedupLines(stderr);

  const cmdBase = (cmd || '').trim().split(/\s+/)[0]?.toLowerCase();
  const strategy = _getStrategy(cmdBase, stdout);

  let stdoutClean = stdout;
  switch (strategy) {
    case 'git_status':
      stdoutClean = _compressGitStatus(stdout);
      break;
    case 'git_diff':
      stdoutClean = _compressGitDiff(stdout);
      break;
    case 'ls':
      stdoutClean = _compressLs(stdout);
      break;
    case 'test':
      stdoutClean = _compressTestOutput(stdout);
      break;
    case 'linter':
      stdoutClean = _compressLinter(stdout);
      break;
    case 'truncate':
      stdoutClean = _truncateOutput(stdout);
      break;
    default:
      stdoutClean = _dedupLines(stdout);
  }

  // Cap line length
  stdoutClean = _capLineLength(stdoutClean);
  const compressed = (stdoutClean + stderrClean).length;
  meta.compressedBytes = compressed;
  meta.ratio = origBytes > 0 ? +(compressed / origBytes).toFixed(3) : 1;
  meta.strategy = strategy;

  return { stdout: stdoutClean, stderr: stderrClean, meta };
}

function _getStrategy(cmd, stdout) {
  if (!stdout || stdout.length < 100) return 'none';
  if (cmd === 'git' && stdout.includes('diff --git')) return 'git_diff';
  if (cmd === 'git' && (stdout.includes('On branch') || stdout.includes('nothing to commit'))) return 'git_status';
  if (cmd === 'ls' || cmd === 'dir') return 'ls';
  if (/^(pytest|jest|vitest|mocha|ava)$/.test(cmd)) return 'test';
  if (/^(eslint|ruff|golangci-lint|tsc)$/.test(cmd)) return 'linter';
  const lines = stdout.split('\n');
  if (lines.length > MAX_DEFAULT_LINES) return 'truncate';
  return 'none';
}

function _compressGitStatus(out) {
  // Compact: remove "Changes not staged for commit:" style headers, keep file list
  const lines = out.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (t.endsWith(':') && !t.startsWith('\t')) return false;
    return true;
  });
  return lines.join('\n');
}

function _compressGitDiff(out) {
  // Keep: diff --git, ---/+++ headers, @@ hunks, actual changes
  // Drop: index lines, new file mode, etc.
  const lines = out.split('\n').filter(l => {
    if (l.startsWith('index ')) return false;
    if (l.startsWith('new file mode')) return false;
    if (l.startsWith('deleted file mode')) return false;
    if (l.startsWith('similarity index')) return false;
    if (l.startsWith('rename from')) return false;
    if (l.startsWith('rename to')) return false;
    return true;
  });
  return lines.join('\n');
}

function _compressLs(out) {
  // Keep only filenames, one per line; drop permissions/size/date
  const lines = out.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    // Mode line like "total 123"
    if (/^total\s+\d+$/.test(t)) return false;
    // Detailed listing (permissions start with - or d)
    if (/^[-dlpsbc][-rwxstL]{9}/.test(t)) return true; // keep
    return true;
  });
  return lines.join('\n');
}

function _compressTestOutput(out) {
  // Keep: FAIL/ERROR lines, summary line, drop PASS lines
  const lines = out.split('\n');
  const important = lines.filter(l => {
    const u = l.toUpperCase();
    if (u.includes('FAIL') || u.includes('ERROR') || u.includes('✗') || u.includes('×')) return true;
    if (u.includes('PASS') || u.includes('✓') || u.includes('√')) return false;
    if (u.includes('TESTS:') || u.includes('SUITE') || u.includes('TEST')) return true;
    return false;
  });
  if (important.length === 0) return _truncateOutput(out);
  return important.join('\n');
}

function _compressLinter(out) {
  // Group by rule (like rtk): drop per-file details, keep rule-level summary
  const lines = out.split('\n');
  const grouped = {};
  for (const l of lines) {
    // Match: "filename:line:col: warning/error rule-id message"
    const m = l.match(/(\S+\.\w+):(\d+):(\d+):\s+(warning|error)\s+(\S+)\s+(.*)/);
    if (m) {
      const rule = m[5];
      if (!grouped[rule]) grouped[rule] = { count: 0, files: new Set() };
      grouped[rule].count++;
      grouped[rule].files.add(m[1]);
    }
  }
  if (Object.keys(grouped).length === 0) return _truncateOutput(out);
  const result = Object.entries(grouped).map(([rule, info]) =>
    `${rule}: ${info.count} occurrences in ${info.files.size} files`
  );
  return result.join('\n');
}

function _truncateOutput(out) {
  const lines = out.split('\n');
  if (lines.length <= MAX_DEFAULT_LINES) return out;
  const head = lines.slice(0, MAX_DEFAULT_LINES - TAIL_LINES);
  const tail = lines.slice(-TAIL_LINES);
  return [...head, `... [${lines.length - MAX_DEFAULT_LINES} lines truncated]`, ...tail].join('\n');
}

function _dedupLines(out) {
  const lines = out.split('\n');
  const deduped = [];
  let last = '';
  for (const l of lines) {
    if (l !== last) deduped.push(l);
    last = l;
  }
  return deduped.join('\n');
}

function _capLineLength(out) {
  return out.split('\n').map(l => l.length > MAX_LINE_LENGTH ? l.substring(0, MAX_LINE_LENGTH) + '...' : l).join('\n');
}

export { compressOutput as default };
