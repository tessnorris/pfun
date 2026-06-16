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
import { generateConstraints, solveConstraints, applySubstitutionToAST } from './inferencer';
import { PfunError, buildPfunError } from './errors';

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
function registerAllUnions(stmts: Stmt[], registry: UnionRegistry): void {
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'UnionTypeStmt':  registry.registerUnion(s.name, s.variants); break;
      case 'IfStmt':         walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':      s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':  s.body.forEach(walk); break;
      case 'ExportStmt':     walk(s.declaration); break;
      // Every other statement type cannot contain a UnionTypeStmt.
    }
  }
  for (const s of stmts) walk(s);
}

// Two known, deliberate limitations (both pre-existing — i.e. true of the
// pass this replaces too, not a new regression):
//   - Builtin unions (Option, DbResult, DbValue, ...) are never flagged
//     here; only interpreter.ts's runtime check covers those.
function checkExhaustiveness(stmts: Stmt[], source: string): PfunError[] {
  const registry = new UnionRegistry();
  registerAllUnions(stmts, registry);
  const errors: PfunError[] = [];

  function walkExpr(e: Expr): void {
    if (!e) return;
    switch (e.type) {
      case 'MatchExpr': {
        walkExpr(e.subject);
        for (const arm of e.arms) walkExpr(arm.body);
        const subjectType = e.subject.inferredType;
        const hasWildcard = e.arms.some(a => a.variant === null);
        if (!hasWildcard &&
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
 * @param stmts   The parsed AST to annotate
 * @param source  The original source text (used for error formatting)
 */
export function checkTypes(stmts: Stmt[], source: string): PfunError[] {
  const cs                = generateConstraints(stmts);
  const { subst, errors } = solveConstraints(cs);
  applySubstitutionToAST(stmts, subst);
  const exhaustivenessErrors = checkExhaustiveness(stmts, source);

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

