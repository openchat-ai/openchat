// tui/render.mjs — 纯渲染函数（无副作用，返回字符串）
// === invariants ===
// - 所有函数纯：入参 → 字符串，不读文件不写终端
// - 颜色统一走 chalk；宽度按 process.stdout.columns 自适应，兜底 80
// - selectedIdx 越界由调用方保证；这里不做修改

import chalk from 'chalk';

const W = () => Math.min(process.stdout.columns || 80, 100);
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

const LEVEL_COLOR = {
  L4: chalk.magenta, 'L2+': chalk.cyan, 'L1.5': chalk.blue,
  L1: chalk.green, L0: chalk.gray, '—': chalk.dim,
};
const STATUS_ICON = {
  'closed-loop': chalk.green('●'), skeleton: chalk.yellow('○'),
  'reference-only': chalk.dim('◌'), paused: chalk.red('⏸'),
};

export function box(title, lines) {
  const w = W();
  const bar = '─'.repeat(w - 2);
  const out = [chalk.dim('┌' + bar + '┐')];
  out.push(chalk.dim('│ ') + chalk.bold(title.padEnd(w - 4)) + chalk.dim(' │'));
  out.push(chalk.dim('├' + bar + '┤'));
  for (const l of lines) out.push(chalk.dim('│ ') + clip(l, w - 4).padEnd(w - 4) + chalk.dim(' │'));
  out.push(chalk.dim('└' + bar + '┘'));
  return out.join('\n');
}

function clip(s, n) {
  const plain = s.replace(ANSI_RE, '');
  if (plain.length <= n) return s;
  return plain.slice(0, n - 1) + '…';
}

export function header() {
  return chalk.bold.cyan('  openchat Lab TUI ') +
    chalk.dim('— 实验室 · DNA · 智能分级   ') +
    chalk.dim('[↑↓ 选择  ⏎ 详情  a Agent  d DNA  r run-all  / 查询  q 退出]');
}

export function renderList(groups, flatSelected) {
  const lines = [];
  let idx = 0;
  for (const g of groups) {
    const c = LEVEL_COLOR[g.level] || chalk.white;
    lines.push('');
    lines.push(c.bold(`  ${g.level}`) + chalk.dim(`  (${g.items.length})`));
    for (const e of g.items) {
      const sel = idx === flatSelected;
      const icon = STATUS_ICON[e.status] || ' ';
      const line = `${icon} ${e.id.padEnd(20)} ${chalk.dim(e.name)}`;
      lines.push(sel ? chalk.bgBlue.white('▶ ' + stripPad(line)) : '  ' + line);
      idx++;
    }
  }
  return lines.join('\n');
}

function stripPad(s) { return s; }

export function renderDetail(e, dependents) {
  const c = LEVEL_COLOR[e.level] || chalk.white;
  return box(`实验 ${e.id} — ${e.name}`, [
    `${chalk.dim('智能分级')} ${c.bold(e.level)}    ${chalk.dim('状态')} ${e.status}    ${chalk.dim('纯函数')} ${e.pure}`,
    `${chalk.dim('分类')} ${e.category}    ${chalk.dim('文件')} ${e.file}`,
    `${chalk.dim('依赖')} ${e.deps.length ? e.deps.join(', ') : '(无)'}`,
    `${chalk.dim('被依赖')} ${dependents.length ? dependents.join(', ') : '(无)'}`,
    '',
    ...wrap(e.desc, W() - 4),
    '',
    chalk.dim('[t 跑 test   Esc 返回]'),
  ]);
}

export function renderPanel(title, text) {
  const lines = String(text).split('\n').flatMap((l) => wrap(l, W() - 4));
  return box(title, [...lines, '', chalk.dim('[Esc 返回]')]);
}

function wrap(s, n) {
  const words = String(s).split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
