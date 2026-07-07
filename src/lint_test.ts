import { Lexer } from './lexer';
import { Parser } from './parser';
import { bootstrapLint } from './bootstrapLint';

function lint(name: string, src: string, expectReject: boolean) {
  const ast = new Parser(new Lexer(src, 'bootstrap').lex()).parse();
  const ds = bootstrapLint(ast);
  const rejected = ds.length > 0;
  const ok = rejected === expectReject;
  console.log(`${ok ? 'PASS' : 'XXXX'}  ${name}  ${rejected ? '[rejected: ' + ds[0].message.slice(0,45) + '...]' : '[accepted]'}`);
}

console.log('--- must be ACCEPTED (valid bootstrap subset) ---');
lint('int arithmetic', 'function f(a, b) { a + b }', false);
lint('string ++ concat', 'function f(a, b) { a ++ b }', false);
lint('generic function', 'generic function id(x) { x }', false);
lint('generic proc', 'generic proc run(c) { go(c) }', false);
lint('opaque type', 'export opaque type NonZero = { v }', false);
lint('generic variant', 'type Option = { | None | Some: generic v }', false);
lint('var + assignment stmt in proc', 'proc p() { var x = 0; x = x + 1; }', false);
lint('while loop', 'proc p() { var i = 0; while (i < 10) { i = i + 1; } }', false);
lint('fn lambda', 'function f(xs) { map(fn x => x + 1, xs) }', false);

console.log('--- must be REJECTED (outside bootstrap subset) ---');
lint('float literal', 'let pi = 3.14;', true);
lint('float in arithmetic', 'function f(x) { x + 2.5 }', true);
lint('proc lambda', 'proc p(xs) { each(proc x => log(x), xs) }', true);
lint('export var', 'export var counter = 0;', true);
lint('assignment in expr position', 'proc p() { var x = 0; let y = (x = 5); }', true);
lint('+ on string literal', 'function f(s) { "a" + s }', true);
lint('lazy usage', 'function f(xs) { lazy [x for x <- xs] }', true);
