// src/test/mathlib.test.ts
// Tests for the math built-in module (import * from "math").
// Covers: constants, basic functions, powers/logs, trig, hyperbolic,
// fmod/lerp, domain errors, and interaction with the type system.

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, ModuleLoader } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';
import { mathlibFunctions } from '../mathlib';
import { PfunError } from '../errors';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const run = (source: string) => {
  // Give the module loader a temp dir and register math as a builtin
  const tmpDir = os.tmpdir();
  const loader = new ModuleLoader(tmpDir, (interp) => {
    interp.registerLibrary(stdlibFunctions, stdlibTypes);
    interp.registerLibrary(iolibFunctions, []);
  });
  loader.registerBuiltin('math', mathlibFunctions);

  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter(tmpDir, loader);
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
  const tmpDir = os.tmpdir();
  const loader = new ModuleLoader(tmpDir, (interp) => {
    interp.registerLibrary(stdlibFunctions, stdlibTypes);
    interp.registerLibrary(iolibFunctions, []);
  });
  loader.registerBuiltin('math', mathlibFunctions);

  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter(tmpDir, loader);
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  try {
    interpreter.interpret(ast, source);
  } catch (e) {
    if (e instanceof PfunError) return e;
    // Cross-module instanceof check can fail in Jest; check by duck-typing
    if (e && typeof (e as any).pfunMessage === 'string') return e as any;
    throw new Error(`Expected PfunError but got ${(e as any)?.constructor?.name}: ${e}`);
  }
  throw new Error('Expected an error to be thrown but none was');
};

/** Parse the single float printed to logs and return it as a JS number. */
const num = (logs: string[]) => parseFloat(logs[0]);

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Math constants', () => {
  it('pi is approximately 3.14159', () => {
    const { logs } = run('import * from "math"; println(pi());');
    expect(num(logs)).toBeCloseTo(Math.PI, 10);
  });

  it('e is approximately 2.71828', () => {
    const { logs } = run('import * from "math"; println(e());');
    expect(num(logs)).toBeCloseTo(Math.E, 10);
  });

  it('tau is 2*pi', () => {
    const { logs } = run('import * from "math"; println(tau());');
    expect(num(logs)).toBeCloseTo(Math.PI * 2, 10);
  });

  it('inf is positive infinity', () => {
    const { logs } = run('import * from "math"; println(isFinite(inf()));');
    expect(logs).toEqual(['false']);
  });

  it('nan passes isNaN', () => {
    const { logs } = run('import * from "math"; println(isNaN(nan()));');
    expect(logs).toEqual(['true']);
  });
});

// ─── Basic functions ──────────────────────────────────────────────────────────

describe('abs', () => {
  it('abs of positive float', () => {
    const { logs } = run('import * from "math"; println(abs(3.5));');
    expect(num(logs)).toBeCloseTo(3.5);
  });

  it('abs of negative float', () => {
    const { logs } = run('import * from "math"; println(abs(-3.5));');
    expect(num(logs)).toBeCloseTo(3.5);
  });

  it('abs of positive int', () => {
    const { logs } = run('import * from "math"; println(abs(5));');
    expect(logs).toEqual(['5']);
  });

  it('abs of negative int', () => {
    const { logs } = run('import * from "math"; println(abs(-5));');
    expect(logs).toEqual(['5']);
  });
});

describe('sign', () => {
  it('sign of positive float is 1.0', () => {
    const { logs } = run('import * from "math"; println(sign(3.5));');
    expect(num(logs)).toBe(1);
  });

  it('sign of negative float is -1.0', () => {
    const { logs } = run('import * from "math"; println(sign(-2.0));');
    expect(num(logs)).toBe(-1);
  });

  it('sign of positive int is 1', () => {
    const { logs } = run('import * from "math"; println(sign(7));');
    expect(logs).toEqual(['1']);
  });

  it('sign of zero int is 0', () => {
    const { logs } = run('import * from "math"; println(sign(0));');
    expect(logs).toEqual(['0']);
  });
});

describe('min / max', () => {
  it('min of two floats', () => {
    const { logs } = run('import * from "math"; println(min(3.0, 1.5));');
    expect(num(logs)).toBeCloseTo(1.5);
  });

  it('max of two floats', () => {
    const { logs } = run('import * from "math"; println(max(3.0, 1.5));');
    expect(num(logs)).toBeCloseTo(3.0);
  });

  it('min of two ints stays int', () => {
    const { logs } = run('import * from "math"; println(min(3, 7));');
    expect(logs).toEqual(['3']);
  });

  it('max of mixed int/float promotes', () => {
    const { logs } = run('import * from "math"; println(max(2, 1.5));');
    expect(num(logs)).toBe(2.0);
  });
});

