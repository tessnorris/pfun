// src/test/float.test.ts
// Tests for floating-point support: lexer tokens, AST nodes, arithmetic,
// mixed int/float operations, stringify output, and error cases.

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';
import { PfunError, classifyError } from '../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lex = (input: string) => new Lexer(input).lex();

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  const logs: string[] = [];
  let currentLine = '';
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => {
    logs.push(currentLine + args.map(String).join(' '));
    currentLine = '';
  };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    interpreter.interpret(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

const runExpectError = (source: string): PfunError => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  try {
    interpreter.interpret(ast, source);
  } catch (e) {
    if (e instanceof PfunError) return e;
    throw new Error(`Expected PfunError but got ${(e as any)?.constructor?.name}: ${e}`);
  }
  throw new Error('Expected an error to be thrown but none was');
};

// ─── Lexer ────────────────────────────────────────────────────────────────────

describe('Float Lexer', () => {
  describe('FloatToken production', () => {
    it('tokenises a simple decimal', () => {
      const tokens = lex('3.14');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBeCloseTo(3.14);
    });

    it('tokenises a float that looks like a whole number', () => {
      const tokens = lex('1.0');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBe(1.0);
    });

    it('tokenises positive scientific notation', () => {
      const tokens = lex('1.5e10');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBe(1.5e10);
    });

    it('tokenises negative exponent', () => {
      const tokens = lex('2.5e-3');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBeCloseTo(2.5e-3);
    });

    it('tokenises explicit positive exponent', () => {
      const tokens = lex('3e+8');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBe(3e8);
    });

    it('tokenises uppercase E exponent', () => {
      const tokens = lex('6.022E23');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBeCloseTo(6.022e23);
    });

    it('tokenises integer-only scientific notation as float', () => {
      const tokens = lex('1e6');
      expect(tokens[0].type).toBe('FloatToken');
      expect((tokens[0] as any).value).toBe(1e6);
    });

    it('does NOT treat "1." as a float — no digit after dot', () => {
      // "1." should lex as IntToken(1) then DotToken
      const tokens = lex('1.');
      expect(tokens[0].type).toBe('IntToken');
      expect(tokens[1].type).toBe('DotToken');
    });

    it('integers are still IntToken', () => {
      expect(lex('42')[0].type).toBe('IntToken');
    });

    it('float and int can appear in sequence', () => {
      const tokens = lex('1 + 2.5');
      expect(tokens[0].type).toBe('IntToken');
      expect(tokens[2].type).toBe('FloatToken');
    });
  });
});

// ─── AST ──────────────────────────────────────────────────────────────────────

describe('Float AST', () => {
  it('parses float literal into FloatExpr', () => {
    const ast = new Parser(lex('3.14;')).parse();
    const expr = (ast[0] as any).expression;
    expect(expr.type).toBe('FloatExpr');
    expect(expr.value).toBeCloseTo(3.14);
  });

  it('parses negative float via unary minus', () => {
    const ast = new Parser(lex('-2.5;')).parse();
    const expr = (ast[0] as any).expression;
    expect(expr.type).toBe('UnaryExpr');
    expect(expr.right.type).toBe('FloatExpr');
    expect(expr.right.value).toBe(2.5);
  });

  it('parses float in let binding', () => {
    const ast = new Parser(lex('let x = 1.5;')).parse();
    expect((ast[0] as any).initializer.type).toBe('FloatExpr');
  });

  it('parses float in binary expression', () => {
    const ast = new Parser(lex('1.0 + 2.0;')).parse();
    const expr = (ast[0] as any).expression;
    expect(expr.type).toBe('BinaryExpr');
    expect(expr.left.type).toBe('FloatExpr');
    expect(expr.right.type).toBe('FloatExpr');
  });
});

// ─── Arithmetic ───────────────────────────────────────────────────────────────

