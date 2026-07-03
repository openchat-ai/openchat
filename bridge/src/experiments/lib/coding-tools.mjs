// coding-tools.mjs — 编程工具门面（restored after refactor）。
// 历史上 coding-tools.mjs 在重构中被删，导致 experiment_09 (coding) 的 run/test 因
// `import('./lib/coding-tools.mjs')` 失败而崩。工具实现现已统一落在 coding-lib.mjs，
// 本文件作为稳定门面 re-export 全部工具（TOOLS / executeTool / readFile / writeFile /
// editFile / hashEdit / snapshot / restore / grepSearch / multiEdit / astEdit ...）。
// 保持单一实现源（coding-lib.mjs），避免历史上的手动同步漂移。
export * from './coding-lib.mjs';
