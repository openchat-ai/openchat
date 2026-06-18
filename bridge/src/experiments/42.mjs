// Experiment 42: Project DNA - 极速项目理解法
//
// Auto-created by lab

import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export const META = { id: 'project-dna' };

const NAME = 'Project DNA - 极速项目理解法';

const BRIDGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PROJECTS = [
  { name: 'bridge-core', root: BRIDGE_ROOT, scanDir: 'src', langs: ['js'], excludeDirs: ['experiments', 'lab'] },
  { name: 'experiments', root: BRIDGE_ROOT, scanDir: 'src/experiments', langs: ['js'] },
  { name: 'lab', root: BRIDGE_ROOT, scanDir: 'src/lab', langs: ['js'] },
  { name: 'openchat-flutter', root: resolve(BRIDGE_ROOT, '../openchat-flutter'), scanDir: 'lib', langs: ['dart'] },
  { name: 'provider-kit', root: resolve(BRIDGE_ROOT, '../modules/provider-kit'), scanDir: '.', langs: ['js'] },
  { name: 'fairy-guardian', root: resolve(BRIDGE_ROOT, '../modules/fairy-guardian'), scanDir: '.', langs: ['js'] },
];

export async function run({ inputs = {} } = {}) {
  try {
    await getDNAContext();
    await generateDNA();
    await extractInvariants();
    await buildDependencyGraph();
    await writeDNAFile();
    const ans = await answerFromDNA('how many modules');
    return { outputs: { info: `DNA generated: ${ans.answer}` } };
  } catch (e) { return { ok: false, info: `run() failed: ${e.message}` }; }

}

export async function test() {
  try {
    await getDNAContext();
    await buildDependencyGraph();
    await extractInvariants();
    await generateDNA();
    await writeDNAFile();
    const dna = JSON.parse((await import('fs')).readFileSync((await import('path')).join(fileURLToPath(new URL('.', import.meta.url)), '../..', '.dna', 'project-dna.json'), 'utf8'));
    return { ok: true, info: `DNA: ${dna.totalModules} modules, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps. Ask answerFromDNA(question) for details.` };
  } catch (e) { return { ok: false, info: `DNA test failed: ${e.message}` }; }
}

function hashlineHash(line) {
  return createHash('md5').update(line).digest('hex').substring(0, 8);
}

function extractExports(content, relPath) {
  const exports = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/);
    if (m) exports.push({ name: m[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
  }
  return exports;
}

function extractDartExports(content, relPath) {
  const exports = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:abstract\s+)?(?:class|mixin|enum|extension\s+\w+(?:\s+on)?|typedef)\s+(\w+)/);
    if (m) exports.push({ name: m[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
    const m2 = lines[i].match(/^\s*(?:const|final|var|Function)\s+(\w+)\s*=/);
    if (m2) exports.push({ name: m2[1], line: i + 1, hash: hashlineHash(lines[i]), file: relPath });
  }
  return exports;
}

const EXT_MAP = { js: ['.mjs', '.js'], dart: ['.dart'] };
const EX_FN_MAP = { js: extractExports, dart: extractDartExports };

export async function scanProject(project) {
  const validExts = project.langs.flatMap(l => EXT_MAP[l] || []);
  const exclude = new Set(project.excludeDirs || []);
  const modules = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build' || e.name === '.dart_tool') continue;
        if (e.isDirectory() && exclude.has(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (validExts.some(ext => e.name.endsWith(ext))) {
          const rel = p.replace(project.root, '').replace(/\\/g, '/');
          const content = readFileSync(p, 'utf8');
          let allExports = [];
          for (const l of project.langs) allExports.push(...EX_FN_MAP[l](content, rel));
          modules.push({ path: rel, size: statSync(p).size, exports: allExports });
        }
      }
    } catch {}
  }
  const scanPath = resolve(project.root, project.scanDir);
  if (existsSync(scanPath)) walk(scanPath, 0);
  const totalExports = modules.reduce((s, m) => s + m.exports.length, 0);
  return { project: project.name, totalModules: modules.length, totalExports, modules, scannedAt: Date.now() };
}

export async function generateDNA() {
  return scanProject(PROJECTS[0]);
}

