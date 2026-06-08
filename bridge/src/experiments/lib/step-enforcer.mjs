// StepEnforcer — 步骤前提检查
// 记录已完成的步骤，检查下一步所需的前提是否已满足
// === invariants ===
// - 只检查已注册的前提，未知步骤不报错
// - registerCompleted() 后不可撤销
// - reset() 清空所有状态

export function createStepEnforcer() {
  const completed = new Set();
  const preconditions = new Map(); // stepName → string[] (前提步骤)

  return {
    // 定义步骤依赖: stepName 依赖于 prereqs
    define(stepName, prereqs = []) {
      preconditions.set(stepName, prereqs);
      return this;
    },

    // 批量定义
    defineAll(map) {
      for (const [step, prereqs] of Object.entries(map)) {
        preconditions.set(step, prereqs);
      }
      return this;
    },

    // 标记步骤已完成
    complete(stepName) {
      completed.add(stepName);
      return this;
    },

    // 检查前提是否满足
    // 返回 { ok, missing[] }
    check(stepName) {
      const prereqs = preconditions.get(stepName) || [];
      const missing = prereqs.filter(p => !completed.has(p));
      return { ok: missing.length === 0, missing };
    },

    // 是否已完成
    isComplete(stepName) {
      return completed.has(stepName);
    },

    getCompleted() {
      return [...completed];
    },

    reset() {
      completed.clear();
    },

    list() {
      return Array.from(preconditions.entries()).map(([step, prereqs]) => ({ step, prereqs }));
    },
  };
}
