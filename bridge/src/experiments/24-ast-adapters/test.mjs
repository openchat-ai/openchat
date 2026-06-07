import { parseDart, parseJS, parsePython, parseRust, parseGo, parseFile } from '../../tools/ast-adapters.mjs';

// Dart
const dart = parseDart('class Foo extends Bar { int x = 1; Widget build(BuildContext c) { return Text(""); } }');
console.assert(dart.parsed, 'dart parsed');
console.assert(dart.symbols.some(s => s.kind === 'class' && s.name === 'Foo'), 'dart class Foo');
console.assert(dart.symbols.some(s => s.kind === 'flutter-build'), 'dart flutter build');
console.log('✓ ast-adapters: Dart');

// JS
const js = parseJS('import { x } from "y"; function hi() {}');
console.assert(js.symbols.some(s => s.kind === 'function' && s.name === 'hi'), 'js function');
console.assert(js.symbols.some(s => s.kind === 'import' && s.name === 'x'), 'js import');
console.log('✓ ast-adapters: JS');

// Python
const py = parsePython('class A: pass\ndef f(x): return x');
console.assert(py.symbols.some(s => s.kind === 'class' && s.name === 'A'), 'py class');
console.assert(py.symbols.some(s => s.kind === 'function' && s.name === 'f'), 'py function');
console.log('✓ ast-adapters: Python');

// Rust
const rs = parseRust('fn hello(x: i32) -> i32 { x }');
console.assert(rs.symbols.some(s => s.kind === 'function' && s.name === 'hello'), 'rs fn');
console.log('✓ ast-adapters: Rust');

// Go
const go = parseGo('func main() { fmt.Println("hi") }');
console.assert(go.symbols.some(s => s.kind === 'function' && s.name === 'main'), 'go func');
console.log('✓ ast-adapters: Go');
