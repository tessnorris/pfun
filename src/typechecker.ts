// src/typechecker.ts
// Orchestration layer for Pfun's type checking: runs Hindley-Milner
// constraint-based inference (inferencer.ts) and static match-exhaustiveness
// checking, and exposes them as the public API consumed by main.ts /
// interpreter.ts (checkTypes) and by tests (inferTypes).
//
// This file used to also contain a separate, simpler "first-pass" type
// inferencer (literals, operators, bindings, etc., annotating UNKNOWN where
// it couldn't resolve something) that ran before the HM inferencer on every
// call. That pass's type-inference work was fully redundant with
// inferencer.ts's own constraint generation — every node it visited got
// immediately overwritten by inferencer.ts's own cgenExpr/cgenStmt walk, and
// inferencer.ts's coverage was a strict superset (see project history for
// the investigation that established this). The ONE thing that first pass
// did that inferencer.ts does not is compute `missingVariants` on MatchExpr
// nodes for static exhaustiveness checking — that's been kept, narrowed
// down to just what it needs, as checkExhaustiveness() below.
//
// Usage:
//   import { inferTypes } from './typechecker';
//   inferTypes(ast);   // mutates nodes in place

import { Expr, Stmt, PfunType } from './ast';
import { SourcePos } from './lexer';
import { generateConstraints, solveConstraints, applySubstitutionToAST, TypeImportResolver } from './inferencer';
import { PfunError, buildPfunError } from './errors';

/** One union's variant descriptors, exactly as UnionTypeStmt/RegistryType
 *  already carry them — name plus its fields' names (fields' names alone
 *  are enough to know variant *count*, which is all exhaustiveness needs;
 *  field *types* are irrelevant here). */
export type UnionVariants = { name: string; fields: string[] }[];

/** A module's exported unions, keyed by union name — the exhaustiveness
 *  analogue of procedureCheck.ts's ImportTable / inferencer.ts's
 *  TypeImportTable. Supplied by the whole-program driver
 *  (wholeProgramCheck.ts), extracted from a module's own UnionTypeStmt
 *  exports. */
export type UnionImportTable = Map<string, UnionVariants>;

/** Resolves an import to that module's exported unions. Mirrors
 *  procedureCheck.ts's ModuleImportResolver / inferencer.ts's
 *  TypeImportResolver exactly (same null-means-"fall back to permissive
 *  treatment" contract — a union this pass can't resolve cross-module
 *  simply never gets registered, so a match on it is silently skipped,
 *  same as today's behavior for any union this pass doesn't know about). */
export type UnionModuleResolver = (importPath: string, pos: SourcePos | undefined) => UnionImportTable | null;

// ─── Exhaustiveness-only union registry ────────────────────────────────────
//
// Deliberately narrower than a general type registry: it only tracks
// user-defined union types (via UnionTypeStmt) and their variant names —
// nothing about plain records, singletons, or builtin unions (Option,
// DbResult, DbValue, etc). Builtin unions are intentionally excluded, same
// as the pass this replaces: their exhaustiveness is checked at runtime
// (see interpreter.ts's evaluateMatchGen) instead, since this pass has no
// visibility into builtin type registration at all.

class UnionRegistry {
  private unions = new Map<string, Set<string>>();

  registerUnion(unionName: string, variants: { name: string; fields: string[] }[]): void {
    this.unions.set(unionName, new Set(variants.map(v => v.name)));
  }

  /** Returns the full set of variant names for a union, or null if unknown. */
  variantsOf(unionName: string): Set<string> | null {
    return this.unions.get(unionName) ?? null;
  }
}