describe('Float Arithmetic', () => {
  describe('Float-only operations', () => {
    it('adds two floats', () => {
      const { logs } = run('println(1.5 + 2.5);');
      expect(logs).toEqual(['4.0']);
    });

    it('subtracts floats', () => {
      const { logs } = run('println(5.0 - 1.5);');
      expect(logs).toEqual(['3.5']);
    });

    it('multiplies floats', () => {
      const { logs } = run('println(2.0 * 3.0);');
      expect(logs).toEqual(['6.0']);
    });

    it('divides floats', () => {
      const { logs } = run('println(7.0 / 2.0);');
      expect(logs).toEqual(['3.5']);
    });

    it('supports unary negation on float', () => {
      const { logs } = run('println(-3.14);');
      expect(logs[0]).toMatch(/^-3\.14/);
    });
  });

  describe('Mixed int/float promotion', () => {
    it('int + float produces float', () => {
      const { logs } = run('println(1 + 0.5);');
      expect(logs).toEqual(['1.5']);
    });

    it('float + int produces float', () => {
      const { logs } = run('println(1.5 + 1);');
      expect(logs).toEqual(['2.5']);
    });

    it('int * float produces float', () => {
      const { logs } = run('println(3 * 1.5);');
      expect(logs).toEqual(['4.5']);
    });

    it('int - float produces float', () => {
      const { logs } = run('println(5 - 2.5);');
      expect(logs).toEqual(['2.5']);
    });
  });

  describe('Division behaviour', () => {
    it('int / int gives integer division', () => {
      const { logs } = run('println(7 / 2);');
      expect(logs).toEqual(['3']);        // not 3.5
    });

    it('1 / 2 gives 0, not 0.5', () => {
      const { logs } = run('println(1 / 2);');
      expect(logs).toEqual(['0']);
    });

    it('1.0 / 2 gives 0.5', () => {
      const { logs } = run('println(1.0 / 2);');
      expect(logs).toEqual(['0.5']);
    });

    it('1 / 2.0 gives 0.5', () => {
      const { logs } = run('println(1 / 2.0);');
      expect(logs).toEqual(['0.5']);
    });

    it('float division of large numbers', () => {
      const { logs } = run('println(10.0 / 4.0);');
      expect(logs).toEqual(['2.5']);
    });
  });

  describe('Modulo (integer only)', () => {
    it('int % int works as before', () => {
      const { logs } = run('println(10 % 3);');
      expect(logs).toEqual(['1']);
    });

    it('float % int throws FloatDomain', () => {
      const err = runExpectError('var x = 5.0 % 2; println(x);');
      expect(err.kind).toBe('FloatDomain');
      expect(err.pfunMessage).toContain('% requires integer');
    });

    it('int % float throws FloatDomain', () => {
      const err = runExpectError('var x = 5 % 2.0; println(x);');
      expect(err.kind).toBe('FloatDomain');
    });
  });
});

// ─── Comparisons ──────────────────────────────────────────────────────────────

describe('Float Comparisons', () => {
  it('float < float', () => {
    const { logs } = run('println(1.5 < 2.5);');
    expect(logs).toEqual(['true']);
  });

  it('float > float', () => {
    const { logs } = run('println(3.0 > 2.9);');
    expect(logs).toEqual(['true']);
  });

  it('float == float', () => {
    const { logs } = run('println(1.0 == 1.0);');
    expect(logs).toEqual(['true']);
  });

  it('float != float', () => {
    const { logs } = run('println(1.0 != 2.0);');
    expect(logs).toEqual(['true']);
  });

  it('mixed: int == float when values match', () => {
    const { logs } = run('println(1 == 1.0);');
    expect(logs).toEqual(['true']);
  });

  it('mixed: int < float', () => {
    const { logs } = run('println(1 < 1.5);');
    expect(logs).toEqual(['true']);
  });

  it('mixed: float > int', () => {
    const { logs } = run('println(2.5 > 2);');
    expect(logs).toEqual(['true']);
  });

  it('mixed: int != float when values differ', () => {
    const { logs } = run('println(1 != 1.5);');
    expect(logs).toEqual(['true']);
  });
});

