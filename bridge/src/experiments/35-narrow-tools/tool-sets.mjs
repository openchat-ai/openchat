// tool-sets.mjs — E35 的两个 tool 集合
//
// WIDE:   全部 40 个 tool (跟 E34 的 baseline 一致)
// NARROW: 只暴露与 10 个 prompt 相关的 10 个 tool
//
// 设计: 两个集合都包含正确答案, 区别只在"选择空间"大小
//   - WIDE 测: 模型从 40 个候选里选对 tool 的能力
//   - NARROW 测: 模型从 10 个候选里选对 tool 的能力

import { TOOLS as COMBINED_TOOLS } from '../../tools/coding-tools.mjs';

export const WIDE_TOOLS = COMBINED_TOOLS;

// 这 10 个 tool 是 10 个 prompt 的"正确答案"
// 故意覆盖 5 个不同类别 (file / search / ast / dev / git / mqtt)
const NARROW_NAMES = [
  'read_file',         // q1: file
  'grep',              // q2: search
  'ast_find_refs',     // q3: ast
  'dep_graph',         // q4: dev
  'git_commit',        // q5: git
  'lint_run',          // q6: dev
  'ast_rename',        // q7: ast
  'sql_parse',         // q8: dev
  'mqtt_connect',      // q9: mqtt
  'find_refs',         // q10: search
];

export const NARROW_TOOLS = COMBINED_TOOLS.filter((t) =>
  NARROW_NAMES.includes(t.function.name)
);

export const TOOL_SET_SIZE = {
  wide: WIDE_TOOLS.length,
  narrow: NARROW_TOOLS.length,
};

// 检查: NARROW 包含所有 10 个 prompt 期望的 tool
export function validateNarrow(prompts) {
  const missing = [];
  for (const p of prompts) {
    if (!NARROW_TOOLS.find((t) => t.function.name === p.expect.name)) {
      missing.push(p.expect.name);
    }
  }
  return { ok: missing.length === 0, missing };
}