// ─── Static exhaustiveness checking ────────────────────────────────────────
//
// Walks the AST looking for MatchExpr nodes whose subject resolves (via
// inferencer.ts's inferredType, which must already be set — see
// checkExhaustiveness's docblock) to a Named type with a unionName that's a
// user-defined union. If the match has no wildcard arm and doesn't cover
// every variant, annotates expr.missingVariants with the uncovered names.
//
// Registers every UnionTypeStmt in the program into `registry`, regardless
// of where in the statement tree it appears (top level, inside a function
// body, inside a block, etc.) — run as its own complete pass BEFORE the
// exhaustiveness-checking walk below, so that a union type referenced
// earlier in the file than its own declaration is still found. (This is
// the fix for the forward-reference gap that existed when registration and
// checking were interleaved in a single top-to-bottom walk — see project
// history.) UnionTypeStmt only ever appears at a statement position, never
// nested inside an expression, so this only needs to walk statements.
//
// Also registers unions reachable via ImportStmts, when `resolver` is
// supplied (by the whole-program driver, wholeProgramCheck.ts) — the
// cross-module analogue, needed so a match on a value of an IMPORTED
// union type gets checked too, not just locally-declared ones. Without a
// resolver (the default), ImportStmts are skipped entirely, preserving
// this pass's original, pre-cross-module-exhaustiveness behavior exactly:
// a match on an imported union's value was never statically checkable
// before (the union's variant list was never knowable at all, since it
// lived in another file this pass never looked at), same end state.
function registerAllUnions(stmts: Stmt[], registry: UnionRegistry, resolver?: UnionModuleResolver): void {
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'UnionTypeStmt':  registry.registerUnion(s.name, s.variants); break;
      case 'IfStmt':         walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':      s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':  s.body.forEach(walk); break;
      case 'ExportStmt':     walk(s.declaration); break;
      case 'ImportStmt': {
        if (!resolver) break;
        const table = resolver(s.path, s.pos);
        if (!table) break;
        // Registering is correct for ALL import kinds (named, namespace,
        // star) identically here, unlike procedureCheck.ts/inferencer.ts's
        // per-kind binding logic: a union's *registration* (its name and
        // variant list, for exhaustiveness purposes) doesn't depend on
        // how the importing file refers to it by name — only the
        // MatchExpr subject's resolved `unionName` (already computed by
        // inferencer.ts, including correctly through namespace-qualified
        // access — see inferencer.ts's GetExpr handling) determines which
        // registered union a given match is checked against. So every
        // union this import COULD make reachable gets registered, every
        // time, regardless of import kind.
        for (const [unionName, variants] of table) registry.registerUnion(unionName, variants);
        break;
      }
      // Every other statement type cannot contain a UnionTypeStmt.
    }
  }
  for (const s of stmts) walk(s);
}

// Two known, deliberate limitations (both pre-existing — i.e. true of the
// pass this replaces too, not a new regression):
//   - Builtin unions (Option, DbResult, DbValue, ...) are never flagged
//     here; only interpreter.ts's runtime check covers those.
// ─── Provable-guard exhaustiveness for non-union subjects ─────────────────
//
// The union-coverage check above only ever applies to a known union. For
// every other CONCRETELY KNOWN subject type (Bool, Int, Float, Byte, Str,
// Char, or a plain non-union record), there's no enumerable "variant" list
// to check coverage against — but a match can still run out of arms at
// runtime if every guard fails. The baseline policy is purely syntactic
// and type-agnostic: such a match is exhaustive if SOME arm (anywhere,
// tagged or not) has no guard at all, since reaching that arm always
// succeeds — see hasUnconditionalArm below.
//
// For Bool/Int/Float/Byte specifically, that baseline is relaxed one step
// further: a small, deliberately CONSERVATIVE grammar of guard shapes is
// recognized (single comparisons against a literal, plus boolean identity
// checks — see recognizeBoolGuard/recognizeNumericGuard), and their
// combined coverage is checked against the type's actual domain. This is
// what lets `| b -> ... | !b -> ...` or `| n where n >= 0 -> ... | n where
// n < 0 -> ...` be accepted as exhaustive without a final unconditional
// arm. Anything outside that grammar (compound `&&`/`||` guards, calls,
// field access, comparisons between two different bindings, `!=`, ...)
// is simply UNRECOGNIZED — it contributes nothing to the proof rather
// than something that might be wrong, and the guard still works fine at
// runtime either way. The risk this is guarding against is a prover that
// wrongly claims exhaustiveness — far worse than one that occasionally
// asks for a redundant catch-all arm — so it's built to be sound (never
// wrongly approve) rather than complete (always recognize everything that
// actually is exhaustive). One known, accepted consequence: Int is
// reasoned about as if it were continuous, exactly like Float, which can
// occasionally demand a redundant arm for an integer-only edge case (e.g.
// `n <= 3` and `n >= 4` together ARE exhaustive over integers specifically
// — no integer falls strictly between 3 and 4 — but this prover doesn't
// know that and will still ask for a catch-all). Compound `&&`/`||`
// guards are deliberately out of scope for now; a guard using them is
// just unrecognized, same as any other unrecognized shape.

