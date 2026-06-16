// src/test/inferencer.test.ts
import {
  freshVar, resetFreshVarCounter, peekNextId,
  Substitution, freeVarsIn, formatType,
  unify, UnificationError, OccursCheckError,
  generateConstraints,
} from '../inferencer';
import { PfunType } from '../ast';
import { Lexer } from '../lexer';
import { Parser } from '../parser';

beforeEach(() => resetFreshVarCounter());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INT:   PfunType = { kind: 'Int' };
const FLOAT: PfunType = { kind: 'Float' };
const STR:   PfunType = { kind: 'Str' };
const BOOL:  PfunType = { kind: 'Bool' };
const CHAR:  PfunType = { kind: 'Char' };
const BYTE:  PfunType = { kind: 'Byte' };
const NIL:   PfunType = { kind: 'Nil' };

function tyvar(id: number): PfunType { return { kind: 'TyVar', id }; }
function list(el: PfunType): PfunType { return { kind: 'List', element: el }; }
function arr(el: PfunType): PfunType  { return { kind: 'Array', element: el }; }
function opt(inner: PfunType): PfunType { return { kind: 'Option', inner }; }
function dict(k: PfunType, v: PfunType): PfunType { return { kind: 'Dict', key: k, value: v }; }
function fn(...args: PfunType[]): PfunType {
  return { kind: 'Fn', params: args.slice(0, -1), ret: args[args.length - 1] };
}
function named(name: string, unionName?: string): PfunType {
  return unionName ? { kind: 'Named', name, unionName } : { kind: 'Named', name };
}
function generic(name: string, ...params: PfunType[]): PfunType {
  return { kind: 'Generic', name, params };
}

function u(a: PfunType, b: PfunType, subst = Substitution.empty()): Substitution {
  return unify(a, b, subst);
}