// ─── Stringify / print output ─────────────────────────────────────────────────

describe('Float stringify', () => {
  it('whole-valued float prints with .0', () => {
    const { logs } = run('println(2.0);');
    expect(logs).toEqual(['2.0']);
  });

  it('fractional float prints without trailing .0', () => {
    const { logs } = run('println(3.14);');
    expect(logs).toEqual(['3.14']);
  });

  it('float in a list shows .0 for whole values', () => {
    const { logs } = run('println([1.0, 2.5, 3.0]);');
    expect(logs).toEqual(['[1.0, 2.5, 3.0]']);
  });

  it('float interpolates correctly in $-strings', () => {
    const { logs } = run('let x = 1.5; println($"x = {x}");');
    expect(logs).toEqual(['x = 1.5']);
  });

  it('scientific notation float prints as decimal', () => {
    const { logs } = run('println(1.5e2);');
    expect(logs).toEqual(['150.0']);
  });
});

// ─── Lists ────────────────────────────────────────────────────────────────────

describe('Float in lists', () => {
  it('a list of floats is valid', () => {
    const { logs } = run('let xs = [1.0, 2.0, 3.0]; println(head(xs));');
    expect(logs).toEqual(['1.0']);
  });

  it('mixing int and float in a list throws a type error', () => {
    const err = runExpectError('let xs = [1, 2.0]; eval xs;');
    expect(err.kind).toBe('Type');
    expect(err.pfunMessage).toContain('Type mismatch in list');
  });

  it('map over float list works', () => {
    const { logs } = run('let xs = [1.0, 2.0, 3.0]; println(map(fn x => x * 2.0, xs));');
    expect(logs).toEqual(['[2.0, 4.0, 6.0]']);
  });

  it('filter over float list works', () => {
    const { logs } = run('let xs = [1.5, 2.0, 2.5]; println(filter(fn x => x > 1.9, xs));');
    expect(logs).toEqual(['[2.0, 2.5]']);
  });
});

// ─── Cast builtins ────────────────────────────────────────────────────────────

describe('Cast builtins', () => {
  describe('toFloat', () => {
    it('converts int to float', () => {
      const { logs } = run('println(toFloat(3));');
      expect(logs).toEqual(['3.0']);
    });

    it('float passes through', () => {
      const { logs } = run('println(toFloat(3.14));');
      expect(logs[0]).toMatch(/^3\.14/);
    });

    it('parses a numeric string', () => {
      const { logs } = run('println(toFloat("2.5"));');
      expect(logs).toEqual(['2.5']);
    });

    it('throws on non-numeric string', () => {
      expect(() => run('toFloat("abc");')).toThrow();
    });
  });

  describe('toInt', () => {
    it('truncates float toward zero (positive)', () => {
      const { logs } = run('println(toInt(3.9));');
      expect(logs).toEqual(['3']);
    });

    it('truncates float toward zero (negative)', () => {
      const { logs } = run('println(toInt(-3.9));');
      expect(logs).toEqual(['-3']);
    });

    it('int passes through', () => {
      const { logs } = run('println(toInt(5));');
      expect(logs).toEqual(['5']);
    });

    it('throws on NaN', () => {
      expect(() => run('let x = 0.0 / 0.0; toInt(x);')).toThrow();
    });
  });

  describe('floor / ceil / round', () => {
    it('floor rounds down', () => {
      const { logs } = run('println(floor(3.9));');
      expect(logs).toEqual(['3']);
    });

    it('floor of negative rounds more negative', () => {
      const { logs } = run('println(floor(-3.1));');
      expect(logs).toEqual(['-4']);
    });

    it('ceil rounds up', () => {
      const { logs } = run('println(ceil(3.1));');
      expect(logs).toEqual(['4']);
    });

    it('ceil of negative rounds toward zero', () => {
      const { logs } = run('println(ceil(-3.9));');
      expect(logs).toEqual(['-3']);
    });

    it('round rounds half-up', () => {
      const { logs } = run('println(round(2.5));');
      expect(logs).toEqual(['3']);
    });

    it('round rounds down for < .5', () => {
      const { logs } = run('println(round(2.4));');
      expect(logs).toEqual(['2']);
    });

    it('floor/ceil/round on int returns int unchanged', () => {
      const { logs } = run('println(floor(5)); println(ceil(5)); println(round(5));');
      expect(logs).toEqual(['5', '5', '5']);
    });
  });

  describe('isNaN / isFinite', () => {
    it('isNaN returns false for a normal float', () => {
      const { logs } = run('println(isNaN(1.5));');
      expect(logs).toEqual(['false']);
    });

    it('isNaN returns false for an int', () => {
      const { logs } = run('println(isNaN(42));');
      expect(logs).toEqual(['false']);
    });

    it('isFinite returns true for a normal float', () => {
      const { logs } = run('println(isFinite(3.14));');
      expect(logs).toEqual(['true']);
    });

    it('isFinite returns true for an int', () => {
      const { logs } = run('println(isFinite(100));');
      expect(logs).toEqual(['true']);
    });

    it('isFinite returns false for a string', () => {
      const { logs } = run('println(isFinite("hello"));');
      expect(logs).toEqual(['false']);
    });
  });
});