/** Subject kinds eligible for the interval/boolean coverage proof. */
const PROVABLE_GUARD_KINDS = new Set(['Bool', 'Int', 'Float', 'Byte']);

/** A closed-or-open interval over the reals, using JS's native Infinity
 *  for unbounded sides. Reused for Int/Float/Byte alike — see this
 *  section's docblock for why treating Int as continuous is an accepted,
 *  deliberately conservative simplification. */
type Interval = { lo: number; loIncl: boolean; hi: number; hiIncl: boolean };

/** Unwraps redundant parens so a guard like `(n >= 0)` is recognized the
 *  same as `n >= 0`. */
function unwrapGroup(e: Expr): Expr {
  return e.type === 'GroupExpr' ? unwrapGroup(e.expression) : e;
}

/** Extracts a numeric literal value, including a negative literal (which
 *  parses as a UnaryExpr wrapping the literal, not its own token) and
 *  redundant parens. Returns null for anything else. Converts Int's
 *  bigint to a JS number — a deliberate, accepted precision tradeoff for
 *  guard literals, which are always small, hand-written boundary values
 *  in practice; this is a proof aid, not a runtime computation. */
function literalNumber(e: Expr): number | null {
  const x = unwrapGroup(e);
  if (x.type === 'IntExpr')   return Number(x.value);
  if (x.type === 'FloatExpr') return x.value;
  if (x.type === 'ByteExpr')  return x.value;
  if (x.type === 'UnaryExpr' && x.operator === 'MinusToken') {
    const inner = literalNumber(x.right);
    return inner === null ? null : -inner;
  }
  return null;
}

/** Extracts a boolean literal, including redundant parens. */
function literalBool(e: Expr): boolean | null {
  const x = unwrapGroup(e);
  return x.type === 'BoolExpr' ? x.value : null;
}

/** Reverses a comparison operator's sense — needed when the literal
 *  appears on the LEFT of the binding (`0 <= n` means the same thing as
 *  `n >= 0`). EqualToken/NotEqualToken are their own reverse. */
const FLIP_COMPARISON: Record<string, string> = {
  GreaterToken:      'LessToken',
  GreaterEqualToken: 'LessEqualToken',
  LessToken:         'GreaterToken',
  LessEqualToken:    'GreaterEqualToken',
  EqualToken:        'EqualToken',
  NotEqualToken:     'NotEqualToken',
};

/** Recognizes ONE comparison between `bindingName` and a numeric literal
 *  — `binding OP literal` or `literal OP binding`, OP one of `< <= > >=
 *  ==` — and converts it to an Interval. `!=` is deliberately NOT
 *  recognized: it describes the domain minus a single point, which isn't
 *  representable as one contiguous Interval (out of scope for now, same
 *  as compound `&&`/`||` guards — see this section's docblock). Returns
 *  null for anything outside that grammar. */
function recognizeNumericGuard(guard: Expr, bindingName: string): Interval | null {
  const g = unwrapGroup(guard);
  if (g.type !== 'BinaryExpr' || !(g.operator in FLIP_COMPARISON)) return null;

  let op = g.operator;
  let litExpr: Expr;
  const left = unwrapGroup(g.left), right = unwrapGroup(g.right);
  if (left.type === 'IdentExpr' && left.name === bindingName) {
    litExpr = g.right;
  } else if (right.type === 'IdentExpr' && right.name === bindingName) {
    litExpr = g.left;
    op = FLIP_COMPARISON[op];
  } else {
    return null;
  }

  const lit = literalNumber(litExpr);
  if (lit === null) return null;

  switch (op) {
    case 'GreaterToken':      return { lo: lit,        loIncl: false, hi: Infinity,  hiIncl: false };
    case 'GreaterEqualToken': return { lo: lit,        loIncl: true,  hi: Infinity,  hiIncl: false };
    case 'LessToken':         return { lo: -Infinity,  loIncl: false, hi: lit,       hiIncl: false };
    case 'LessEqualToken':    return { lo: -Infinity,  loIncl: false, hi: lit,       hiIncl: true  };
    case 'EqualToken':        return { lo: lit,        loIncl: true,  hi: lit,       hiIncl: true  };
    default:                  return null; // NotEqualToken
  }
}

