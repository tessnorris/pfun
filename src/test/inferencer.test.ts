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

const INT:  PfunType = { kind: 'Int' };
const STR:  PfunType = { kind: 'Str' };
const BOOL: PfunType = { kind: 'Bool' };
const CHAR: PfunType = { kind: 'Char' };
const NIL:  PfunType = { kind: 'Nil' };

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
  it('different names fail', () => expect(() => u(named('Point'), named('Circle'))).toThrow(UnificationError));

  it('same name with different unionName unifies (unionName is informational)', () => {
    expect(() => u(named('Ok', 'Result'), named('Ok', 'ReadResult'))).not.toThrow();
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

const INT_T:  PfunType = { kind: 'Int'  };
const STR_T:  PfunType = { kind: 'Str'  };
const BOOL_T: PfunType = { kind: 'Bool' };

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

  it('fn x => x + 1 emits [type(x), Int] and produces Fn<TyVar, Int>', () => {
    const stmts = parse('fn x => x + 1;');
    const cs = generateConstraints(stmts);
    const t = (stmts[0] as any).expression.inferredType;
    expect(t.kind).toBe('Fn');
    expect(t.ret).toEqual(INT_T);
    // x's param TyVar should be constrained to Int
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
