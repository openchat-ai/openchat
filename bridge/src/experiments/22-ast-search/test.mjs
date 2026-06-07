import assert from 'assert';
import { buildIndex, findRefs, renameSymbol } from '../../tools/ast-search.mjs';

const code = `
import { foo } from './bar';
function greet(name) { return 'hello ' + name; }
const x = 42;
class User {}
export default greet;
`;

const idx = buildIndex(code, 'test.js');
assert.equal(idx.symbolCount, 3, 'should find 3 symbols (greet, x, User)');
console.log('✓ ast-search: buildIndex ok');

const symNames = idx.symbols.map(s => s.name).sort();
assert.deepStrictEqual(symNames, ['User', 'greet', 'x']);
console.log('✓ ast-search: symbols ok');