/** Recognizes a boolean identity guard on `bindingName` — a bare
 *  reference (`b`), negation (`!b`), or an equality/inequality against a
 *  literal (`b == true`, `b != false`, ...), operand order either way —
 *  and returns the set of boolean values that make it true. Returns null
 *  for anything outside that grammar. */
function recognizeBoolGuard(guard: Expr, bindingName: string): Set<boolean> | null {
  const g = unwrapGroup(guard);
  if (g.type === 'IdentExpr' && g.name === bindingName) return new Set([true]);
  if (g.type === 'UnaryExpr' && g.operator === 'BooleanNot') {
    const inner = unwrapGroup(g.right);
    if (inner.type === 'IdentExpr' && inner.name === bindingName) return new Set([false]);
    return null;
  }
  if (g.type === 'BinaryExpr' && (g.operator === 'EqualToken' || g.operator === 'NotEqualToken')) {
    const left = unwrapGroup(g.left), right = unwrapGroup(g.right);
    let litExpr: Expr | null = null;
    if (left.type === 'IdentExpr' && left.name === bindingName) litExpr = g.right;
    else if (right.type === 'IdentExpr' && right.name === bindingName) litExpr = g.left;
    if (litExpr) {
      const lit = literalBool(litExpr);
      if (lit !== null) return new Set([g.operator === 'EqualToken' ? lit : !lit]);
    }
  }
  return null;
}

/** True if `p` lies inside at least one of `intervals`. */
function pointCoveredByIntervals(p: number, intervals: Interval[]): boolean {
  return intervals.some(iv =>
    (iv.loIncl ? p >= iv.lo : p > iv.lo) &&
    (iv.hiIncl ? p <= iv.hi : p < iv.hi)
  );
}

/**
 * Returns null if `intervals`' union covers all of [domainLo, domainHi]
 * with no gaps; otherwise a representative value that's NOT covered (a
 * witness, not necessarily "the" gap — proof enough that one exists).
 *
 * Works by reducing the domain to a finite set of probe points: every
 * interval endpoint that falls inside the domain, plus the domain's own
 * (finite) bounds, plus one representative point in each open segment
 * between consecutive such points — including the two unbounded outer
 * segments, if the domain itself is unbounded, using a point just past
 * the outermost finite breakpoint as the probe (an actual midpoint isn't
 * computable against real Infinity). Because every interval's own
 * endpoints are already in that point set by construction, no interval
 * can have a boundary strictly inside any one segment — so a single probe
 * point per segment is enough to know whether the WHOLE segment is
 * covered, not just that one point.
 */
function findCoverageGap(intervals: Interval[], domainLo: number, domainHi: number): number | null {
  const finitePoints = new Set<number>();
  for (const iv of intervals) {
    if (Number.isFinite(iv.lo) && iv.lo >= domainLo && iv.lo <= domainHi) finitePoints.add(iv.lo);
    if (Number.isFinite(iv.hi) && iv.hi >= domainLo && iv.hi <= domainHi) finitePoints.add(iv.hi);
  }
  if (Number.isFinite(domainLo)) finitePoints.add(domainLo);
  if (Number.isFinite(domainHi)) finitePoints.add(domainHi);

  const sorted = [...finitePoints].sort((a, b) => a - b);
  if (sorted.length === 0) {
    // Domain is unbounded on both sides with no finite breakpoint
    // anywhere — 0 is always a safe representative probe.
    return pointCoveredByIntervals(0, intervals) ? null : 0;
  }

  if (domainLo === -Infinity) {
    const probe = sorted[0] - 1;
    if (!pointCoveredByIntervals(probe, intervals)) return probe;
  }
  if (domainHi === Infinity) {
    const probe = sorted[sorted.length - 1] + 1;
    if (!pointCoveredByIntervals(probe, intervals)) return probe;
  }
  for (const p of sorted) {
    if (!pointCoveredByIntervals(p, intervals)) return p;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const probe = (sorted[i] + sorted[i + 1]) / 2;
    if (!pointCoveredByIntervals(probe, intervals)) return probe;
  }
  return null;
}