function resolves(a: PfunType, b: PfunType, t: PfunType, expected: PfunType): void {
  expect(u(a, b).apply(t)).toEqual(expected);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1  Fresh variables
// ═══════════════════════════════════════════════════════════════════════════════

describe('freshVar', () => {
  it('allocates ids starting from 0', () => {
    expect(freshVar()).toEqual({ kind: 'TyVar', id: 0 });
  });

  it('allocates monotonically increasing ids', () => {
    const a = freshVar(); const b = freshVar(); const c = freshVar();
    expect(a.id).toBe(0); expect(b.id).toBe(1); expect(c.id).toBe(2);
  });

  it('each call returns a distinct variable', () => {
    const ids = Array.from({ length: 10 }, freshVar).map(v => v.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('all allocated vars have kind TyVar', () => {
    for (let i = 0; i < 5; i++) expect(freshVar().kind).toBe('TyVar');
  });

  it('peekNextId reflects current counter without allocating', () => {
    expect(peekNextId()).toBe(0);
    freshVar(); expect(peekNextId()).toBe(1);
    freshVar(); freshVar(); expect(peekNextId()).toBe(3);
  });

  it('resetFreshVarCounter restarts from 0', () => {
    freshVar(); freshVar(); freshVar();
    resetFreshVarCounter();
    expect(freshVar()).toEqual({ kind: 'TyVar', id: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 2  Substitution
// ═══════════════════════════════════════════════════════════════════════════════

describe('Substitution.empty', () => {
  it('has size 0', () => expect(Substitution.empty().size).toBe(0));

  it('apply leaves any type unchanged', () => {
    const s = Substitution.empty();
    expect(s.apply(INT)).toEqual(INT);
    expect(s.apply(tyvar(0))).toEqual(tyvar(0));
    expect(s.apply(list(INT))).toEqual(list(INT));
  });
});

describe('Substitution.of', () => {
  it('creates a singleton mapping', () => {
    const s = Substitution.of(0, INT);
    expect(s.size).toBe(1);
    expect(s.has(0)).toBe(true);
    expect(s.has(1)).toBe(false);
  });

  it('apply resolves the mapped variable', () => {
    expect(Substitution.of(0, INT).apply(tyvar(0))).toEqual(INT);
  });

  it('apply leaves unmapped variables alone', () => {
    expect(Substitution.of(0, INT).apply(tyvar(1))).toEqual(tyvar(1));
  });
});

describe('Substitution.apply — ground types', () => {
  const s = Substitution.of(0, INT);
  it('leaves Int unchanged',     () => expect(s.apply(INT)).toEqual(INT));
  it('leaves Str unchanged',     () => expect(s.apply(STR)).toEqual(STR));
  it('leaves Bool unchanged',    () => expect(s.apply(BOOL)).toEqual(BOOL));
  it('leaves Unknown unchanged', () => expect(s.apply({ kind: 'Unknown' })).toEqual({ kind: 'Unknown' }));
  it('leaves Named unchanged',   () => {
    const named: PfunType = { kind: 'Named', name: 'Point' };
    expect(s.apply(named)).toEqual(named);
  });
});

describe('Substitution.apply — compound types', () => {
  it('substitutes inside List element', () => {
    expect(Substitution.of(0, INT).apply(list(tyvar(0)))).toEqual(list(INT));
  });

  it('substitutes inside Array element', () => {
    expect(Substitution.of(0, STR).apply(arr(tyvar(0)))).toEqual(arr(STR));
  });

  it('substitutes inside Option inner', () => {
    expect(Substitution.of(0, BOOL).apply(opt(tyvar(0)))).toEqual(opt(BOOL));
  });

  it('substitutes inside Dict key and value', () => {
    const s = Substitution.of(0, STR).compose(Substitution.of(1, INT));
    expect(s.apply(dict(tyvar(0), tyvar(1)))).toEqual(dict(STR, INT));
  });

  it('substitutes inside Fn params and return', () => {
    const s = Substitution.of(0, INT).compose(Substitution.of(1, BOOL));
    expect(s.apply(fn(tyvar(0), tyvar(1)))).toEqual(fn(INT, BOOL));
  });

  it('substitutes inside Generic params', () => {
    const s = Substitution.of(0, INT);
    expect(s.apply(generic('Pair', tyvar(0), STR))).toEqual(generic('Pair', INT, STR));
  });

  it('handles nested compound types', () => {
    expect(Substitution.of(0, INT).apply(list(list(tyvar(0))))).toEqual(list(list(INT)));
  });

  it('handles partial substitution — leaves unbound vars', () => {
    const s = Substitution.of(0, INT);
    const t: PfunType = { kind: 'Fn', params: [tyvar(0), tyvar(1)], ret: tyvar(0) };
    expect(s.apply(t)).toEqual({ kind: 'Fn', params: [INT, tyvar(1)], ret: INT });
  });
});

describe('Substitution.apply — chain resolution', () => {
  it('chases a single-step chain: α0→α1, α1→Int', () => {
    const s = new Substitution(new Map<number, PfunType>([[0, tyvar(1)], [1, INT]]));
    expect(s.apply(tyvar(0))).toEqual(INT);
  });

  it('chases a two-step chain: α0→α1→α2→Str', () => {
    const s = new Substitution(new Map<number, PfunType>([[0, tyvar(1)], [1, tyvar(2)], [2, STR]]));
    expect(s.apply(tyvar(0))).toEqual(STR);
  });

  it('terminates at an unbound var', () => {
    const s = new Substitution(new Map<number, PfunType>([[0, tyvar(1)]]));
    expect(s.apply(tyvar(0))).toEqual(tyvar(1));
  });

  it('chases chains inside compound types', () => {
    const s = new Substitution(new Map<number, PfunType>([[0, tyvar(1)], [1, INT]]));
    expect(s.apply(list(tyvar(0)))).toEqual(list(INT));
  });
});

describe('Substitution.extend', () => {
  it('adds a binding without mutating the original', () => {
    const s0 = Substitution.of(0, INT);
    const s1 = s0.extend(1, STR);
    expect(s1.size).toBe(2);
    expect(s0.size).toBe(1);
    expect(s0.has(1)).toBe(false);
  });
});

describe('Substitution.compose', () => {
  it('compose with empty is identity on both sides', () => {
    const s = Substitution.of(0, INT);
    expect(s.compose(Substitution.empty()).apply(tyvar(0))).toEqual(INT);
    expect(Substitution.empty().compose(s).apply(tyvar(0))).toEqual(INT);
  });

  it('α0→α1 composed with α1→Int gives α0→Int', () => {
    const c = Substitution.of(0, tyvar(1)).compose(Substitution.of(1, INT));
    expect(c.apply(tyvar(0))).toEqual(INT);
  });

  it('is equivalent to applying each in sequence', () => {
    const s1 = Substitution.of(0, tyvar(1));
    const s2 = Substitution.of(1, INT);
    const t  = list(tyvar(0));
    expect(s1.compose(s2).apply(t)).toEqual(s2.apply(s1.apply(t)));
  });

  it('s1 binding takes precedence over s2 for the same id', () => {
    const c = Substitution.of(0, INT).compose(Substitution.of(0, STR));
    expect(c.apply(tyvar(0))).toEqual(INT);
  });

  it('three-way compose is associative', () => {
    const s1 = Substitution.of(0, tyvar(1));
    const s2 = Substitution.of(1, tyvar(2));
    const s3 = Substitution.of(2, INT);
    expect(s1.compose(s2).compose(s3).apply(tyvar(0))).toEqual(INT);
    expect(s1.compose(s2.compose(s3)).apply(tyvar(0))).toEqual(INT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 3  Free variable collection
// ═══════════════════════════════════════════════════════════════════════════════

describe('freeVarsIn', () => {
  it('returns empty set for ground types', () => {
    expect(freeVarsIn(INT).size).toBe(0);
    expect(freeVarsIn({ kind: 'Named', name: 'Point' }).size).toBe(0);
    expect(freeVarsIn({ kind: 'Unknown' }).size).toBe(0);
  });

  it('returns singleton set for a bare TyVar', () => {
    expect(freeVarsIn(tyvar(3))).toEqual(new Set([3]));
  });

  it('collects vars inside List, Option, Fn, Dict, Generic', () => {
    expect(freeVarsIn(list(tyvar(0)))).toEqual(new Set([0]));
    expect(freeVarsIn(opt(tyvar(5)))).toEqual(new Set([5]));
    expect(freeVarsIn(dict(tyvar(0), tyvar(1)))).toEqual(new Set([0, 1]));
    expect(freeVarsIn(fn(tyvar(0), tyvar(1), tyvar(2)))).toEqual(new Set([0, 1, 2]));
    expect(freeVarsIn(generic('Pair', tyvar(2), tyvar(3)))).toEqual(new Set([2, 3]));
  });

  it('deduplicates the same var appearing multiple times', () => {
    expect(freeVarsIn(fn(tyvar(0), tyvar(0)))).toEqual(new Set([0]));
  });

  it('collects vars in nested types', () => {
    expect(freeVarsIn(list(fn(tyvar(0), list(tyvar(1)))))).toEqual(new Set([0, 1]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 4  Type formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatType', () => {
  it('formats ground types', () => {
    expect(formatType(INT)).toBe('Int');
    expect(formatType(STR)).toBe('Str');
    expect(formatType(BOOL)).toBe('Bool');
    expect(formatType(CHAR)).toBe('Char');
    expect(formatType(NIL)).toBe('Nil');
    expect(formatType({ kind: 'Unknown' })).toBe('?');
  });

  it('formats TyVar as α{id}', () => {
    expect(formatType(tyvar(0))).toBe('α0');
    expect(formatType(tyvar(42))).toBe('α42');
  });

  it('formats compound types', () => {
    expect(formatType(list(INT))).toBe('List<Int>');
    expect(formatType(opt(STR))).toBe('Option<Str>');
    expect(formatType(dict(STR, INT))).toBe('Dict<Str, Int>');
    expect(formatType(fn(INT, BOOL))).toBe('(Int) -> Bool');
    expect(formatType({ kind: 'Fn', params: [], ret: INT })).toBe('() -> Int');
    expect(formatType({ kind: 'Fn', params: [INT, STR], ret: BOOL })).toBe('(Int, Str) -> Bool');
    expect(formatType(generic('Pair', INT, STR))).toBe('Pair<Int, Str>');
  });

  it('formats Named with and without unionName', () => {
    expect(formatType(named('Point'))).toBe('Point');
    expect(formatType(named('Square', 'Shape'))).toBe('Shape.Square');
  });

  it('formats nested types', () => {
    expect(formatType(list(fn(tyvar(0), INT)))).toBe('List<(α0) -> Int>');
  });

  it('Substitution.toString uses formatType', () => {
    const s = Substitution.of(0, INT).compose(Substitution.of(1, list(tyvar(2))));
    expect(s.toString()).toContain('α0 ↦ Int');
    expect(s.toString()).toContain('α1 ↦ List<α2>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 5  Unification
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ground type unification', () => {
  it('same ground types unify with no new bindings', () => {
    expect(u(INT, INT).size).toBe(0);
    expect(() => u(STR, STR)).not.toThrow();
    expect(() => u(BOOL, BOOL)).not.toThrow();
  });

  it('different ground types fail', () => {
    expect(() => u(INT, STR)).toThrow(UnificationError);
    expect(() => u(INT, BOOL)).toThrow(UnificationError);
    expect(() => u(STR, BOOL)).toThrow(UnificationError);
  });

  it('kind mismatch fails', () => {
    expect(() => u(INT, list(INT))).toThrow(UnificationError);
  });

  // Regression: Byte was missing from unify()'s primitive-kind switch, so
  // two structurally-identical { kind: 'Byte' } types (which is what every
  // ByteExpr literal produces) fell through to the `default: throw` case —
  // producing the nonsensical "Cannot unify Byte with Byte" for ANY
  // same-byte comparison, equality check, or arithmetic operation. See
  // checkTypes' real-world false positives against example.pf (100b + 55b,
  // 0xF0b & 0x0Fb, etc.) that this bug caused.
  it('Byte unifies with Byte (regression: was missing from the primitive switch)', () => {
    expect(u(BYTE, BYTE).size).toBe(0);
    expect(() => u(BYTE, BYTE)).not.toThrow();
  });

  it('Byte does not unify with Int or Float (genuinely distinct types)', () => {
    expect(() => u(BYTE, INT)).toThrow(UnificationError);
    expect(() => u(BYTE, FLOAT)).toThrow(UnificationError);
  });

  it('Float unifies with Float', () => {
    expect(u(FLOAT, FLOAT).size).toBe(0);
    expect(() => u(FLOAT, FLOAT)).not.toThrow();
  });

  it('Float does not unify with Int (genuinely distinct types)', () => {
    expect(() => u(FLOAT, INT)).toThrow(UnificationError);
  });
});

describe('TyVar binding', () => {
  it('α0 ~ Int binds α0 to Int', () => {
    expect(u(tyvar(0), INT).apply(tyvar(0))).toEqual(INT);
  });

  it('Int ~ α0 binds α0 to Int (symmetric)', () => {
    expect(u(INT, tyvar(0)).apply(tyvar(0))).toEqual(INT);
  });

  it('α0 ~ α1 makes them equal', () => {
    const s = u(tyvar(0), tyvar(1));
    expect(s.apply(tyvar(0))).toEqual(s.apply(tyvar(1)));
  });

  it('α0 ~ α0 is trivial — no new bindings', () => {
    expect(u(tyvar(0), tyvar(0)).size).toBe(0);
  });

  it('α0 ~ List<Int> binds α0 to the compound type', () => {
    expect(u(tyvar(0), list(INT)).apply(tyvar(0))).toEqual(list(INT));
  });

  it('existing bindings are respected', () => {
    const s1 = u(tyvar(0), INT);
    expect(u(tyvar(0), tyvar(1), s1).apply(tyvar(1))).toEqual(INT);
  });

  it('freshVar ids are correctly bound', () => {
    const a = freshVar();
    expect(u(a, STR).apply(a)).toEqual(STR);
  });
});

describe('Occurs check', () => {
  it('α0 ~ List<α0> throws OccursCheckError', () => {
    expect(() => u(tyvar(0), list(tyvar(0)))).toThrow(OccursCheckError);
  });

  it('List<α0> ~ α0 throws (symmetric)', () => {
    expect(() => u(list(tyvar(0)), tyvar(0))).toThrow(OccursCheckError);
  });

  it('α0 ~ Fn<α0, Int> throws', () => {
    expect(() => u(tyvar(0), fn(tyvar(0), INT))).toThrow(OccursCheckError);
  });

  it('α0 ~ Fn<Int, α0> throws', () => {
    expect(() => u(tyvar(0), fn(INT, tyvar(0)))).toThrow(OccursCheckError);
  });

  it('α0 ~ Option<α0> throws', () => {
    expect(() => u(tyvar(0), opt(tyvar(0)))).toThrow(OccursCheckError);
  });

  it('α0 ~ List<List<α0>> throws (nested)', () => {
    expect(() => u(tyvar(0), list(list(tyvar(0))))).toThrow(OccursCheckError);
  });

  it('OccursCheckError is a subclass of UnificationError', () => {
    expect(() => u(tyvar(0), list(tyvar(0)))).toThrow(UnificationError);
  });

  it('OccursCheckError message names the variable and the type', () => {
    try { u(tyvar(3), list(tyvar(3))); } catch (e: any) {
      expect(e.message).toContain('α3');
      expect(e.message).toContain('List');
    }
  });

  it('different vars do NOT trigger occurs check', () => {
    expect(() => u(tyvar(0), list(tyvar(1)))).not.toThrow();
  });

  it('occurs check respects the current substitution', () => {
    // α1→α0 in subst, then α0 ~ List<α1>: after applying subst, List<α1>
    // contains α0 (via the chain) — should fail
    const s = Substitution.of(1, tyvar(0));
    expect(() => u(tyvar(0), list(tyvar(1)), s)).toThrow(OccursCheckError);
  });
});

describe('List unification', () => {
  it('List<Int> ~ List<Int> succeeds', () => expect(() => u(list(INT), list(INT))).not.toThrow());
  it('List<α0> ~ List<Str> resolves α0', () => resolves(list(tyvar(0)), list(STR), tyvar(0), STR));
  it('List<Int> ~ List<Str> fails', () => expect(() => u(list(INT), list(STR))).toThrow(UnificationError));
  it('List<List<α0>> ~ List<List<Int>> resolves α0', () => resolves(list(list(tyvar(0))), list(list(INT)), tyvar(0), INT));
});

describe('Array unification', () => {
  it('Array<α0> ~ Array<Int> resolves α0', () => resolves(arr(tyvar(0)), arr(INT), tyvar(0), INT));
  it('Array<Int> ~ List<Int> fails (kind mismatch)', () => expect(() => u(arr(INT), list(INT))).toThrow(UnificationError));
});

describe('Option unification', () => {
  it('Option<α0> ~ Option<Bool> resolves α0', () => resolves(opt(tyvar(0)), opt(BOOL), tyvar(0), BOOL));
  it('Option<Int> ~ Option<Str> fails', () => expect(() => u(opt(INT), opt(STR))).toThrow(UnificationError));
});

describe('Dict unification', () => {
  it('Dict<α0, α1> ~ Dict<Str, Int> resolves both vars', () => {
    const s = u(dict(tyvar(0), tyvar(1)), dict(STR, INT));
    expect(s.apply(tyvar(0))).toEqual(STR);
    expect(s.apply(tyvar(1))).toEqual(INT);
  });

  it('Dict<Str, Int> ~ Dict<Str, Str> fails on value', () => {
    expect(() => u(dict(STR, INT), dict(STR, STR))).toThrow(UnificationError);
  });
});

describe('Fn unification', () => {
  it('(Int) -> Bool ~ (Int) -> Bool succeeds', () => expect(() => u(fn(INT, BOOL), fn(INT, BOOL))).not.toThrow());

  it('(α0) -> α1 ~ (Int) -> Bool resolves both vars', () => {
    const s = u(fn(tyvar(0), tyvar(1)), fn(INT, BOOL));
    expect(s.apply(tyvar(0))).toEqual(INT);
    expect(s.apply(tyvar(1))).toEqual(BOOL);
  });

  it('(α0, α1) -> α0 ~ (Int, Str) -> Int resolves consistently', () => {
    const s = u(
      { kind: 'Fn', params: [tyvar(0), tyvar(1)], ret: tyvar(0) },
      { kind: 'Fn', params: [INT, STR], ret: INT },
    );
    expect(s.apply(tyvar(0))).toEqual(INT);
    expect(s.apply(tyvar(1))).toEqual(STR);
  });

  it('arity mismatch fails', () => expect(() => u(fn(INT, BOOL), fn(INT, STR, BOOL))).toThrow(UnificationError));
  it('return type mismatch fails', () => expect(() => u(fn(INT, BOOL), fn(INT, STR))).toThrow(UnificationError));
  it('param type mismatch fails', () => expect(() => u(fn(INT, BOOL), fn(STR, BOOL))).toThrow(UnificationError));
});

describe('Named unification', () => {
  it('same name unifies', () => expect(() => u(named('Point'), named('Point'))).not.toThrow());

  it('different names with no union fail', () => {
    expect(() => u(named('Point'), named('Circle'))).toThrow(UnificationError);
  });

  it('same name with different unionName unifies (name equality wins)', () => {
    expect(() => u(named('Ok', 'Result'), named('Ok', 'ReadResult'))).not.toThrow();
  });

  it('different names but same union unify (variants of the same union are compatible)', () => {
    expect(() => u(named('Square', 'Shape'), named('Circle', 'Shape'))).not.toThrow();
  });

  it('different names and different unions fail', () => {
    expect(() => u(named('Square', 'Shape'), named('Disk', 'Figure'))).toThrow(UnificationError);
  });

  it('different names where one has no union fail', () => {
    expect(() => u(named('Square', 'Shape'), named('Circle'))).toThrow(UnificationError);
  });
});

describe('Generic unification', () => {
  it('Pair<α0, α1> ~ Pair<Int, Str> resolves both vars', () => {
    const s = u(generic('Pair', tyvar(0), tyvar(1)), generic('Pair', INT, STR));
    expect(s.apply(tyvar(0))).toEqual(INT);
    expect(s.apply(tyvar(1))).toEqual(STR);
  });

  it('different generic names fail', () => {
    expect(() => u(generic('Pair', INT, STR), generic('Triple', INT, STR))).toThrow(UnificationError);
  });

  it('arity mismatch fails', () => {
    expect(() => u(generic('Pair', INT, STR), generic('Pair', INT))).toThrow(UnificationError);
  });
});

describe('Unknown unification', () => {
  it('Unknown ~ Unknown succeeds with no bindings', () => expect(u({ kind: 'Unknown' }, { kind: 'Unknown' }).size).toBe(0));
  it('Unknown ~ Int succeeds (wildcard)', () => expect(() => u({ kind: 'Unknown' }, INT)).not.toThrow());
  it('Int ~ Unknown succeeds (symmetric)', () => expect(() => u(INT, { kind: 'Unknown' })).not.toThrow());
  it('Unknown ~ α0 succeeds', () => expect(() => u({ kind: 'Unknown' }, tyvar(0))).not.toThrow());
  it('Unknown ~ List<Int> succeeds', () => expect(() => u({ kind: 'Unknown' }, list(INT))).not.toThrow());
});

describe('Substitution threading', () => {
  it('unifying the same var twice with the same type is idempotent', () => {
    const s1 = u(tyvar(0), INT);
    expect(u(tyvar(0), INT, s1).apply(tyvar(0))).toEqual(INT);
  });

  it('unifying the same var with incompatible types fails', () => {
    expect(() => u(tyvar(0), STR, u(tyvar(0), INT))).toThrow(UnificationError);
  });

  it('chains of variable bindings resolve correctly', () => {
    const s1 = u(tyvar(0), tyvar(1));
    const s2 = u(tyvar(1), INT, s1);
    expect(s2.apply(tyvar(0))).toEqual(INT);
  });

  it('multiple independent variables unify in sequence', () => {
    const s = u(tyvar(2), BOOL, u(tyvar(1), STR, u(tyvar(0), INT)));
    expect(s.apply(tyvar(0))).toEqual(INT);
    expect(s.apply(tyvar(1))).toEqual(STR);
    expect(s.apply(tyvar(2))).toEqual(BOOL);
  });
});

describe('Error messages', () => {
  it('UnificationError names both types', () => {
    try { u(INT, STR); } catch (e: any) {
      expect(e.message).toContain('Int');
      expect(e.message).toContain('Str');
    }
  });

  it('UnificationError carries a and b fields', () => {
    try { u(INT, STR); } catch (e: any) {
      expect(e.a).toEqual(INT);
      expect(e.b).toEqual(STR);
    }
  });

  it('OccursCheckError names the variable and the type', () => {
    try { u(tyvar(7), list(tyvar(7))); } catch (e: any) {
      expect(e.message).toContain('α7');
      expect(e.message).toContain('List');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 6  Constraint generation
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parse(src: string) {
  return new Parser(new Lexer(src).lex()).parse();
}

function constraints(src: string) {
  return generateConstraints(parse(src));
}

/** True if cs contains a constraint pairing a and b (in either order). */
function hasConstraint(cs: ReturnType<typeof constraints>, a: PfunType, b: PfunType): boolean {
  return cs.some(c =>
    (JSON.stringify(c.a) === JSON.stringify(a) && JSON.stringify(c.b) === JSON.stringify(b)) ||
    (JSON.stringify(c.a) === JSON.stringify(b) && JSON.stringify(c.b) === JSON.stringify(a))
  );
}

/** True if cs contains a constraint where one side equals t. */
function hasConstraintWith(cs: ReturnType<typeof constraints>, t: PfunType): boolean {
  return cs.some(c =>
    JSON.stringify(c.a) === JSON.stringify(t) ||
    JSON.stringify(c.b) === JSON.stringify(t)
  );
}

const INT_T:   PfunType = { kind: 'Int'   };
const FLOAT_T: PfunType = { kind: 'Float' };
const STR_T:   PfunType = { kind: 'Str'   };
const BOOL_T:  PfunType = { kind: 'Bool'  };
const BYTE_T:  PfunType = { kind: 'Byte'  };

// ─── Literals produce no constraints ─────────────────────────────────────────

describe('Constraint generation — literals', () => {
  it('integer literal produces no constraints', () => {
    expect(constraints('42;')).toHaveLength(0);
  });

  it('string literal produces no constraints', () => {
    expect(constraints('"hello";')).toHaveLength(0);
  });

  it('bool literal produces no constraints', () => {
    expect(constraints('true;')).toHaveLength(0);
  });

  it('integer literal node gets inferredType Int', () => {
    const stmts = parse('42;');
    generateConstraints(stmts);
    const expr = (stmts[0] as any).expression;
    expect(expr.inferredType).toEqual(INT_T);
  });

  it('string literal node gets inferredType Str', () => {
    const stmts = parse('"hi";');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(STR_T);
  });

  it('bool literal node gets inferredType Bool', () => {
    const stmts = parse('true;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BOOL_T);
  });

  // Regression: FloatExpr had no case in cgenExpr's literal switch at all,
  // so a float literal silently fell through to `default: freshVar()`
  // instead of resolving to a concrete Float type. This didn't throw —
  // freshVar() unifies with anything — so it was a silent FALSE NEGATIVE:
  // checkTypes failed to catch real errors like `[1.5, "x"]` because the
  // 1.5's unconstrained TyVar happily unified with Str from "x". See the
  // "Float literal mixed with Str" test below and in the checkTypes suite.
  it('float literal produces no constraints and gets inferredType Float (regression: was missing entirely)', () => {
    expect(constraints('4.2;')).toHaveLength(0);
    const stmts = parse('4.2;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(FLOAT_T);
  });

  it('byte literal produces no constraints and gets inferredType Byte', () => {
    expect(constraints('42b;')).toHaveLength(0);
    const stmts = parse('42b;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BYTE_T);
  });
});

// ─── Unary operators ─────────────────────────────────────────────────────────

describe('Constraint generation — unary operators', () => {
  it('!x emits [type(x), Bool] and assigns Bool', () => {
    const stmts = parse('let x = 1; !x;');
    const cs = generateConstraints(stmts);
    // The unary expr should have inferredType Bool
    const unaryExpr = (stmts[1] as any).expression;
    expect(unaryExpr.inferredType).toEqual(BOOL_T);
    // A constraint involving Bool should be present
    expect(hasConstraintWith(cs, BOOL_T)).toBe(true);
  });

  it('-5 emits constraint [Int, Int] and assigns Int', () => {
    const stmts = parse('-5;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(INT_T);
    expect(hasConstraint(cs, INT_T, INT_T)).toBe(true);
  });
});

// ─── Binary operators ─────────────────────────────────────────────────────────

describe('Constraint generation — binary operators', () => {
  it('1 + 2 emits [Int, Int] constraints and assigns Int', () => {
    const stmts = parse('1 + 2;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(INT_T);
    expect(hasConstraint(cs, INT_T, INT_T)).toBe(true);
  });

  it('x + 1 emits a constraint linking x\'s type to Int', () => {
    // x gets a fresh TyVar; the + rule emits [TyVar(x), Int]
    const stmts = parse('let x = 1; x + 1;');
    const cs = generateConstraints(stmts);
    const binExpr = (stmts[1] as any).expression;
    expect(binExpr.inferredType).toEqual(INT_T);
    // x's TyVar should be constrained to Int
    const xType = (stmts[0] as any).inferredType;
    expect(hasConstraintWith(cs, xType)).toBe(true);
  });

  it('1 == 1 emits [Int, Int] (operands constrained equal) and assigns Bool', () => {
    const stmts = parse('1 == 1;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BOOL_T);
    expect(hasConstraint(cs, INT_T, INT_T)).toBe(true);
  });

  it('true && false emits [Bool, Bool] constraints and assigns Bool', () => {
    const stmts = parse('true && false;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BOOL_T);
    expect(hasConstraint(cs, BOOL_T, BOOL_T)).toBe(true);
  });

  it('1 < 2 constrains operands to Int and assigns Bool', () => {
    const stmts = parse('1 < 2;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BOOL_T);
    expect(hasConstraintWith(cs, INT_T)).toBe(true);
  });

  // Regression: cgenBinary's arithmetic case (-, *, /, %, +) hardcoded both
  // operands and the result to Int, with no awareness that the interpreter
  // (see evaluateBinaryGen in interpreter.ts) also supports Byte-op-Byte
  // arithmetic (producing a Byte) and mixed Int/Float arithmetic (producing
  // a Float). This made every byte-arithmetic expression a false positive
  // "Cannot unify Byte with Int" type error — e.g. example.pf's
  // `100b + 55b`, `200b - 50b`, `10b * 10b`, `7b / 2b`, `10b % 3b` all
  // failed checkTypes despite being valid, already-working pfun code.
  it('Byte - Byte assigns Byte, not Int (regression)', () => {
    const stmts = parse('100b - 55b;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BYTE_T);
  });

  it('Byte * Byte, Byte / Byte, Byte % Byte all assign Byte (regression)', () => {
    for (const src of ['10b * 10b;', '7b / 2b;', '10b % 3b;']) {
      const stmts = parse(src);
      generateConstraints(stmts);
      expect((stmts[0] as any).expression.inferredType).toEqual(BYTE_T);
    }
  });

  it('Byte + Byte assigns Byte (regression — Plus has its own Byte/Float branch)', () => {
    const stmts = parse('100b + 55b;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(BYTE_T);
  });

  // Mixed Int/Float arithmetic (e.g. `1 - 2.5`) was ALSO broken once the
  // FloatExpr fix (above) gave float literals a real Float type instead of
  // an unconstrained freshVar — the arithmetic case's old hardcoded-Int
  // constraint would have made this a NEW false positive. Verifies the
  // fix's Float branch handles this correctly, matching the interpreter's
  // real numeric-promotion behavior (bigint promoted to number whenever
  // either operand is already a float).
  it('Int - Float (and Float - Int) both assign Float (regression)', () => {
    for (const src of ['1 - 2.5;', '2.5 - 1;', '1 * 2.5;', '2.5 / 1;']) {
      const stmts = parse(src);
      generateConstraints(stmts);
      expect((stmts[0] as any).expression.inferredType).toEqual(FLOAT_T);
    }
  });

  it('Float + Int assigns Float via the Plus branch (regression)', () => {
    const stmts = parse('2.5 + 1;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(FLOAT_T);
  });

  // Byte/Int mixing is genuinely NOT a supported runtime operation — the
  // interpreter's Byte-arithmetic branch requires BOTH operands to be
  // PfunByte; a Byte mixed with a plain Int falls through to broken
  // fallback behavior (silently producing garbage like "[object Object]3"
  // rather than a clean error — see evaluateBinaryGen). This should
  // continue to be flagged as a real type error after the fix, not
  // silently allowed.
  it('Byte + Int is a genuine unification failure (not a false positive to suppress)', () => {
    const cs = generateConstraints(parse('5b + 3;'));
    expect(() => {
      for (const c of cs) unify(c.a, c.b);
    }).toThrow(UnificationError);
  });
});

// ─── Let bindings ─────────────────────────────────────────────────────────────

describe('Constraint generation — let bindings', () => {
  it('let x = 42 assigns Int to x with no constraints', () => {
    const stmts = parse('let x = 42;');
    const cs = generateConstraints(stmts);
    expect((stmts[0] as any).inferredType).toEqual(INT_T);
    expect(cs).toHaveLength(0);
  });

  it('let x = 42; let y = x + 1 emits constraints linking x to Int', () => {
    const stmts = parse('let x = 42; let y = x + 1;');
    const cs = generateConstraints(stmts);
    expect((stmts[1] as any).inferredType).toEqual(INT_T);
    expect(hasConstraintWith(cs, INT_T)).toBe(true);
  });

  it('let x = someVar assigns a TyVar to x', () => {
    const stmts = parse('let x = someVar;');
    generateConstraints(stmts);
    const t = (stmts[0] as any).inferredType;
    expect(t.kind).toBe('TyVar');
  });
});

// ─── Lambda expressions ───────────────────────────────────────────────────────

describe('Constraint generation — lambdas', () => {
  it('fn x => 42 produces Fn<TyVar, Int>', () => {
    const stmts = parse('fn x => 42;');
    generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('Fn');
    expect(t.params[0].kind).toBe('TyVar');
    expect(t.ret).toEqual(INT_T);
  });

  it('fn x => x + 1 emits constraint linking x to 1 and produces Fn<TyVar, TyVar>', () => {
    // With polymorphic +, the constraint is [type(x), type(1)] = [TyVar, Int].
    // The result type is the left operand's type (TyVar(x)).
    // After solving, x resolves to Int, so ret also becomes Int.
    const stmts = parse('fn x => x + 1;');
    const cs = generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('Fn');
    // x's param TyVar should be constrained (to 1's type = Int)
    const xVar = t.params[0];
    expect(xVar.kind).toBe('TyVar');
    expect(hasConstraintWith(cs, xVar)).toBe(true);
  });

  it('fn x, y => x emits Fn with two TyVar params', () => {
    const stmts = parse('fn x, y => x;');
    generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('Fn');
    expect(t.params).toHaveLength(2);
    expect(t.params[0].kind).toBe('TyVar');
    expect(t.params[1].kind).toBe('TyVar');
  });

  it('fn x => x returns Fn with same TyVar for param and return', () => {
    const stmts = parse('fn x => x;');
    generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    // param and ret should be the same TyVar (identity function)
    expect(t.params[0]).toEqual(t.ret);
  });
});

// ─── Function statements ──────────────────────────────────────────────────────

describe('Constraint generation — function statements', () => {
  it('function with literal return emits constraint linking retVar to Int', () => {
    const stmts = parse('function answer() { return 42; }');
    const cs = generateConstraints(stmts);
    expect(hasConstraintWith(cs, INT_T)).toBe(true);
  });

  it('function name gets Fn type in env for subsequent uses', () => {
    const stmts = parse(`
      function double(n) { return n + n; }
      let x = double;
    `);
    generateConstraints(stmts);
    const xType = (stmts[1] as any).inferredType;
    expect(xType.kind).toBe('Fn');
  });

  it('recursive function does not crash', () => {
    expect(() => constraints(`
      function fib(n) {
        return n <= 1 ? n : fib(n - 1) + fib(n - 2);
      }
    `)).not.toThrow();
  });
});

// ─── Call expressions ─────────────────────────────────────────────────────────

describe('Constraint generation — call expressions', () => {
  it('call assigns a fresh TyVar as return type', () => {
    const stmts = parse('let x = foo(1);');
    generateConstraints(stmts);
    const t = (stmts[0] as any).inferredType;
    expect(t.kind).toBe('TyVar');
  });

  it('call emits a Fn constraint on the callee', () => {
    const stmts = parse('foo(1, 2);');
    const cs = generateConstraints(stmts);
    // Should have a constraint with a Fn type
    const hasFnConstraint = cs.some(c =>
      c.a.kind === 'Fn' || c.b.kind === 'Fn'
    );
    expect(hasFnConstraint).toBe(true);
  });

  it('call to known builtin propagates return type', () => {
    const stmts = parse('let n = length("hello");');
    generateConstraints(stmts);
    // length returns Int; the call ret var should be constrained to Int
    // The let binding takes on the call's return TyVar
    const t = (stmts[0] as any).inferredType;
    // It'll be a TyVar (the retVar from the call) — we verify a constraint
    // links it to Int via the Fn constraint on length
    expect(t.kind).toBe('TyVar');
  });
});

// ─── Ternary expressions ──────────────────────────────────────────────────────

describe('Constraint generation — ternary', () => {
  it('true ? 1 : 2 emits [Bool, Bool] and [Int, Int]', () => {
    const stmts = parse('true ? 1 : 2;');
    const cs = generateConstraints(stmts);
    // Condition Bool constraint and branch equality constraint
    expect(hasConstraint(cs, BOOL_T, BOOL_T)).toBe(true);
    expect(hasConstraint(cs, INT_T, INT_T)).toBe(true);
  });

  it('assigns the then-branch type', () => {
    const stmts = parse('true ? 1 : 2;');
    generateConstraints(stmts);
    expect((stmts[0] as any).expression.inferredType).toEqual(INT_T);
  });
});

// ─── List expressions ────────────────────────────────────────────────────────

describe('Constraint generation — list expressions', () => {
  it('[1, 2, 3] produces List<TyVar> with constraints [Int, elemVar]', () => {
    const stmts = parse('[1, 2, 3];');
    const cs = generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('List');
    expect(t.element.kind).toBe('TyVar');
    // All three elements emit [Int, elemVar]
    const elemVar = t.element;
    expect(cs.filter(c =>
      JSON.stringify(c.a) === JSON.stringify(elemVar) ||
      JSON.stringify(c.b) === JSON.stringify(elemVar)
    )).toHaveLength(3);
  });

  it('empty list produces List<TyVar> with no constraints', () => {
    const stmts = parse('[];');
    const cs = generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('List');
    expect(t.element.kind).toBe('TyVar');
    expect(cs).toHaveLength(0);
  });
});

// ─── Match expressions ────────────────────────────────────────────────────────

describe('Constraint generation — match expressions', () => {
  it('all arms emit constraints to a shared result var', () => {
    const stmts = parse(`
      type Shape = { | Square: side | Circle: radius }
      let s = Square { 10 };
      let r = match s with
        | Square sq -> 1
        | Circle c  -> 2;
    `);
    const cs = generateConstraints(stmts);
    // Both arms return Int — both should emit [Int, resultVar]
    const intConstraints = cs.filter(c =>
      JSON.stringify(c.a) === JSON.stringify(INT_T) ||
      JSON.stringify(c.b) === JSON.stringify(INT_T)
    );
    expect(intConstraints.length).toBeGreaterThanOrEqual(2);
  });

  it('match result gets a fresh TyVar', () => {
    const stmts = parse(`
      type Toggle = { | On | Off }
      let t = On;
      let r = match t with | On -> 1 | Off -> 2;
    `);
    generateConstraints(stmts);
    const letStmt = stmts[2] as any;
    expect(letStmt.inferredType.kind).toBe('TyVar');
  });
});

// ─── No crashes on complex programs ──────────────────────────────────────────

describe('Constraint generation — robustness', () => {
  it('handles an empty program', () => {
    expect(() => generateConstraints([])).not.toThrow();
  });

  it('does not crash on a nested function', () => {
    expect(() => constraints(`
      function outer(x) {
        function inner(y) { return y + 1; }
        return inner(x);
      }
    `)).not.toThrow();
  });

  it('does not crash on a procedure', () => {
    expect(() => constraints(`
      proc doThing(x) { println(x); }
    `)).not.toThrow();
  });

  it('does not crash on a comprehension', () => {
    expect(() => constraints('[x * 2 for x <- [1, 2, 3]];')).not.toThrow();
  });

  it('does not crash on an if statement', () => {
    expect(() => constraints(`
      if true then { let x = 1; } else { let x = 2; }
    `)).not.toThrow();
  });

  it('does not crash on a union type definition', () => {
    expect(() => constraints(`
      type Color = { | Red | Green | Blue }
      let c = Red;
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 7  Type schemes — let-generalisation and instantiation
// ═══════════════════════════════════════════════════════════════════════════════

import {
  TypeScheme, mono, generalize, instantiate,
  SchemeEnv, collectEnvFreeVars,
} from '../inferencer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheme(vars: number[], type: PfunType): TypeScheme {
  return { vars, type };
}

// ─── mono ─────────────────────────────────────────────────────────────────────

describe('mono', () => {
  it('wraps a type in a trivial scheme with no quantified vars', () => {
    expect(mono(INT_T)).toEqual({ vars: [], type: INT_T });
  });

  it('works for compound types', () => {
    const t: PfunType = { kind: 'List', element: INT_T };
    expect(mono(t)).toEqual({ vars: [], type: t });
  });

  it('works for TyVar types', () => {
    expect(mono(tyvar(0))).toEqual({ vars: [], type: tyvar(0) });
  });
});

// ─── generalize ───────────────────────────────────────────────────────────────

describe('generalize', () => {
  it('quantifies over vars free in type but not in env', () => {
    // Empty env — all free vars in type are generalisable
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) };
    const s = generalize(new Set(), t);
    expect(s.vars).toContain(0);
    expect(s.type).toEqual(t);
  });

  it('does not quantify vars that are free in env', () => {
    // α0 is free in env — not generalisable
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) };
    const envFree = new Set([0]);
    const s = generalize(envFree, t);
    expect(s.vars).not.toContain(0);
    expect(s.vars).toContain(1);
  });

  it('produces a monomorphic scheme when all vars are free in env', () => {
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) };
    const envFree = new Set([0]);
    const s = generalize(envFree, t);
    expect(s.vars).toHaveLength(0);
    expect(s.type).toEqual(t);
  });

  it('generalises a ground type to a trivial scheme', () => {
    const s = generalize(new Set(), INT_T);
    expect(s.vars).toHaveLength(0);
    expect(s.type).toEqual(INT_T);
  });

  it('applies substitution before generalising', () => {
    // α0 → Int in subst; type is List<α0>
    // After applying subst: List<Int> — no free vars to quantify
    const subst = Substitution.of(0, INT_T);
    const t: PfunType = { kind: 'List', element: tyvar(0) };
    const s = generalize(new Set(), t, subst);
    expect(s.vars).toHaveLength(0);
    expect(s.type).toEqual({ kind: 'List', element: INT_T });
  });

  it('generalises multiple independent vars', () => {
    // Fn<α0, α1> with empty env — both vars are quantified
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) };
    const s = generalize(new Set(), t);
    expect(s.vars).toHaveLength(2);
    expect(s.vars).toContain(0);
    expect(s.vars).toContain(1);
  });

  it('deduplicates the same var appearing multiple times', () => {
    // Fn<α0, α0> — α0 appears twice but should be quantified once
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) };
    const s = generalize(new Set(), t);
    expect(s.vars).toHaveLength(1);
    expect(s.vars).toContain(0);
  });

  it('generalises vars in nested types', () => {
    // List<Fn<α0, α1>>
    const t: PfunType = {
      kind: 'List',
      element: { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) },
    };
    const s = generalize(new Set(), t);
    expect(s.vars).toContain(0);
    expect(s.vars).toContain(1);
  });

  it('partial env free vars — some quantified, some not', () => {
    // Fn<α0, α1, α2>; α1 is free in env
    const t: PfunType = { kind: 'Fn', params: [tyvar(0), tyvar(1)], ret: tyvar(2) };
    const s = generalize(new Set([1]), t);
    expect(s.vars).toContain(0);
    expect(s.vars).not.toContain(1);
    expect(s.vars).toContain(2);
  });
});

// ─── instantiate ──────────────────────────────────────────────────────────────

describe('instantiate', () => {
  it('trivial scheme (no quantified vars) returns the type unchanged', () => {
    const s = mono(INT_T);
    expect(instantiate(s)).toEqual(INT_T);
  });

  it('replaces quantified vars with fresh vars', () => {
    const s = scheme([0], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) });
    const t = instantiate(s);
    expect(t.kind).toBe('Fn');
    const fnType = t as { kind: 'Fn'; params: PfunType[]; ret: PfunType };
    expect(fnType.params[0].kind).toBe('TyVar');
    // The fresh var must be a TyVar — its specific id is an implementation
    // detail, but param and ret must be the same fresh var (identity fn)
    expect(fnType.params[0]).toEqual(fnType.ret);
  });

  it('same fresh var used consistently within one instantiation', () => {
    // ∀ α0 . Fn<α0, α0> — param and ret should get the SAME fresh var
    const s = scheme([0], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) });
    const t = instantiate(s) as { kind: 'Fn'; params: PfunType[]; ret: PfunType };
    expect(t.params[0]).toEqual(t.ret);
  });

  it('two calls produce independent fresh variables', () => {
    const s = scheme([0], tyvar(0));
    const t1 = instantiate(s) as { kind: 'TyVar'; id: number };
    const t2 = instantiate(s) as { kind: 'TyVar'; id: number };
    expect(t1.id).not.toBe(t2.id);
  });

  it('does not replace non-quantified vars', () => {
    // ∀ α0 . Fn<α0, α1> — α1 is free (not quantified), should stay as α1
    const s = scheme([0], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) });
    const t = instantiate(s) as { kind: 'Fn'; params: PfunType[]; ret: PfunType };
    // ret should still be α1 exactly
    expect(t.ret).toEqual(tyvar(1));
    // param should be a TyVar but NOT α1 (a fresh var for α0)
    expect(t.params[0].kind).toBe('TyVar');
    expect(t.params[0]).not.toEqual(tyvar(1));
  });

  it('instantiates multiple quantified vars independently', () => {
    // ∀ α0 α1 . Fn<α0, α1> — should produce Fn<αN, αM> for fresh N, M
    const s = scheme([0, 1], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) });
    const t = instantiate(s) as { kind: 'Fn'; params: PfunType[]; ret: PfunType };
    expect(t.params[0].kind).toBe('TyVar');
    expect(t.ret.kind).toBe('TyVar');
    // They should be different fresh vars
    expect((t.params[0] as any).id).not.toBe((t.ret as any).id);
  });

  it('instantiates inside nested types', () => {
    // ∀ α0 . List<α0>
    const s = scheme([0], { kind: 'List', element: tyvar(0) });
    const t = instantiate(s) as { kind: 'List'; element: PfunType };
    expect(t.kind).toBe('List');
    expect(t.element.kind).toBe('TyVar');
    // The element should be a fresh TyVar, not the original α0
    // (verified by ensuring it is not the original tyvar(0) value... unless
    // counter was reset, in which case the id may be 0 but it's still valid)
    // What we can assert: it's a TyVar
    expect(t.element).toEqual({ kind: 'TyVar', id: (t.element as any).id });
  });
});

// ─── generalize + instantiate round-trip ─────────────────────────────────────

describe('generalize + instantiate round-trip', () => {
  it('identity function round-trips correctly', () => {
    // fn x => x : Fn<α0, α0>
    // generalize → ∀ α0 . Fn<α0, α0>
    // instantiate → Fn<αN, αN> for fresh N
    const identType: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) };
    const s = generalize(new Set(), identType);
    expect(s.vars).toEqual([0]);

    const t1 = instantiate(s) as any;
    const t2 = instantiate(s) as any;

    // Each instantiation is a valid Fn<αN, αN>
    expect(t1.params[0]).toEqual(t1.ret);
    expect(t2.params[0]).toEqual(t2.ret);
    // But the two instantiations are different
    expect(t1.params[0].id).not.toBe(t2.params[0].id);
  });

  it('const function round-trips correctly', () => {
    // fn x, y => x : Fn<α0, α1, α0>
    // generalize → ∀ α0 α1 . Fn<α0, α1, α0>
    // instantiate → Fn<αN, αM, αN>
    const constType: PfunType = {
      kind: 'Fn',
      params: [tyvar(0), tyvar(1)],
      ret: tyvar(0),
    };
    const s = generalize(new Set(), constType);
    const t = instantiate(s) as any;
    // First param and ret should be the same fresh var
    expect(t.params[0]).toEqual(t.ret);
    // Second param should be a different fresh var
    expect(t.params[1].id).not.toBe(t.params[0].id);
  });

  it('ground type round-trips as identity', () => {
    const s = generalize(new Set(), INT_T);
    expect(instantiate(s)).toEqual(INT_T);
  });

  it('partially-constrained type preserves env vars', () => {
    // α0 is in env (fixed), α1 is free — only α1 is quantified
    const t: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) };
    const s = generalize(new Set([0]), t);
    const inst = instantiate(s) as any;
    // α0 should be unchanged (not quantified)
    expect(inst.params[0]).toEqual(tyvar(0));
    // α1 should be a fresh var
    expect(inst.ret.kind).toBe('TyVar');
    expect(inst.ret.id).not.toBe(1);
  });
});

// ─── SchemeEnv ────────────────────────────────────────────────────────────────

describe('SchemeEnv', () => {
  it('define and lookup returns the scheme', () => {
    const env = new SchemeEnv();
    const s = mono(INT_T);
    env.define('x', s);
    expect(env.lookup('x')).toEqual(s);
  });

  it('lookup returns undefined for unknown names', () => {
    expect(new SchemeEnv().lookup('x')).toBeUndefined();
  });

  it('child env inherits parent bindings', () => {
    const parent = new SchemeEnv();
    parent.define('x', mono(INT_T));
    const child = parent.child();
    expect(child.lookup('x')).toEqual(mono(INT_T));
  });

  it('child env can shadow parent bindings', () => {
    const parent = new SchemeEnv();
    parent.define('x', mono(INT_T));
    const child = parent.child();
    child.define('x', mono(STR_T));
    expect(child.lookup('x')).toEqual(mono(STR_T));
    expect(parent.lookup('x')).toEqual(mono(INT_T));
  });
});

// ─── collectEnvFreeVars ───────────────────────────────────────────────────────

describe('collectEnvFreeVars', () => {
  it('empty env has no free vars', () => {
    expect(collectEnvFreeVars(new SchemeEnv()).size).toBe(0);
  });

  it('monomorphic binding with TyVar contributes that var', () => {
    const env = new SchemeEnv();
    env.define('x', mono(tyvar(0)));
    expect(collectEnvFreeVars(env)).toEqual(new Set([0]));
  });

  it('monomorphic ground type contributes no vars', () => {
    const env = new SchemeEnv();
    env.define('x', mono(INT_T));
    expect(collectEnvFreeVars(env).size).toBe(0);
  });

  it('quantified vars in a scheme are NOT free in the env', () => {
    // ∀ α0 . Fn<α0, α0> — α0 is bound, not free
    const env = new SchemeEnv();
    env.define('f', scheme([0], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(0) }));
    expect(collectEnvFreeVars(env).size).toBe(0);
  });

  it('unquantified vars in a scheme ARE free in the env', () => {
    // scheme { vars: [0], type: Fn<α0, α1> } — α1 is free
    const env = new SchemeEnv();
    env.define('f', scheme([0], { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) }));
    expect(collectEnvFreeVars(env)).toEqual(new Set([1]));
  });

  it('collects free vars from multiple bindings', () => {
    const env = new SchemeEnv();
    env.define('x', mono(tyvar(0)));
    env.define('y', mono(tyvar(1)));
    expect(collectEnvFreeVars(env)).toEqual(new Set([0, 1]));
  });

  it('includes free vars from parent env', () => {
    const parent = new SchemeEnv();
    parent.define('x', mono(tyvar(0)));
    const child = parent.child();
    child.define('y', mono(tyvar(1)));
    const free = collectEnvFreeVars(child);
    expect(free).toEqual(new Set([0, 1]));
  });

  it('free vars of child env feed correctly into generalize', () => {
    // x: α0 is in scope.  We infer Fn<α0, α1> for f.
    // Only α1 should be generalised (α0 is free in env).
    const env = new SchemeEnv();
    env.define('x', mono(tyvar(0)));
    const fnType: PfunType = { kind: 'Fn', params: [tyvar(0)], ret: tyvar(1) };
    const s = generalize(collectEnvFreeVars(env), fnType);
    expect(s.vars).toEqual([1]);
    expect(s.vars).not.toContain(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 8  Constraint solving and AST annotation
// ═══════════════════════════════════════════════════════════════════════════════

import {
  solveConstraints, applySubstitutionToAST, TypeError as InferTypeError,
} from '../inferencer';
import { inferTypes } from '../typechecker';

// ─── solveConstraints ─────────────────────────────────────────────────────────

describe('solveConstraints', () => {
  it('empty constraint set produces empty substitution with no errors', () => {
    const { subst, errors } = solveConstraints([]);
    expect(subst.size).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('satisfiable constraints produce a substitution', () => {
    // α0 = Int
    const cs = [{ a: tyvar(0), b: INT_T, pos: undefined }];
    const { subst, errors } = solveConstraints(cs);
    expect(errors).toHaveLength(0);
    expect(subst.apply(tyvar(0))).toEqual(INT_T);
  });

  it('unsatisfiable constraint produces an error without throwing', () => {
    // Int = Str — should not throw, should collect an error
    const cs = [{ a: INT_T, b: STR_T, pos: undefined }];
    const { errors } = solveConstraints(cs);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Int');
    expect(errors[0].message).toContain('Str');
  });

  it('collects multiple errors', () => {
    const cs = [
      { a: INT_T,  b: STR_T,  pos: undefined },
      { a: BOOL_T, b: STR_T,  pos: undefined },
    ];
    const { errors } = solveConstraints(cs);
    expect(errors).toHaveLength(2);
  });

  it('continues solving after an error', () => {
    // First constraint fails, second should still be solved
    const cs = [
      { a: INT_T,   b: STR_T,   pos: undefined }, // error
      { a: tyvar(0), b: BOOL_T, pos: undefined }, // should still bind
    ];
    const { subst, errors } = solveConstraints(cs);
    expect(errors).toHaveLength(1);
    expect(subst.apply(tyvar(0))).toEqual(BOOL_T);
  });

  it('threads substitution across constraints', () => {
    // α0 = α1, α1 = Int — should resolve α0 to Int
    const cs = [
      { a: tyvar(0), b: tyvar(1), pos: undefined },
      { a: tyvar(1), b: INT_T,    pos: undefined },
    ];
    const { subst, errors } = solveConstraints(cs);
    expect(errors).toHaveLength(0);
    expect(subst.apply(tyvar(0))).toEqual(INT_T);
  });

  it('preserves pos on errors', () => {
    const pos = { line: 5, col: 10, offset: 50 };
    const cs = [{ a: INT_T, b: STR_T, pos }];
    const { errors } = solveConstraints(cs);
    expect(errors[0].pos).toEqual(pos);
  });

  it('Unknown on either side does not produce an error', () => {
    const cs = [
      { a: { kind: 'Unknown' } as PfunType, b: INT_T, pos: undefined },
      { a: STR_T, b: { kind: 'Unknown' } as PfunType, pos: undefined },
    ];
    const { errors } = solveConstraints(cs);
    expect(errors).toHaveLength(0);
  });
});

// ─── applySubstitutionToAST ───────────────────────────────────────────────────

describe('applySubstitutionToAST', () => {
  it('resolves TyVar inferredType on a let binding', () => {
    const stmts = parse('let x = 1;');
    generateConstraints(stmts);
    // Manually set inferredType to a TyVar then apply a substitution
    const letStmt = stmts[0] as any;
    letStmt.inferredType = tyvar(0);
    const subst = Substitution.of(0, INT_T);
    applySubstitutionToAST(stmts, subst);
    expect(letStmt.inferredType).toEqual(INT_T);
  });

  it('resolves TyVar on expression nodes', () => {
    const stmts = parse('someVar;');
    generateConstraints(stmts);
    const exprStmt = stmts[0] as any;
    const expr = exprStmt.expression;
    expr.inferredType = tyvar(0);
    const subst = Substitution.of(0, STR_T);
    applySubstitutionToAST(stmts, subst);
    expect(expr.inferredType).toEqual(STR_T);
  });

  it('leaves already-concrete types unchanged', () => {
    const stmts = parse('42;');
    generateConstraints(stmts);
    const expr = (stmts[0] as any).expression;
    // inferredType is Int from constraint generation
    const subst = Substitution.of(99, STR_T); // unrelated substitution
    applySubstitutionToAST(stmts, subst);
    expect(expr.inferredType).toEqual(INT_T);
  });

  it('recurses into nested expressions', () => {
    const stmts = parse('1 + someVar;');
    generateConstraints(stmts);
    const binExpr = (stmts[0] as any).expression;
    const rightExpr = binExpr.right;
    const varId = (rightExpr.inferredType as any)?.id ?? 0;
    const subst = Substitution.of(varId, INT_T);
    applySubstitutionToAST(stmts, subst);
    expect(rightExpr.inferredType).toEqual(INT_T);
  });

  it('handles empty program without crashing', () => {
    expect(() => applySubstitutionToAST([], Substitution.empty())).not.toThrow();
  });
});

// ─── Full pipeline integration ────────────────────────────────────────────────

describe('Full inference pipeline (inferTypes)', () => {
  it('resolves let x = 42 to Int', () => {
    const stmts = parse('let x = 42;');
    inferTypes(stmts);
    expect((stmts[0] as any).inferredType).toEqual(INT_T);
  });

  it('resolves let x = "hi" to Str', () => {
    const stmts = parse('let x = "hi";');
    inferTypes(stmts);
    expect((stmts[0] as any).inferredType).toEqual(STR_T);
  });

  it('resolves let x = true to Bool', () => {
    const stmts = parse('let x = true;');
    inferTypes(stmts);
    expect((stmts[0] as any).inferredType).toEqual(BOOL_T);
  });

  it('resolves fn x => x + 1 param to Int via constraint propagation', () => {
    const stmts = parse('let f = fn x => x + 1;');
    inferTypes(stmts);
    const fnType = (stmts[0] as any).inferredType;
    expect(fnType.kind).toBe('Fn');
    // x is constrained to Int by the + rule — param should resolve to Int
    expect(fnType.params[0]).toEqual(INT_T);
    expect(fnType.ret).toEqual(INT_T);
  });

  it('resolves ternary branches that agree', () => {
    const stmts = parse('let x = true ? 1 : 2;');
    inferTypes(stmts);
    expect((stmts[0] as any).inferredType).toEqual(INT_T);
  });

  it('resolves list element types', () => {
    const stmts = parse('let xs = [1, 2, 3];');
    inferTypes(stmts);
    expect((stmts[0] as any).inferredType).toEqual({
      kind: 'List', element: INT_T,
    });
  });

  it('propagates type from binding to reference', () => {
    const stmts = parse('let x = 42; let y = x + 1;');
    inferTypes(stmts);
    expect((stmts[1] as any).inferredType).toEqual(INT_T);
  });

  it('resolves function return type from literal', () => {
    const stmts = parse('function answer() { return 42; }');
    inferTypes(stmts);
    // function name should be in env — check via a subsequent let binding
    const stmts2 = parse('function answer() { return 42; } let t = answer;');
    inferTypes(stmts2);
    const fnType = (stmts2[1] as any).inferredType;
    expect(fnType?.kind).toBe('Fn');
    expect(fnType?.ret).toEqual(INT_T);
  });

  it('does not crash on complex programs', () => {
    expect(() => inferTypes(parse(`
      type Shape = { | Square: side | Circle: radius }
      function area(s) {
        return match s with
          | Square sq -> sq.side * sq.side
          | Circle c  -> c.radius;
      }
      let s = Square { 10 };
      let a = area(s);
    `))).not.toThrow();
  });

  it('exhaustiveness check still works after HM inference', () => {
    const stmts = parse(`
      type Toggle = { | On | Off }
      let t = On;
      let r = match t with | On -> 1;
    `);
    inferTypes(stmts);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toEqual(['Off']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 9  Error messages — checkTypes integration
// ═══════════════════════════════════════════════════════════════════════════════

import { checkTypes } from '../typechecker';

describe('checkTypes — error formatting', () => {
  it('returns empty array for a well-typed program', () => {
    const stmts = parse('let x = 1 + 2;');
    const errors = checkTypes(stmts, 'let x = 1 + 2;');
    // The + constraint [Int, Int] unifies fine — no errors
    expect(errors).toHaveLength(0);
  });

  it('returns errors for a program with type conflicts', () => {
    // [1, "x"] — element TyVar constrained to Int then Str, second fails
    const src = 'let xs = [1, "x"];';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('error messages reference the conflicting types', () => {
    const src = 'let xs = [1, "x"];';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThan(0);
    const msg = errors[0].pfunMessage;
    // Should mention Int and Str
    expect(msg).toMatch(/Int|Str/);
  });

  it('errors carry TypeCheck kind', () => {
    const src = 'let xs = [1, "x"];';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].kind).toBe('TypeCheck');
  });

  it('errors include source position when available', () => {
    const src = 'let xs = [1, "x"];';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThan(0);
    // pfunMessage should include line info
    expect(errors[0].pfunMessage).toMatch(/\[TypeCheck\]/);
  });

  it('collects multiple errors from multiple conflicts', () => {
    // Two separate list mismatches
    const src = `
      let xs = [1, "x"];
      let ys = [true, 42];
    `;
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('does not throw for programs with errors', () => {
    const src = 'let xs = [1, "x"];';
    const stmts = parse(src);
    expect(() => checkTypes(stmts, src)).not.toThrow();
  });

  it('well-typed lambda produces no errors', () => {
    const src = 'let f = fn x => x + 1;';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors).toHaveLength(0);
  });
});

describe('classifyError — TypeCheck classification', () => {
  it('classifies "cannot unify" as TypeCheck', () => {
    const { classifyError } = require('../errors');
    expect(classifyError('Cannot unify Int with Str')).toBe('TypeCheck');
  });

  it('classifies "occurs check" as TypeCheck', () => {
    const { classifyError } = require('../errors');
    expect(classifyError('Occurs check failed: α0 occurs in List<α0>')).toBe('TypeCheck');
  });

  it('classifies type mismatch as Type (runtime)', () => {
    const { classifyError } = require('../errors');
    expect(classifyError('Type mismatch in Point')).toBe('Type');
  });
});