// ─── Domain errors ────────────────────────────────────────────────────────────

describe('FloatDomain errors', () => {
  it('classifyError identifies float domain messages', () => {
    expect(classifyError('Float domain error: + produced Infinity.')).toBe('FloatDomain');
    expect(classifyError('Float domain error: * produced NaN.')).toBe('FloatDomain');
    expect(classifyError('% requires integer operands.')).toBe('FloatDomain');
  });

  it('error kind is FloatDomain for % on float', () => {
    const err = runExpectError('var x = 1.0 % 2; println(x);');
    expect(err.kind).toBe('FloatDomain');
    expect(err.pfunMessage).toContain('[FloatDomain]');
  });

  it('error message identifies the bad operator', () => {
    const err = runExpectError('var x = 1.0 % 2; println(x);');
    expect(err.pfunMessage).toContain('% requires integer');
  });

  it('includes source line in FloatDomain error', () => {
    const err = runExpectError('var x = 1.0 % 2; println(x);');
    expect(err.pfunMessage).toContain('1.0 % 2');
  });
});

// ─── Functions with floats ────────────────────────────────────────────────────

describe('Floats in functions', () => {
  it('function returns float result', () => {
    const { logs } = run(`
      function avg(a, b) { return (a + b) / 2.0; }
      println(avg(3.0, 5.0));
    `);
    expect(logs).toEqual(['4.0']);
  });

  it('recursive float function', () => {
    const { logs } = run(`
      function sumF(xs) {
        return length(xs) == 0 ? 0.0 : head(xs) + sumF(tail(xs));
      }
      println(sumF([1.5, 2.5, 3.0]));
    `);
    expect(logs).toEqual(['7.0']);
  });

  it('float works in ternary', () => {
    const { logs } = run('let x = 1.5; println(x > 1.0 ? "big" : "small");');
    expect(logs).toEqual(['big']);
  });

  it('float works in let/var', () => {
    const { logs } = run('var x = 1.0; x = x + 0.5; println(x);');
    expect(logs).toEqual(['1.5']);
  });

  it('memoised function works with float arguments', () => {
    const { logs } = run(`
      memo function double(x) { return x * 2.0; }
      println(double(1.5));
      println(double(1.5));
    `);
    expect(logs).toEqual(['3.0', '3.0']);
  });
});
