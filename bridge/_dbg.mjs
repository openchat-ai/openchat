import { parseJS } from './src/experiments/lib/ast-search.mjs';
import { readFileSync } from 'fs';
const orig = readFileSync('src/experiments/07.mjs', 'utf8');
console.log('=== orig parsed?', !!parseJS(orig));
console.log('=== try acorn direct ===');
import * as acorn from 'acorn';
try {
  const a = acorn.parse(orig, { ecmaVersion: 2022, sourceType: 'module' });
  console.log('orig acorn parsed, body length:', a.body.length);
} catch (e) {
  console.log('orig acorn ERR:', e.message);
}
const appended = orig.replace(/\s*$/, '') + "\n\nexport async function test() { return { ok: true, info: 'skeleton test' }; }\n";
try {
  const a = acorn.parse(appended, { ecmaVersion: 2022, sourceType: 'module' });
  console.log('appended acorn parsed, body length:', a.body.length);
} catch (e) {
  console.log('appended acorn ERR:', e.message);
}


