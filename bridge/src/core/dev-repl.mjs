// dev-repl.mjs — re-export shell restored after refactor (commit d4f7369 + fc9539ff).
// The real implementation (src/experiments/lib/dev-repl.mjs) was merged away and not
// reintroduced. Until it is ported back, callers (e.g. bin/openchat.mjs, src/main.js)
// get a placeholder that throws with an actionable message — keeps module loading
// working and surfaces the missing feature at the first user attempt rather than at
// import time. Replace this stub with a real implementation when dev-repl is restored.
//
// Original import path expected by callers: '../src/core/dev-repl.mjs'

export async function startDevRepl(..._args) {
  throw new Error(
    'dev-repl: not yet restored after refactor (src/core/dev-repl.mjs).\n' +
    'Use `node src/main.js --cli` for the same interactive mode (also currently stubbed),\n' +
    'or restore src/experiments/lib/dev-repl.mjs and re-export it here.'
  );
}
