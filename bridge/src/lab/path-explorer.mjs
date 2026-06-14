// path-explorer.mjs — dep 图自动发现未测试的组合路径
// 遍历 manifest.json 中所有实验，计算 transitive dep 链，找出未被任何实验覆盖的依赖子集组合

// === invariants ===
// - 只读 manifest, 不修改
// - 新组合按 dep 链深度排序，最深的最先推荐
// - 已有覆盖的组合不出现在推荐中

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '../experiments/manifest.json');

function getManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

// 构建 dep → 实验 反向映射
function buildReverseDeps(experiments) {
  const rev = {}; // depId → [experimentId, ...]
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    if (!exp.deps || exp.deps.length === 0) continue;
    for (const dep of exp.deps) {
      if (!rev[dep]) rev[dep] = [];
      rev[dep].push(exp.id);
    }
  }
  return rev;
}

// 计算 transitive deps
function transitiveDeps(expId, experiments, visited = new Set()) {
  if (visited.has(expId)) return [];
  visited.add(expId);
  const exp = experiments.find(e => e.id === expId);
  if (!exp || !exp.deps) return [];
  const deps = [...exp.deps];
  for (const d of exp.deps) {
    deps.push(...transitiveDeps(d, experiments, visited));
  }
  return [...new Set(deps)];
}

// 找出组合实验中已覆盖的所有 dep 子集
function coveredSubsets(experiments) {
  const subsets = [];
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    if (!exp.deps || exp.deps.length < 2) continue;
    const set = new Set(exp.deps);
    // 如果有 >=2 个 dep, 记录这个子集
    subsets.push({ id: exp.id, deps: [...set].sort(), depth: set.size });
  }
  return subsets;
}

export function explore() {
  const manifest = getManifest();
  if (!manifest) return { ok: false, error: 'manifest.json not found' };

  const experiments = manifest.experiments || [];
  const closedLoop = experiments.filter(e => e.status === 'closed-loop');
  const rev = buildReverseDeps(experiments);

  // 对每个实验, 计算它的 transitive deps
  const pathData = closedLoop.map(exp => {
    const tDeps = transitiveDeps(exp.id, experiments);
    return {
      id: exp.id,
      name: exp.name,
      file: exp.file,
      deps: exp.deps || [],
      transitiveDeps: tDeps,
      depCount: (exp.deps || []).length,
      transitiveDepCount: tDeps.length,
      dependents: rev[exp.id] || [],
      intelligenceLevel: exp.intelligenceLevel,
    };
  });

  // 找"孤立"实验（无 dep 也无其他实验依赖它）
  const isolated = pathData.filter(e => e.depCount === 0 && e.dependents.length === 0);

  // 找未连接的依赖组合（两个实验有共同 dep 但从未被组合测试）
  const covered = coveredSubsets(experiments);
  const coveredKeys = new Set(covered.map(s => s.deps.join('+')));
  const uncoveredPairs = [];
  for (const exp of closedLoop) {
    if (!exp.deps || exp.deps.length < 2) continue;
    const deps = [...exp.deps].sort();
    for (let i = 0; i < deps.length; i++) {
      for (let j = i + 1; j < deps.length; j++) {
        const key = [deps[i], deps[j]].sort().join('+');
        if (!coveredKeys.has(key)) uncoveredPairs.push({ pair: [deps[i], deps[j]], key, source: exp.id });
      }
    }
  }

  // 推荐新组合
  const recommendations = [];
  for (const up of uncoveredPairs) {
    recommendations.push({
      type: 'uncovered-pair',
      deps: up.pair,
      sourceExp: up.source,
      suggestion: `Create composite experiment testing ${up.pair.join(' + ')} (referenced by ${up.source})`,
    });
  }

  // 推荐 transitive chain 组合
  const multiDep = pathData.filter(e => e.transitiveDepCount >= 3 && e.depCount >= 1);
  for (const exp of multiDep) {
    const topChain = exp.transitiveDeps.slice(0, 4);
    if (topChain.length >= 2) {
      recommendations.push({
        type: 'transitive-chain',
        deps: topChain,
        sourceExp: exp.id,
        suggestion: `Chain experiment for ${exp.id}: test transitive path ${topChain.join(' → ')}`,
      });
    }
  }

  return {
    ok: true,
    totalExperiments: closedLoop.length,
    isolated: isolated.map(e => ({ id: e.id, name: e.name, file: e.file })),
    recommendations: recommendations.slice(0, 20),
    uncoveredPairs: uncoveredPairs.length,
    stats: {
      maxDeps: Math.max(...pathData.map(e => e.transitiveDepCount), 0),
      avgDeps: +(pathData.reduce((s, e) => s + e.transitiveDepCount, 0) / pathData.length).toFixed(1),
    },
  };
}

export function formatExplorerText(result) {
  if (!result.ok) return `explore: ${result.error}`;
  let out = `🔍 Path Explorer\n`;
  out += `  ${result.totalExperiments} closed-loop experiments\n`;
  out += `  ${result.uncoveredPairs} uncovered dep pairs\n`;
  out += `  ${result.isolated.length} isolated (zero deps, zero dependents)\n`;
  out += `  Avg transitive depth: ${result.stats.avgDeps}\n`;
  if (result.isolated.length > 0) {
    out += `\n  🏝️ Isolated:\n`;
    for (const e of result.isolated) out += `    ${e.id}: ${e.name}\n`;
  }
  if (result.recommendations.length > 0) {
    out += `\n  💡 Recommendations:\n`;
    for (const r of result.recommendations) {
      out += `    • ${r.suggestion.slice(0, 90)}\n`;
    }
  }
  return out;
}

export const META = { id: 'path-explorer' };
