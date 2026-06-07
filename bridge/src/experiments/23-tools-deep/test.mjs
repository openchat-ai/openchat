import assert from 'assert';
import { gitBranch, langASTParse } from '../../tools/tools-deep.mjs';

const branch = gitBranch();
assert.ok(branch.current, 'should have current branch');
console.log('✓ tools-deep: gitBranch ok -', branch.current);

const jsAst = langASTParse('js', 'function hello() { return 1; }');
assert.ok(jsAst.parsed);
assert.equal(jsAst.topLevel[0].name, 'hello');
console.log('✓ tools-deep: JS AST ok');

const pyInfo = langASTParse('py', 'def hello(): pass\nclass Foo: pass');
assert.equal(pyInfo.functions[0].name, 'hello');
assert.equal(pyInfo.classes[0].name, 'Foo');
console.log('✓ tools-deep: Python regex ok');

const rsInfo = langASTParse('rs', 'fn hello() {}\nstruct Foo {}');
assert.equal(rsInfo.functions[0].name, 'hello');
assert.equal(rsInfo.structs[0].name, 'Foo');
console.log('✓ tools-deep: Rust regex ok');