/** The value domain to prove coverage over, per provable kind. Byte is
 *  genuinely bounded ([0, 255]); Int and Float are both treated as
 *  unbounded reals (see this section's docblock re: Int). */
function domainBoundsFor(kind: string): [number, number] {
  return kind === 'Byte' ? [0, 255] : [-Infinity, Infinity];
}

/** True for the OTHER concretely-known, non-union types this pass has
 *  enough visibility into to apply the baseline "some arm must be
 *  unconditional" rule to: a plain (non-union) record, Str, or Char.
 *  Deliberately excludes Option and other builtin unions (kind !==
 *  'Named', and excluded from static checking on purpose elsewhere in
 *  this file too — see UnionRegistry's docblock), List/Array/Dict/
 *  Generic/Fn (unusual match subjects this pass has no real confidence
 *  reasoning about), and Unknown/TyVar (genuinely no information — must
 *  stay permissive, the same policy already used everywhere else in this
 *  file for unresolved types). */
function isPlainRecordOrSimpleKind(t: PfunType): boolean {
  if (t.kind === 'Named') return t.unionName === undefined;
  return t.kind === 'Str' || t.kind === 'Char';
}

function checkExhaustiveness(stmts: Stmt[], source: string, unionResolver?: UnionModuleResolver): PfunError[] {
  const registry = new UnionRegistry();
  registerAllUnions(stmts, registry, unionResolver);
  const errors: PfunError[] = [];

  function walkExpr(e: Expr): void {
    if (!e) return;
    switch (e.type) {
      case 'MatchExpr': {
        walkExpr(e.subject);
        for (const arm of e.arms) {
          if (arm.guard) walkExpr(arm.guard);
          walkExpr(arm.body);
        }
        const subjectType = e.subject.inferredType;

        // An arm — tagged or not — with NO guard always matches once
        // reached, so its mere presence rules out a runtime "no arm
        // matched" crash, regardless of position (anything after it is
        // merely unreachable — a separate dead-arm concern this pass
        // doesn't flag). Used below as the baseline short-circuit for
        // every non-union branch.
        const hasUnconditionalArm = e.arms.some(a => !a.guard);
        // Stricter, UNION-specific gate: only a true wildcard/untagged
        // arm with no guard short-circuits per-variant coverage
        // checking. Before bare-binding patterns existed, EVERY
        // variant === null arm necessarily had no guard too (the
        // wildcard form had no guard syntax at all), so this and a
        // plain "any variant === null arm" check were equivalent. They
        // diverge now that an untagged arm CAN carry a guard (`| n
        // where n > 5 -> ...`) — such an arm must NOT be treated as a
        // catch-all for union purposes, only for the non-union
        // baseline above.
        const hasUnconditionalWildcard = e.arms.some(a => a.variant === null && !a.guard);

        if (!hasUnconditionalWildcard &&
            subjectType &&
            subjectType.kind === 'Named' &&
            subjectType.unionName !== undefined) {
          const variants = registry.variantsOf(subjectType.unionName);
          if (variants) {
            const covered = new Set(
              e.arms.map(a => a.variant).filter((v): v is string => v !== null)
            );
            const missing = [...variants].filter(v => !covered.has(v));
            if (missing.length > 0) {
              e.missingVariants = missing;
              // Same message wording as the runtime check (interpreter.ts's
              // evaluateMatchGen), so classifyError() in errors.ts tags
              // this Exhaustiveness rather than falling through to a
              // generic kind — the pattern it matches on
              // ('non-exhaustive match' / 'missing arm') is shared.
              const message = `Non-exhaustive match on '${subjectType.unionName}': missing arm(s) for ${missing.map(v => `'${v}'`).join(', ')}.`;
              const raw = Object.assign(new Error(message), { pos: e.pos });
              errors.push(buildPfunError(
                raw,
                source,
                e.pos,
                null,           // no runtime environment to pull identifier values from
                () => undefined,
                { stringify: String },
              ));
            }
          }
        } else if (!hasUnconditionalArm && subjectType && PROVABLE_GUARD_KINDS.has(subjectType.kind)) {
          // Tagged arms can never actually fire against a Bool/Int/Float/
          // Byte value (none of these carry a runtime __type tag) —
          // exclude them from the proof entirely rather than let their
          // mere presence be miscounted as coverage.
          const untagged = e.arms.filter(a => a.variant === null);

          if (subjectType.kind === 'Bool') {
            const covered = new Set<boolean>();
            for (const arm of untagged) {
              if (!arm.guard || arm.binding === null) continue;
              const vals = recognizeBoolGuard(arm.guard, arm.binding);
              if (vals) for (const v of vals) covered.add(v);
            }
            const missing = [true, false].filter(v => !covered.has(v));
            if (missing.length > 0) {
              e.missingVariants = missing.map(String);
              const message = `Non-exhaustive match on 'Bool': missing arm(s) for ${missing.map(v => `'${v}'`).join(', ')}. ` +
                `Add an arm with no 'where' guard to handle every remaining case.`;
              const raw = Object.assign(new Error(message), { pos: e.pos });
              errors.push(buildPfunError(raw, source, e.pos, null, () => undefined, { stringify: String }));
            }
          } else {
            const intervals: Interval[] = [];
            for (const arm of untagged) {
              if (!arm.guard || arm.binding === null) continue;
              const iv = recognizeNumericGuard(arm.guard, arm.binding);
              if (iv) intervals.push(iv);
            }
            const [domainLo, domainHi] = domainBoundsFor(subjectType.kind);
            const gap = findCoverageGap(intervals, domainLo, domainHi);
            if (gap !== null) {
              const message = `Non-exhaustive match on '${subjectType.kind}': the guards do not cover every possible value ` +
                `(for example, a value near ${gap} would not match any arm). ` +
                `Add an arm with no 'where' guard to handle every remaining case.`;
              const raw = Object.assign(new Error(message), { pos: e.pos });
              errors.push(buildPfunError(raw, source, e.pos, null, () => undefined, { stringify: String }));
            }
          }
        } else if (!hasUnconditionalArm && subjectType && isPlainRecordOrSimpleKind(subjectType)) {
          // No interval/boolean proof attempted here — just the
          // baseline syntactic rule (see this file's "Provable-guard
          // exhaustiveness" section).
          const message = `Non-exhaustive match: the last arm has a 'where' guard, so this match isn't ` +
            `guaranteed to handle every case. Add a final arm with no guard to handle whatever the guards above it don't.`;
          const raw = Object.assign(new Error(message), { pos: e.pos });
          errors.push(buildPfunError(raw, source, e.pos, null, () => undefined, { stringify: String }));
        }
        break;
      }
      case 'BinaryExpr':   walkExpr(e.left); walkExpr(e.right); break;
      case 'UnaryExpr':    walkExpr(e.right); break;
      case 'GroupExpr':    walkExpr(e.expression); break;
      case 'TernaryExpr':  walkExpr(e.condition); walkExpr(e.thenBranch); walkExpr(e.elseBranch); break;
      case 'CallExpr':     walkExpr(e.callee); e.args.forEach(walkExpr); break;
      case 'LambdaExpr':   walkExpr(e.body); break;
      case 'ListExpr':     e.elements.forEach(walkExpr); break;
      case 'RecordExpr':   e.fields.forEach(f => walkExpr(f.value)); break;
      case 'GetExpr':      walkExpr(e.object); break;
      case 'AssignExpr':   walkExpr(e.value); break;
      case 'IndexExpr':    walkExpr(e.object); walkExpr((e as any).index); break;
      case 'IndexAssignExpr': walkExpr(e.object); walkExpr((e as any).index); walkExpr(e.value); break;
      case 'ComprehensionExpr':
        e.generators.forEach(g => walkExpr(g.source));
        if (e.guard) walkExpr(e.guard);
        walkExpr(e.body);
        break;
      case 'BlockExpr':    e.statements.forEach(walkStmt); break;
      case 'DictExpr':     e.entries.forEach(en => { walkExpr(en.key); walkExpr(en.value); }); break;
      case 'ArrayExpr':    e.elements.forEach(walkExpr); break;
    }
  }

  function walkStmt(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExprStmt':
      case 'EvalStmt':       walkExpr(s.expression); break;
      case 'LetStmt':
      case 'VarStmt':        walkExpr(s.initializer); break;
      case 'ReturnStmt':     if (s.value) walkExpr(s.value); break;
      case 'IfStmt':         walkExpr(s.condition); walkStmt(s.thenBranch); if (s.elseBranch) walkStmt(s.elseBranch); break;
      case 'BlockStmt':      s.statements.forEach(walkStmt); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':  s.body.forEach(walkStmt); break;
      case 'ExportStmt':     walkStmt(s.declaration); break;
      // UnionTypeStmt is handled by registerAllUnions() above, not here —
      // by the time this walk runs, every union in the program is already
      // registered. TypeStmt (plain records) and ImportStmt carry no
      // exhaustiveness information and need no recursion either.
    }
  }

  for (const s of stmts) walkStmt(s);
  return errors;
}

