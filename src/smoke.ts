import { Lexer } from './lexer';
import { Parser } from './parser';

function run(name: string, src: string, expectOk = true) {
  try {
    const toks = new Lexer(src).lex();
    const ast = new Parser(toks).parse();
    console.log(`${expectOk ? 'OK  ' : 'FAIL(should reject) '} ${name}`);
    return ast;
  } catch (e: any) {
    console.log(`${expectOk ? 'FAIL' : 'OK(rejected) '} ${name}  :: ${e.message}`);
    return null;
  }
}

// New V2 forms that must be ACCEPTED by the bootstrap dialect
run('++ concat', 'function f(a, b) { a ++ b }');
run('generic function', 'generic function id(x) { x }');
run('generic proc', 'generic proc runCore(cmd) { ping(cmd) }');
run('generic async proc', 'generic async proc dispatch(c) { go(c) }');
run('opaque type export', 'export opaque type NonZero = { v }');
run('generic variant payload', 'type Option = { | None | Some: generic v }');
run('generic record field', 'type Box = { generic v, tag }');
run('lazy list', 'function f(xs) { lazy [x for x <- xs] }');
run('hex byte _b', 'let b = 0xAB_b;');
run('hex int ending in B still int', 'let n = 0x1B;');
run('decimal byte legacy', 'let b = 200b;');
run('export generic function', 'export generic function map(f, xs) { xs }');

// Verify ++ desugars to PlusToken BinaryExpr
const toks = new Lexer('function f(a,b){ a ++ b }').lex();
const ast: any = new Parser(toks).parse();
function findBin(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'BinaryExpr') return node;
  for (const k of Object.keys(node)) { const r = findBin(node[k]); if (r) return r; }
  return null;
}
const bin = findBin(ast);
console.log(`++ desugar -> operator = ${bin ? bin.operator : 'NONE'} (expect PlusToken)`);

// Verify hex int 0x1B is an IntToken not a byte
const t2 = new Lexer('0x1B').lex();
console.log(`0x1B first token = ${t2[0].type} (expect IntToken)`);
const t3 = new Lexer('0xAB_b').lex();
console.log(`0xAB_b first token = ${t3[0].type} (expect ByteToken)`);
const t4 = new Lexer('1.5').lex();
console.log(`1.5 float raw = ${JSON.stringify((t4[0] as any).raw)} (expect "1.5")`);
