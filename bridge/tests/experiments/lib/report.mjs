const result = { pass: 0, fail: 0, skip: 0, details: [] };
export function ok(msg) { result.pass++; result.details.push(`  ✓ ${msg}`); }
export function ng(msg, err) { result.fail++; result.details.push(`  ✗ ${msg}${err ? ': ' + (err?.message || err) : ''}`); }
export function skip(msg) { result.skip++; result.details.push(`  - ${msg} (skip)`); }
export function report(name) {
  console.log(`\n╔══ ${'═'.repeat(name.length + 4)}╗`);
  console.log(`║    ${name}    ║`);
  console.log(`╚══ ${'═'.repeat(name.length + 4)}╝`);
  result.details.forEach(d => console.log(d));
  const total = result.pass + result.fail + result.skip;
  console.log(`\n${result.pass}/${total} passed, ${result.fail} failed, ${result.skip} skipped`);
  return result.fail === 0;
}