export async function generateMultiProjectDNA() {
  const results = await Promise.all(PROJECTS.map(scanProject));
  const allModules = [];
  let totalExports = 0;
  for (const r of results) {
    for (const m of r.modules) m.project = r.project;
    allModules.push(...r.modules);
    totalExports += r.totalExports;
  }
  return {
    projects: PROJECTS.map(p => p.name),
    totalModules: allModules.length,
    totalExports,
    modules: allModules,
    scannedAt: Date.now(),
  };
}

export async function extractInvariants() {
  const { readFileSync, readdirSync, statSync } = await import('fs');
  const { join, resolve } = await import('path');
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const invs = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) {
          const c = readFileSync(p, 'utf8');
          const start = c.indexOf('// === invariants ===');
          if (start !== -1) {
            const end = c.indexOf('// ===', start + 20);
            const block = c.slice(start, end !== -1 ? end : c.length).split('\n').filter(l => l.trim()).slice(0, 20);
            invs.push({ file: p.replace(root, '').replace(/\\/g, '/'), block });
          }
        }
      }
    } catch {}
  }
  walk(resolve(root, 'src'), 0);
  return { totalInvariantBlocks: invs.length, invariants: invs };
}

export async function buildDependencyGraph() {
  const { readFileSync, readdirSync, statSync } = await import('fs');
  const { join, resolve } = await import('path');
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const nodes = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) {
          const c = readFileSync(p, 'utf8');
          const imports = [...c.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
          nodes.push({ file: p.replace(root, '').replace(/\\/g, '/'), imports });
        }
      }
    } catch {}
  }
  walk(resolve(root, 'src'), 0);
  return { nodes, totalFiles: nodes.length };
}

export async function writeDNAFile() {
  const dna = await generateMultiProjectDNA();
  const inv = await extractInvariants();
  const dep = await buildDependencyGraph();
  const report = { projects: dna.projects, scannedAt: dna.scannedAt, modules: dna.modules, totalModules: dna.totalModules, totalExports: dna.totalExports, invariants: inv.invariants, totalInvariantBlocks: inv.totalInvariantBlocks, deps: dep.nodes, totalDepFiles: dep.totalFiles };
  const outDir = join(BRIDGE_ROOT, '.dna');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'project-dna.json'), JSON.stringify(report, null, 2), 'utf8');
  return { ok: true, path: join(outDir, 'project-dna.json') };
}

export async function getDNAContext({ maxAgeMs = 300000 } = {}) {
  const dnaPath = join(BRIDGE_ROOT, '.dna', 'project-dna.json');
  if (!existsSync(dnaPath)) {
    await writeDNAFile();
  } else {
    try {
      const cur = JSON.parse(readFileSync(dnaPath, 'utf8'));
      if (Date.now() - (cur.scannedAt || 0) > maxAgeMs) await writeDNAFile();
    } catch { await writeDNAFile(); }
  }
  try {
    const dna = JSON.parse(readFileSync(dnaPath, 'utf8'));
    const projects = dna.projects?.join('/') || 'bridge-core';
    const topMods = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 10);
    return `[Project DNA] ${dna.totalModules} modules in ${projects}, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants` +
      `. Top: ${topMods.map(m => `[${m.project||'bridge'}]${m.path.replace(/^\/(?:src\/|lib\/)/, '')}(${m.exports.length})`).join(', ')}` +
      `. Use dna_query to find any export by name/hash.`;
  } catch { return ''; }
}

