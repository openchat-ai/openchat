#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(process.cwd());
const RED = '\x1b[31m'; const GREEN = '\x1b[32m'; const CYAN = '\x1b[36m'; const RESET = '\x1b[0m';
let ok = true;

function check(label, condition, hint) {
  if (condition) { console.log(`${GREEN}✓  ${label}${RESET}`); }
  else { console.log(`${RED}✖  ${label} — ${hint}${RESET}`); ok = false; }
}

const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf-8'));

const targets = [
  { pkgPath: 'bridge/package.json', name: 'provider-kit', lockKey: 'bridge/node_modules/provider-kit' },
  { pkgPath: 'bridge/package.json', name: 'fairy-guardian', lockKey: 'bridge/node_modules/fairy-guardian' },
];
console.log(`${CYAN}ℹ  检查从 npm registry 解析${RESET}\n`);

for (const { pkgPath, name, lockKey } of targets) {
  const pkg = JSON.parse(readFileSync(resolve(root, pkgPath), 'utf-8'));
  const depVer = pkg.dependencies?.[name];
  const entry = lock.packages?.[lockKey];
  if (!depVer) { console.log(`${CYAN}ℹ  跳过 ${name}（未在 ${pkgPath} dependencies 中）${RESET}`); continue; }
  console.log(`  ${name} (${pkgPath} → ${lockKey}): "${depVer}"`);
  check(`${name}: lock 有 entry`, !!entry, `lock 缺少 ${lockKey}`);
  if (entry) {
    check(`${name}: 不是本地 link`, !entry.link, 'link: true，仍指向本地路径');
    check(`${name}: 指向 npm registry`, entry.resolved?.startsWith('https://registry.npmjs.org/'), `resolved: ${entry.resolved}`);
    check(`${name}: 有 integrity`, !!entry.integrity, '缺少 integrity hash');
    check(`${name}: version 匹配`, entry.version && depVer.replace('^', '').replace('~', '').startsWith(entry.version), `lock version=${entry.version} 不在 ${depVer} 范围内`);
  }
}

if (!ok) { console.error(`\n${RED}✖  验证失败${RESET}`); process.exit(1); }
console.log(`\n${GREEN}✅  全部通过${RESET}`);
