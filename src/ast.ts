// src/ast.ts
import { SourcePos } from './lexer';

// ─── Type representation ──────────────────────────────────────────────────────
//
// PfunType is the type-level representation used by the inferencer and
// typechecker.  It is separate from the value-level types in the interpreter.
//
// Naming conventions that match inferencer.ts / typechecker.ts exactly:
//   TyVar(id)   — unification variable, created fresh during constraint gen
//   Unknown     — not yet inferred; unification wildcard (never fails)
//   Named       — a concrete record or union-variant type by name
//   Generic     — a named generic type applied to type arguments, e.g. List<Int>
//   List        — homogeneous list; elem field is `element` (not `elem`)
//   Array       — mutable array; elem field is `element`
//   Option      — Option<T>; inner field holds the wrapped type
//   Fn          — function type: (params...) -> ret
//   Dict        — key/value map type

export type PfunType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'Str' }
  | { kind: 'Char' }
  | { kind: 'Byte' }
  | { kind: 'Nil' }
  | { kind: 'List';    element: PfunType }
  | { kind: 'Array';   element: PfunType }
  | { kind: 'Option';  inner:   PfunType }
  | { kind: 'Dict';    key: PfunType; value: PfunType }
  | { kind: 'Fn';      params: PfunType[]; ret: PfunType }
  | { kind: 'Generic'; name: string; params: PfunType[] }
  | { kind: 'Named';   name: string; unionName?: string }
  | { kind: 'TyVar';   id: number }
  | { kind: 'Unknown' };

/** Sentinel for "type not yet known".  Both the inferencer and typechecker
 *  import this rather than constructing their own `{ kind: 'Unknown' }`. */
export const UNKNOWN: PfunType = { kind: 'Unknown' };

// ─── AST annotation helpers ───────────────────────────────────────────────────
//
// The inferencer and typechecker annotate AST nodes in-place after the parse
// phase.  We add optional annotation fields here so TypeScript accepts those
// writes without casts.
//
// `inferredType`    — set on expressions and let/var bindings after type
//                     inference resolves them.
// `missingVariants` — set on MatchExpr when the match is non-exhaustive,
//                     so the error reporter can name the missing arms.

/**
 * A single arm of a match expression.
 */
export type MatchArm = {
  variant: string | null;
  binding: string | null;
  guard?: Expr;
  body: Expr;
};

/**
 * Expressions evaluate to a value.
 * All expressions are pure — they may not produce side effects.
 * Every expression node carries an optional `pos` for error reporting
 * and an optional `inferredType` annotation written by the type inferencer.
 */
export type Expr =
  | { type: 'IntExpr';    value: bigint;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'FloatExpr';  value: number;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BoolExpr';   value: boolean; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'StrExpr';    value: string;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'CharExpr';   value: string;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ByteExpr';   value: number;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IdentExpr';  name: string;   pos?: SourcePos; inferredType?: PfunType }
  | { type: 'UnaryExpr';  operator: string; right: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BinaryExpr'; left: Expr; operator: string; right: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'GroupExpr';  expression: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'AssignExpr'; name: string; value: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'CallExpr';   callee: Expr; args: Expr[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'LambdaExpr'; params: string[]; body: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'TernaryExpr'; condition: Expr; thenBranch: Expr; elseBranch: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ListExpr';   elements: Expr[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'RecordExpr'; name: string; fields: { key: string | null; value: Expr }[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'GetExpr';    object: Expr; name: string; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'MatchExpr';  subject: Expr; arms: MatchArm[]; pos?: SourcePos; inferredType?: PfunType; missingVariants?: string[] }
  | { type: 'ComprehensionExpr'; body: Expr; generators: { variable: string; source: Expr }[]; guard?: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'DictExpr';   entries: { key: Expr; value: Expr }[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ArrayExpr';  elements: Expr[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IndexExpr';  object: Expr; index: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IndexAssignExpr'; object: Expr; index: Expr; value: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BlockExpr';  statements: Stmt[]; pos?: SourcePos; inferredType?: PfunType }
  // ── Async/await (phase 1) ───────────────────────────────────────────────────
  // 'await <value>' — a unary prefix expression. In phase 1 this only parses;
  // evaluation (interpreter.ts) and effect-checking (typechecker.ts, "async
  // contagion": await is only legal inside an async function/proc, and a
  // value produced by an async call may only be forced from an async
  // context) are deferred to later steps.
  | { type: 'AwaitExpr'; value: Expr; pos?: SourcePos; inferredType?: PfunType };

/**
 * Statements represent actions or control flow.
 * Every statement node carries an optional `pos` for error reporting.
 *
 * Functions are pure: no side effects, lazy evaluation, memoized.
 * Procedures are impure: may produce side effects, strict evaluation, not memoized.
 *
 * LetStmt and VarStmt carry an optional `inferredType` annotation written
 * by the type inferencer after constraint solving.
 *
 * ── Async/await (phase 1) ───────────────────────────────────────────────────
 * `async?: boolean` on FunctionStmt/ProcedureStmt marks a declaration as
 * async (parsed via `async function` / `async proc`). Currently this is
 * purely a syntactic flag — it carries no interpreter or typechecker
 * semantics yet. `async memo function` is allowed to *parse* (memo + async
 * legality is deferred to the typechecker's effect-checking pass, step 5).
 */
export type Stmt =
  | { type: 'LetStmt';       name: string; initializer: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'VarStmt';       name: string; initializer: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'TypeStmt';      name: string; fields: string[]; generic?: boolean; pos?: SourcePos }
  | { type: 'UnionTypeStmt'; name: string; variants: { name: string; fields: string[] }[]; pos?: SourcePos }
  | { type: 'ExprStmt';      expression: Expr; pos?: SourcePos }
  | { type: 'BlockStmt';     statements: Stmt[]; pos?: SourcePos }
  | { type: 'IfStmt';        condition: Expr; thenBranch: Stmt; elseBranch?: Stmt; pos?: SourcePos }
  | { type: 'FunctionStmt';  name: string; params: string[]; body: Stmt[]; memo: boolean; async?: boolean; pos?: SourcePos }
  | { type: 'ProcedureStmt'; name: string; params: string[]; body: Stmt[]; async?: boolean; pos?: SourcePos }
  | { type: 'ReturnStmt';    value?: Expr; pos?: SourcePos }
  | { type: 'EvalStmt';      expression: Expr; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'named';     names: { name: string; alias?: string }[]; path: string; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'namespace'; alias: string; path: string; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'star';      path: string; pos?: SourcePos }
  | { type: 'ExportStmt';    declaration: Stmt; pos?: SourcePos };