export async function answerFromDNA(question, { maxAgeMs = 300000 } = {}) {
  const dnaPath = join(BRIDGE_ROOT, '.dna', 'project-dna.json');
  if (!existsSync(dnaPath)) {
    await writeDNAFile();
  } else {
    try {
      const cur = JSON.parse(readFileSync(dnaPath, 'utf8'));
      if (Date.now() - (cur.scannedAt || 0) > maxAgeMs) await writeDNAFile();
    } catch { await writeDNAFile(); }
  }
  const dna = JSON.parse(readFileSync(dnaPath, 'utf8'));
  if (!question) return { answer: `DNA: ${dna.totalModules} modules across ${(dna.projects||['bridge']).join(', ')}, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps` };
  const q = question.toLowerCase();

  // 按项目过滤
  const projMatch = q.match(/project\s+(\S+)/);
  let scopeMods = dna.modules;
  if (projMatch) scopeMods = dna.modules.filter(m => (m.project || 'bridge') === projMatch[1]);

  // 按函数名查找 — 返回文件 + 行号 + hashline hash
  const fnMatch = q.match(/find\s+(?:function\s+)?(\w+)/);
  if (fnMatch) {
    const name = fnMatch[1];
    for (const mod of scopeMods) {
      for (const ex of mod.exports) {
        if (ex.name.toLowerCase() === name) return { answer: `[${mod.project||'bridge'}] function ${ex.name} in ${ex.file}:${ex.line}, hashline: ${ex.hash}` };
      }
    }
    return { answer: `function ${name} not found in DNA` };
  }

  // 按 hashline hash 查找 — 返回文件 + 行
  const hashMatch = q.match(/hash\s+([0-9a-f]{8})/);
  if (hashMatch) {
    const h = hashMatch[1];
    for (const mod of scopeMods) {
      for (const ex of mod.exports) {
        if (ex.hash === h) return { answer: `[${mod.project||'bridge'}] hash ${h} → ${ex.file}:${ex.line}, function ${ex.name}` };
      }
    }
    return { answer: `hash ${h} not found in DNA` };
  }

  // 列出模块的 exports
  const lsMatch = q.match(/ls\s+(\S+)/);
  if (lsMatch) {
    const file = lsMatch[1];
    const mod = dna.modules.find(m => m.path.endsWith(file) || m.path === file);
    if (!mod) return { answer: `file ${file} not found in DNA` };
    return { answer: `[${mod.project||'bridge'}] ${mod.path}: ${mod.exports.map(e => `${e.name}:${e.line} hash=${e.hash}`).join(', ')}` };
  }

  if (/^summary$/i.test(q)) {
    const byProj = {};
    for (const m of dna.modules) {
      const p = m.project || 'bridge';
      if (!byProj[p]) byProj[p] = { modules: 0, exports: 0 };
      byProj[p].modules++;
      byProj[p].exports += m.exports?.length || 0;
    }
    const projLine = Object.entries(byProj).map(([p, c]) => `${p}:${c.modules}m/${c.exports}e`).join(', ');
    const top = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 15);
    return { answer: `${dna.totalModules} modules, ${dna.totalExports} exports.\n${projLine}\nTop:\n${top.map(m => `[${m.project||'bridge'}] ${m.path} (${m.exports.length})`).join('\n')}` };
  }
  if (/^hot$/i.test(q)) {
    const ranked = dna.modules.filter(m => m.exports?.length > 0).sort((a, b) => (b.exports?.length || 0) - (a.exports?.length || 0)).slice(0, 30);
    return { answer: `Modules ranked by export count:\n${ranked.map((m, i) => `${i+1}. [${m.project||'bridge'}] ${m.path} (${m.exports.length})`).join('\n')}` };
  }
  const catMatch = q.match(/^cat\s+(\S+)/);
  if (catMatch) {
    const cat = catMatch[1];
    const matched = dna.modules.filter(m => m.path.includes(cat)).slice(0, 20);
    return { answer: matched.length ? `${cat}: ${matched.length} modules\n${matched.map(m => `[${m.project||'bridge'}] ${m.path} (${m.exports?.length || 0} exports)`).join('\n')}` : `No modules matching "${cat}"` };
  }
  if (/^isolate\b/.test(q)) {
    const { sep, relative } = await import('path');
    const root = BRIDGE_ROOT;
    const ZONE_MAP = [
      { prefix: '/modules/provider-kit/', name: 'kit', layer: 0 },
      { prefix: '/src/core/', name: 'core', layer: 0 },
      { prefix: '/src/plugins/', name: 'plugins', layer: 1 },
      { prefix: '/src/tools/', name: 'tools', layer: 1 },
      { prefix: '/src/p2p/', name: 'p2p', layer: 1 },
      { prefix: '/src/api/', name: 'api', layer: 2 },
      { prefix: '/src/cli/', name: 'cli', layer: 2 },
      { prefix: '/src/infra/', name: 'infra', layer: 2 },
    ];
    function zoneOf(path) {
      const n = path.replace(/\\/g, '/');
      for (const z of ZONE_MAP) if (n.startsWith(z.prefix)) return z;
      return { name: 'other', layer: 9 };
    }
    function attr(z) { return typeof z === 'object' ? z : { name: z, layer: 9 }; }

    const violations = [];
    for (const node of dna.deps) {
      const s = zoneOf(node.file);
      if (s.name === 'other' || s.name === 'kit') continue;
      const srcDir = resolve(root, '.' + node.file, '..').replace(/\\/g, '/');
      for (const imp of node.imports) {
        if (!imp.startsWith('.') || imp.startsWith('/')) continue;
        const resolved = resolve(srcDir, imp).replace(/\\/g, '/');
        const relPath = '/' + relative(root, resolved).replace(/\\/g, '/');
        const t = zoneOf(relPath);
        if (t.name !== 'other' && t.name !== s.name && s.layer < t.layer) {
          violations.push({ from: node.file, to: relPath, srcZone: s.name, tgtZone: t.name, spec: imp });
        }
      }
    }

    // 跨项目边界：外部项目 (kit/flutter/guardian) 引用 bridge-core 内部路径
    const KNOWN_PROJECT_DIRS = [
      { name: 'provider-kit', dir: resolve(root, '../modules/provider-kit') },
      { name: 'openchat-flutter', dir: resolve(root, '../openchat-flutter') },
      { name: 'fairy-guardian', dir: resolve(root, '../modules/fairy-guardian') },
    ];
    const BRIDGE_SRC = resolve(root, 'src').replace(/\\/g, '/');
    for (const proj of KNOWN_PROJECT_DIRS) {
      if (!existsSync(proj.dir)) continue;
      const refs = [];
      (function walkP(dir, depth) {
        if (depth > 5) return;
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const p = join(dir, e.name);
            if (e.isDirectory()) walkP(p, depth + 1);
            else if (e.name.endsWith('.mjs') || e.name.endsWith('.js') || e.name.endsWith('.dart')) {
              const c = readFileSync(p, 'utf8');
              const imps = [...c.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
              for (const imp of imps) {
                const res = resolve(dir, imp).replace(/\\/g, '/');
                if (res.startsWith(BRIDGE_SRC)) {
                  const rel = '/' + relative(root, res).replace(/\\/g, '/');
                  const frel = p.replace(root, '').replace(/\\/g, '/');
                  violations.push({ from: frel, to: rel, srcZone: proj.name, tgtZone: zoneOf(rel), spec: imp, cross: true });
                }
              }
            }
          }
        } catch {}
      })(proj.dir, 0);
    }

    if (violations.length === 0) return { answer: 'All zones isolated, no boundary violations.' };

    // Group by source zone
    const grouped = {};
    for (const v of violations) {
      const key = v.srcZone + ' → ' + v.tgtZone;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(v);
    }
    const lines = [violations.length + ' boundary violations:'];
    for (const [key, list] of Object.entries(grouped)) {
      lines.push('  ' + key + ' (' + list.length + '):');
      for (const v of list) lines.push('    ' + v.from + ' imports ' + v.spec);
    }
    return { answer: lines.join('\n') };
  }
  if (/project\s+\S+/.test(q)) { // single project mode
    const pName = q.match(/project\s+(\S+)/)?.[1];
    if (pName) {
      const mods = dna.modules.filter(m => (m.project || 'bridge') === pName);
      return { answer: `${pName}: ${mods.length} modules, ${mods.reduce((s,m) => s + (m.exports?.length||0), 0)} exports` };
    }
  }
  if (/total modules|file count|how many/.test(q)) return { answer: `${dna.totalModules} modules across ${(dna.projects||['bridge']).join(', ')}` };
  if (/invariant|constraint/.test(q)) return { answer: `${dna.totalInvariantBlocks} invariant blocks across project` };
  if (/dependency|import/.test(q)) return { answer: `${dna.totalDepFiles} files with import dependencies tracked` };
  return { answer: `DNA contains ${dna.totalModules} modules, ${dna.totalExports} exports, ${dna.totalInvariantBlocks} invariants, ${dna.totalDepFiles} deps across ${(dna.projects||['bridge']).length} project(s). Try: "find function X", "ls path/to/file", "hash XXXXXXXX", "summary", "hot", "cat prefix", "isolate", "project X"` };
}