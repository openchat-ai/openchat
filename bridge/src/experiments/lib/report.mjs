// Per-experiment reporter — each `create()` returns a fresh state object
// so experiments don't accumulate details from previous files when run via run-all.
export function create() {
  const result = { pass: 0, fail: 0, skip: 0, details: [] };
  return {
    ok(msg)  { result.pass++;  result.details.push(`  ✓ ${msg}`); },
    ng(msg, err) { result.fail++; result.details.push(`  ✗ ${msg}${err ? ': ' + (err?.message || err) : ''}`); },
    skip(msg) { result.skip++; result.details.push(`  - ${msg} (skip)`); },
    report(name) {
      console.log(`\n╔══ ${'═'.repeat(name.length + 4)}╗`);
      console.log(`║    ${name}    ║`);
      console.log(`╚══ ${'═'.repeat(name.length + 4)}╝`);
      result.details.forEach(d => console.log(d));
      const total = result.pass + result.fail + result.skip;
      console.log(`\n${result.pass}/${total} passed, ${result.fail} failed, ${result.skip} skipped`);
      return result.fail === 0;
    },
  };
}

// Legacy default export (back-compat for older experiment files):
// each top-level call still gets a fresh internal state.
let _state = null;
function _get() {
  if (!_state) _state = create();
  return _state;
}
export const ok   = (msg)   => _get().ok(msg);
export const ng   = (msg, err) => _get().ng(msg, err);
export const skip = (msg)   => _get().skip(msg);
export function report(name) {
  const out = _get().report(name);
  _state = null; // reset for next experiment
  return out;
}
