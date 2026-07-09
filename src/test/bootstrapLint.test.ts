import { Lexer, Token } from '../lexer';
import { Parser } from '../parser';
import { bootstrapLint } from '../bootstrapLint';

// Replaces the ad-hoc sandbox harnesses (smoke.ts, lint_test.ts) with a proper
// Jest suite. Covers: bootstrap-dialect acceptance of V2 syntax, the
// bootstrapLint rejecter, dialect-gated byte lexing, and legacy-mode
// non-regression on representative V1 forms.

const lexBoot = (src: string): Token[] => new Lexer(src, 'bootstrap').lex();
const lexLegacy = (src: string): Token[] => new Lexer(src).lex();
const parseBoot = (src: string) => new Parser(lexBoot(src)).parse();
const lintBoot = (src: string) => bootstrapLint(parseBoot(src));

describe('Bootstrap Dialect', () => {
  describe('V2 syntax acceptance', () => {
    it.each([
      ['++ string concat',        'function f(a, b) { a ++ b }'],
      ['generic function',        'generic function id(x) { x }'],
      ['generic proc',            'generic proc run(c) { go(c) }'],
      ['generic async proc',      'generic async proc dispatch(c) { go(c) }'],
      ['opaque type export',      'export opaque type NonZero = { v }'],
      ['generic variant payload', 'type Option2 = { | None2 | Some2: generic v }'],
      ['generic record field',    'type Box = { generic v, tag }'],
      ['lazy list comprehension', 'function f(xs) { lazy [x for x <- xs] }'],
      ['hex byte _b suffix',      'let b = 0xAB_b;'],
      ['export generic function', 'export generic function map2(f, xs) { xs }'],
    ])('parses %s', (_name, src) => {
      expect(() => parseBoot(src)).not.toThrow();
    });

    it('desugars ++ to a PlusToken BinaryExpr with srcOp provenance', () => {
      const ast = parseBoot('function f(a, b) { a ++ b }');
      const findBin = (node: any): any => {
        if (!node || typeof node !== 'object') return null;
        if (node.type === 'BinaryExpr') return node;
        for (const k of Object.keys(node)) {
          const r = findBin(node[k]);
          if (r) return r;
        }
        return null;
      };
      const bin = findBin(ast);
      expect(bin).not.toBeNull();
      expect(bin.operator).toBe('PlusToken');
      expect(bin.srcOp).toBe('++');
    });
  });

  describe('dialect-gated byte lexing', () => {
    it('lexes 0x1B as a Byte in legacy mode (historical behavior preserved)', () => {
      expect(lexLegacy('0x1B')[0].type).toBe('ByteToken');
    });

    it('lexes 0x1B as an Int in bootstrap mode', () => {
      const t = lexBoot('0x1B')[0] as any;
      expect(t.type).toBe('IntToken');
      expect(t.value).toBe(27n);
    });

    it('lexes 0xAB_b as a Byte in bootstrap mode', () => {
      const t = lexBoot('0xAB_b')[0] as any;
      expect(t.type).toBe('ByteToken');
      expect(t.value).toBe(171);
    });

    it('lexes decimal byte 200b identically in both dialects', () => {
      expect((lexLegacy('200b')[0] as any).value).toBe(200);
      expect((lexBoot('200b')[0] as any).value).toBe(200);
    });

    it('carries float literal source text on FloatToken.raw', () => {
      expect((lexLegacy('1.5')[0] as any).raw).toBe('1.5');
    });
  });

  describe('bootstrapLint rejecter', () => {
    it.each([
      ['int arithmetic',            'function f(a, b) { a + b }'],
      ['string ++ concat',          'function f(a, b) { a ++ b }'],
      ['assignment as statement',   'proc p() { var x = 0; x = x + 1; }'],
      ['fn lambda',                 'function f(xs) { map(fn x => x + 1, xs) }'],
    ])('accepts %s', (_name, src) => {
      expect(lintBoot(src)).toHaveLength(0);
    });

    it.each([
      ['float literal',              'let pi = 3.14;'],
      ['float in arithmetic',        'function f(x) { x + 2.5 }'],
      ['proc lambda',                'proc p(xs) { each(proc x => log(x), xs) }'],
      ['export var',                 'export var counter = 0;'],
      ['assignment in expr position','proc p() { var x = 0; let y = (x = 5); }'],
      ["+ on a string literal",      'function f(s) { "a" + s }'],
      ['lazy in compiler source',    'function f(xs) { lazy [x for x <- xs] }'],
    ])('rejects %s', (_name, src) => {
      expect(lintBoot(src).length).toBeGreaterThan(0);
    });

    it('does not flag ++ on strings as a + violation (srcOp guard)', () => {
      expect(lintBoot('function f(s) { "a" ++ s }')).toHaveLength(0);
    });
  });

  describe('legacy-mode non-regression', () => {
    it.each([
      ['let with arithmetic',   'let x = 1 + 2 * 3;'],
      ['function declaration',  'function add(a, b) { a + b }'],
      ['proc with while',       'proc p() { var i = 0; while (i < 10) { i = i + 1; } }'],
      ['union type + match',    'type T = { | A | B: v }\nfunction f(t) { match t with | A -> 1 | B b -> 2 }'],
      ['string + (legal in legacy)', 'function f(s) { "a" + s }'],
    ])('legacy parse of %s is unchanged', (_name, src) => {
      expect(() => new Parser(lexLegacy(src)).parse()).not.toThrow();
    });
  });
});