/**
 * Annotate every AST node with `inferredType`, and annotate MatchExpr nodes
 * with `missingVariants` where statically determinable.
 *
 * Runs Hindley-Milner constraint-based inference (inferencer.ts): assigns
 * TyVars to every site, generates equality constraints, solves them via
 * unification, and applies the resulting substitution back to all nodes.
 * Type errors from unification — and from static exhaustiveness checking —
 * are silently discarded — callers that want errors should use
 * checkTypes() instead. Exhaustiveness checking runs after inference,
 * since it reads inferencer.ts's resolved inferredType off each MatchExpr's
 * subject.
 *
 * Mutates nodes in place.  Never throws.
 */
export function inferTypes(stmts: Stmt[]): void {
  const cs        = generateConstraints(stmts);
  const { subst } = solveConstraints(cs);
  applySubstitutionToAST(stmts, subst);
  checkExhaustiveness(stmts, '');
}

/**
 * Run full type inference and return any type errors as formatted PfunErrors.
 *
 * Runs the same pipeline as inferTypes() (HM inference, then static
 * exhaustiveness checking), but also collects both unification errors and
 * non-exhaustive-match errors, formatting them with source positions using
 * buildPfunError(). Intended for use in main.ts / the CLI pipeline.
 *
 * Mutates nodes in place.  Never throws.
 *
 * @param stmts          The parsed AST to annotate
 * @param source         The original source text (used for error formatting)
 * @param typeResolver   Optional. Resolves an import to that module's
 *   TypeImportTable (see inferencer.ts), enabling real cross-module type
 *   checks. Omitted (the default), every import behaves exactly as before
 *   cross-module type support existed.
 * @param unionResolver  Optional. Resolves an import to that module's
 *   UnionImportTable, enabling exhaustiveness checks on matches over
 *   imported union values. Omitted (the default), behavior is unchanged.
 * @param exportTypesOut Optional. Populated (as a side effect) with this
 *   module's own exported names' RESOLVED types (post-substitution,
 *   unlike inferencer.ts's exportTypesOut parameter which is
 *   pre-substitution) — ready for the whole-program driver to feed
 *   straight into another module's typeResolver with no further work.
 *   Both typeResolver/unionResolver and exportTypesOut are supplied by the
 *   whole-program driver (wholeProgramCheck.ts); existing callers (every
 *   call site before this stage) omit all three and are unaffected.
 */
export function checkTypes(
  stmts: Stmt[],
  source: string,
  typeResolver?: TypeImportResolver,
  unionResolver?: UnionModuleResolver,
  exportTypesOut?: Map<string, PfunType>,
): PfunError[] {
  const rawExportTypes = new Map<string, PfunType>();
  const cs                = generateConstraints(stmts, typeResolver, rawExportTypes, unionResolver);
  const { subst, errors } = solveConstraints(cs);
  applySubstitutionToAST(stmts, subst);
  const exhaustivenessErrors = checkExhaustiveness(stmts, source, unionResolver);

  if (exportTypesOut) {
    for (const [name, ty] of rawExportTypes) exportTypesOut.set(name, subst.apply(ty));
  }

  // Format unification errors as PfunErrors with source positions
  const typeErrors = errors.map(err => {
    const raw = Object.assign(new Error(err.message), { pos: err.pos });
    return buildPfunError(
      raw,
      source,
      err.pos,
      null,           // no AST node — the error is at the constraint level
      () => undefined,
      { stringify: String },
    );
  });

  return [...typeErrors, ...exhaustivenessErrors];
}