describe('clamp', () => {
  it('clamps above max', () => {
    const { logs } = run('import * from "math"; println(clamp(0.0, 1.0, 1.5));');
    expect(num(logs)).toBeCloseTo(1.0);
  });

  it('clamps below min', () => {
    const { logs } = run('import * from "math"; println(clamp(0.0, 1.0, -0.5));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('value in range passes through', () => {
    const { logs } = run('import * from "math"; println(clamp(0.0, 10.0, 5.5));');
    expect(num(logs)).toBeCloseTo(5.5);
  });

  it('clamp works on ints', () => {
    const { logs } = run('import * from "math"; println(clamp(0, 100, 150));');
    expect(logs).toEqual(['100']);
  });
});

// ─── Powers and logarithms ────────────────────────────────────────────────────

describe('sqrt', () => {
  it('sqrt of 4.0 is 2.0', () => {
    const { logs } = run('import * from "math"; println(sqrt(4.0));');
    expect(num(logs)).toBeCloseTo(2.0);
  });

  it('sqrt of 2 is approximately 1.41421', () => {
    const { logs } = run('import * from "math"; println(sqrt(2.0));');
    expect(num(logs)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('sqrt of int is promoted to float', () => {
    const { logs } = run('import * from "math"; println(sqrt(9));');
    expect(num(logs)).toBeCloseTo(3.0);
  });

  it('sqrt of negative throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; sqrt(-1.0);');
    expect(err.kind).toBe('FloatDomain');
    expect(err.pfunMessage).toContain('[FloatDomain]');
    expect(err.pfunMessage).toContain('NaN');
  });
});

describe('cbrt', () => {
  it('cbrt of 8.0 is 2.0', () => {
    const { logs } = run('import * from "math"; println(cbrt(8.0));');
    expect(num(logs)).toBeCloseTo(2.0);
  });

  it('cbrt of negative is valid (unlike sqrt)', () => {
    const { logs } = run('import * from "math"; println(cbrt(-8.0));');
    expect(num(logs)).toBeCloseTo(-2.0);
  });
});

describe('pow', () => {
  it('pow(2.0, 10.0) is 1024.0', () => {
    const { logs } = run('import * from "math"; println(pow(2.0, 10.0));');
    expect(num(logs)).toBeCloseTo(1024.0);
  });

  it('pow(9.0, 0.5) is 3.0', () => {
    const { logs } = run('import * from "math"; println(pow(9.0, 0.5));');
    expect(num(logs)).toBeCloseTo(3.0);
  });

  it('pow with int args', () => {
    const { logs } = run('import * from "math"; println(pow(2, 8));');
    expect(num(logs)).toBeCloseTo(256.0);
  });
});

describe('exp / log', () => {
  it('exp(0.0) is 1.0', () => {
    const { logs } = run('import * from "math"; println(exp(0.0));');
    expect(num(logs)).toBeCloseTo(1.0);
  });

  it('exp(1.0) is e', () => {
    const { logs } = run('import * from "math"; println(exp(1.0));');
    expect(num(logs)).toBeCloseTo(Math.E, 10);
  });

  it('log(1.0) is 0.0', () => {
    const { logs } = run('import * from "math"; println(log(1.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('log(e()) is 1.0', () => {
    const { logs } = run('import * from "math"; println(log(e()));');
    expect(num(logs)).toBeCloseTo(1.0, 10);
  });

  it('log(0) throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; log(0.0);');
    expect(err.kind).toBe('FloatDomain');
    expect(err.pfunMessage).toContain('Infinity');
  });

  it('log(-1.0) throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; log(-1.0);');
    expect(err.kind).toBe('FloatDomain');
    expect(err.pfunMessage).toContain('NaN');
  });

  it('log2(8.0) is 3.0', () => {
    const { logs } = run('import * from "math"; println(log2(8.0));');
    expect(num(logs)).toBeCloseTo(3.0);
  });

  it('log10(1000.0) is 3.0', () => {
    const { logs } = run('import * from "math"; println(log10(1000.0));');
    expect(num(logs)).toBeCloseTo(3.0);
  });
});

describe('hypot', () => {
  it('hypot(3.0, 4.0) is 5.0', () => {
    const { logs } = run('import * from "math"; println(hypot(3.0, 4.0));');
    expect(num(logs)).toBeCloseTo(5.0);
  });
});

describe('fmod', () => {
  it('fmod(5.5, 2.0) is 1.5', () => {
    const { logs } = run('import * from "math"; println(fmod(5.5, 2.0));');
    expect(num(logs)).toBeCloseTo(1.5);
  });

  it('fmod(7.0, 3.0) is 1.0', () => {
    const { logs } = run('import * from "math"; println(fmod(7.0, 3.0));');
    expect(num(logs)).toBeCloseTo(1.0);
  });

  it('fmod(x, 0) throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; fmod(5.0, 0.0);');
    expect(err.kind).toBe('FloatDomain');
  });
});

