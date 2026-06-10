// Experiment 1: persistent-config (OpenChat 配置管理)
// Manifest id: config
// I/O: {} → { config, provider, model, paths }

import { create } from './lib/report.mjs';

export const META = { id: 'config' };

// compose 契约入口：返回当前配置
export async function run() {
  const mod = await import('../../src/core/persistent-config.js');
  const cfg = mod.persistentConfig?.config || {};
  return {
    outputs: {
      config: cfg,
      provider: cfg.current?.provider || '',
      model: cfg.current?.model || '',
      paths: Object.fromEntries(
        ['USER_DIR', 'PROJECT_DIR', 'SESSIONS_DIR', 'MEMORY_DIR', 'LOGS_DIR', 'HOUSES_DIR', 'SKILLS_DIR']
          .filter(k => mod[k]).map(k => [k, mod[k]]),
      ),
    },
  };
}

const { ok, ng, skip, report } = create();
const NAME = 'Config — persistent-config 加载';

async function test() {
  let mod;
  try {
    mod = await import('../../src/core/persistent-config.js');
    ok('persistent-config.js 可加载');
  } catch (e) {
    ng('persistent-config 加载失败', e);
    return report(NAME);
  }

  if (mod.persistentConfig) ok('persistentConfig 单例存在');
  else ng('persistentConfig 单例缺失');

  if (mod.default) ok('default 导出存在');
  else ng('default 导出缺失');

  // 路径常量
  for (const k of ['USER_DIR', 'PROJECT_DIR', 'SESSIONS_DIR', 'MEMORY_DIR', 'LOGS_DIR', 'HOUSES_DIR', 'SKILLS_DIR']) {
    if (typeof mod[k] === 'string' && mod[k].length > 0) ok(`路径常量 ${k} = ${mod[k]}`);
    else ng(`路径常量 ${k} 缺失`);
  }

  // .config 字段 (config.json 解析结果)
  try {
    const cfg = mod.persistentConfig.config || {};
    ok(`config.providers 类型: ${typeof cfg.providers}`);
    if (cfg.current) ok(`config.current.provider = ${cfg.current.provider || '(unset)'}`);
    else ok('config.current 未设置 (无 provider)');
  } catch (e) {
    skip(`config 读取跳过: ${e.message}`);
  }

  report(NAME);
}

export { test };