describe('lerp', () => {
  it('lerp at t=0 gives a', () => {
    const { logs } = run('import * from "math"; println(lerp(0.0, 10.0, 0.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('lerp at t=1 gives b', () => {
    const { logs } = run('import * from "math"; println(lerp(0.0, 10.0, 1.0));');
    expect(num(logs)).toBeCloseTo(10.0);
  });

  it('lerp at t=0.5 gives midpoint', () => {
    const { logs } = run('import * from "math"; println(lerp(0.0, 10.0, 0.5));');
    expect(num(logs)).toBeCloseTo(5.0);
  });

  it('lerp with int args is promoted', () => {
    const { logs } = run('import * from "math"; println(lerp(0, 10, 0.25));');
    expect(num(logs)).toBeCloseTo(2.5);
  });
});

// ─── Trigonometry ─────────────────────────────────────────────────────────────

describe('Trigonometry', () => {
  it('sin(0) is 0', () => {
    const { logs } = run('import * from "math"; println(sin(0.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('sin(pi/2) is 1', () => {
    const { logs } = run('import * from "math"; println(sin(pi() / 2.0));');
    expect(num(logs)).toBeCloseTo(1.0, 10);
  });

  it('cos(0) is 1', () => {
    const { logs } = run('import * from "math"; println(cos(0.0));');
    expect(num(logs)).toBeCloseTo(1.0);
  });

  it('cos(pi()) is -1', () => {
    const { logs } = run('import * from "math"; println(cos(pi()));');
    expect(num(logs)).toBeCloseTo(-1.0, 10);
  });

  it('tan(pi/4) is approximately 1', () => {
    const { logs } = run('import * from "math"; println(tan(pi() / 4.0));');
    expect(num(logs)).toBeCloseTo(1.0, 10);
  });

  it('asin(1.0) is pi/2', () => {
    const { logs } = run('import * from "math"; println(asin(1.0));');
    expect(num(logs)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('asin out of domain throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; asin(2.0);');
    expect(err.kind).toBe('FloatDomain');
  });

  it('acos(1.0) is 0', () => {
    const { logs } = run('import * from "math"; println(acos(1.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('acos out of domain throws FloatDomain', () => {
    const err = runExpectError('import * from "math"; acos(2.0);');
    expect(err.kind).toBe('FloatDomain');
  });

  it('atan(1.0) is pi/4', () => {
    const { logs } = run('import * from "math"; println(atan(1.0));');
    expect(num(logs)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('atan2(1.0, 1.0) is pi/4', () => {
    const { logs } = run('import * from "math"; println(atan2(1.0, 1.0));');
    expect(num(logs)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('sin accepts int arg (promotes to float)', () => {
    const { logs } = run('import * from "math"; println(sin(0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });
});

// ─── Hyperbolic ───────────────────────────────────────────────────────────────

describe('Hyperbolic functions', () => {
  it('sinh(0) is 0', () => {
    const { logs } = run('import * from "math"; println(sinh(0.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('cosh(0) is 1', () => {
    const { logs } = run('import * from "math"; println(cosh(0.0));');
    expect(num(logs)).toBeCloseTo(1.0);
  });

  it('tanh(0) is 0', () => {
    const { logs } = run('import * from "math"; println(tanh(0.0));');
    expect(num(logs)).toBeCloseTo(0.0);
  });

  it('tanh(inf) approaches 1', () => {
    const { logs } = run('import * from "math"; println(tanh(1000.0));');
    expect(num(logs)).toBeCloseTo(1.0, 5);
  });
});

// ─── Currying with math functions ─────────────────────────────────────────────

describe('Currying and higher-order use', () => {
  it('partially applied pow maps over a list', () => {
    const { logs } = run(`
      import * from "math";
      let square = pow(2.0);
      println(map(fn x => pow(x, 2.0), [1.0, 2.0, 3.0, 4.0]));
    `);
    expect(logs).toEqual(['[1.0, 4.0, 9.0, 16.0]']);
  });

  it('abs maps over a mixed-sign list', () => {
    const { logs } = run(`
      import * from "math";
      println(map(fn x => abs(x), [-1.0, 2.0, -3.5, 4.0]));
    `);
    expect(logs).toEqual(['[1.0, 2.0, 3.5, 4.0]']);
  });

  it('sqrt used in reduce to sum roots', () => {
    const { logs } = run(`
      import * from "math";
      let roots = map(fn x => sqrt(x), [1.0, 4.0, 9.0, 16.0]);
      let total = reduce(fn acc, x => acc + x, 0.0, roots);
      println(total);
    `);
    expect(num(logs)).toBeCloseTo(1 + 2 + 3 + 4);
  });
});

// ─── Domain error messages ────────────────────────────────────────────────────

describe('FloatDomain error formatting', () => {
  it('error includes [FloatDomain] header', () => {
    const err = runExpectError('import * from "math"; sqrt(-4.0);');
    expect(err.pfunMessage).toContain('[FloatDomain]');
  });

  it('error includes the source line', () => {
    const err = runExpectError('import * from "math"; sqrt(-4.0);');
    expect(err.pfunMessage).toContain('sqrt(-4.0)');
  });

  it('error includes what was produced (NaN)', () => {
    const err = runExpectError('import * from "math"; sqrt(-1.0);');
    expect(err.pfunMessage).toContain('NaN');
  });

  it('error includes what was produced (Infinity)', () => {
    const err = runExpectError('import * from "math"; log(0.0);');
    expect(err.pfunMessage).toContain('Infinity');
  });
});

describe('formatFixed', () => {
  it('rounds a float to the given decimal places', () => {
    const { logs } = run('import * from "math"; println(formatFixed(3.14159, 2))');
    expect(logs[0]).toBe('3.14');
  });

  it('zero decimal places returns an integer string', () => {
    const { logs } = run('import * from "math"; println(formatFixed(3.7, 0))');
    expect(logs[0]).toBe('4');
  });

  it('pads with trailing zeros when needed', () => {
    const { logs: logs1 } = run('import * from "math"; println(formatFixed(1.0, 3))');
    expect(logs1[0]).toBe('1.000');
    const { logs: logs2 } = run('import * from "math"; println(formatFixed(42, 2))');
    expect(logs2[0]).toBe('42.00');
  });

  it('accepts Int (BigInt) as first argument', () => {
    const { logs: logs1 } = run('import * from "math"; println(formatFixed(42, 3))');
    expect(logs1[0]).toBe('42.000');
    const { logs: logs2 } = run('import * from "math"; println(formatFixed(-7, 1))');
    expect(logs2[0]).toBe('-7.0');
  });

  it('handles negative numbers', () => {
    const { logs: logs1 } = run('import * from "math"; println(formatFixed(-3.5, 1))');
    expect(logs1[0]).toBe('-3.5');
    const { logs: logs2 } = run('import * from "math"; println(formatFixed(-0.001, 2))');
    expect(logs2[0]).toBe('-0.00');
  });

  it('handles zero', () => {
    const { logs: logs1 } = run('import * from "math"; println(formatFixed(0.0, 2))');
    expect(logs1[0]).toBe('0.00');
    const { logs: logs2 } = run('import * from "math"; println(formatFixed(0, 0))');
    expect(logs2[0]).toBe('0');
  });

  it('corrects floating-point representation (0.1+0.2)', () => {
    // toFixed rounds correctly, hiding the 0.30000...4 representation
    const { logs } = run('import * from "math"; println(formatFixed(0.1 + 0.2, 2))');
    expect(logs[0]).toBe('0.30');
  });

  it('handles five decimal places', () => {
    const { logs } = run('import * from "math"; println(formatFixed(3.14159, 5))');
    expect(logs[0]).toBe('3.14159');
  });

  it('handles large numbers', () => {
    const { logs } = run('import * from "math"; println(formatFixed(1000000.5, 2))');
    expect(logs[0]).toBe('1000000.50');
  });

  it('zero decimal places on a whole number', () => {
    const { logs } = run('import * from "math"; println(formatFixed(100, 0))');
    expect(logs[0]).toBe('100');
  });

  it('throws on non-numeric first argument', () => {
    const err = runExpectError('import * from "math"; formatFixed("x", 2)');
    expect(err.pfunMessage).toContain('numeric first argument');
  });

  it('throws on non-integer second argument', () => {
    const err = runExpectError('import * from "math"; formatFixed(3.14, 2.5)');
    expect(err.pfunMessage).toContain('integer second argument');
  });

  it('throws on negative decimal places', () => {
    const err = runExpectError('import * from "math"; formatFixed(3.14, -1)');
    expect(err.pfunMessage).toContain('0–100');
  });

  it('throws on decimal places > 100', () => {
    const err = runExpectError('import * from "math"; formatFixed(3.14, 101)');
    expect(err.pfunMessage).toContain('0–100');
  });

  it('throws on NaN input', () => {
    const err = runExpectError('import * from "math"; formatFixed(nan(), 2)');
    expect(err.pfunMessage).toContain('NaN');
  });

  it('throws on Infinity input', () => {
    const err = runExpectError('import * from "math"; formatFixed(inf(), 2)');
    expect(err.pfunMessage).toContain('Infinity');
  });
});
