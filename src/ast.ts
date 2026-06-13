// src/ast.ts
import { SourcePos } from './lexer';

// ─── Type System ──────────────────────────────────────────────────────────────

/**
 * Represents a Pfun type, either inferred or explicitly annotated.
 *
 * - Primitive kinds map directly to Pfun's built-in value types.
 * - List / Array / Dict / Option carry their element types.
 * - Named covers user-defined plain records and union variants. For union
 *   variants, unionName carries the parent union name (e.g. name='Square',
 *   unionName='Shape'). For plain records, unionName is absent.
 * - Generic covers parameterised forms, e.g. Pair<Int, Str>.
 * - Fn represents a function type with typed parameters and a return type.
 * - TyVar is a type variable — an unknown type to be resolved by unification.
 *   Each variable has a unique numeric id.  Used by the HM inference engine;
 *   should not appear in fully-resolved types.
 * - Unknown is the bottom value: used wherever the type cannot yet be resolved
 *   by the simple first-pass inferencer.  Distinct from TyVar: Unknown means
 *   "we gave up", TyVar means "we haven't solved this yet but we will".
 */
export type PfunType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'Str' }
  | { kind: 'Char' }
  | { kind: 'Nil' }
  | { kind: 'List';    element: PfunType }
  | { kind: 'Array';   element: PfunType }
  | { kind: 'Dict';    key: PfunType; value: PfunType }
  | { kind: 'Option';  inner: PfunType }
  | { kind: 'Named';   name: string; unionName?: string }
  | { kind: 'Generic'; name: string; params: PfunType[] }
  | { kind: 'Fn';      params: PfunType[]; ret: PfunType }
  | { kind: 'TyVar';   id: number }
  | { kind: 'Unknown' };

/** Convenience constant — avoids allocating a new object at every unresolved site. */
export const UNKNOWN: PfunType = { kind: 'Unknown' };

// ─── Match Arms ───────────────────────────────────────────────────────────────

/**
 * A single arm of a match expression.
 */
export type MatchArm = {
  variant: string | null;
  binding: string | null;
  guard?: Expr;
  body: Expr;
};

// ─── Expressions ──────────────────────────────────────────────────────────────

/**
 * Expressions evaluate to a value.
 * All expressions are pure — they may not produce side effects.
 *
 * Every expression node carries:
 *   pos?          — source position, for error reporting
 *   inferredType? — filled in by the type inference pass; absent or Unknown
 *                   when the type cannot be resolved at compile time
 */
export type Expr =
  | { type: 'IntExpr';     value: bigint;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BoolExpr';    value: boolean; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'StrExpr';     value: string;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'CharExpr';    value: string;  pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IdentExpr';   name: string;   pos?: SourcePos; inferredType?: PfunType }
  | { type: 'UnaryExpr';   operator: string; right: Expr;   pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BinaryExpr';  left: Expr; operator: string; right: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'GroupExpr';   expression: Expr;               pos?: SourcePos; inferredType?: PfunType }
  | { type: 'AssignExpr';  name: string; value: Expr;       pos?: SourcePos; inferredType?: PfunType }
  | { type: 'CallExpr';    callee: Expr; args: Expr[];      pos?: SourcePos; inferredType?: PfunType }
  | { type: 'LambdaExpr';  params: string[]; body: Expr;   pos?: SourcePos; inferredType?: PfunType }
  | { type: 'TernaryExpr'; condition: Expr; thenBranch: Expr; elseBranch: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ListExpr';    elements: Expr[];                pos?: SourcePos; inferredType?: PfunType }
  | { type: 'RecordExpr';  name: string; fields: { key: string | null; value: Expr }[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'GetExpr';     object: Expr; name: string;      pos?: SourcePos; inferredType?: PfunType }
  | { type: 'MatchExpr';   subject: Expr; arms: MatchArm[]; missingVariants?: string[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ComprehensionExpr'; body: Expr; generators: { variable: string; source: Expr }[]; guard?: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'DictExpr';    entries: { key: Expr; value: Expr }[]; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'ArrayExpr';   elements: Expr[];                pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IndexExpr';   object: Expr; index: Expr;       pos?: SourcePos; inferredType?: PfunType }
  | { type: 'IndexAssignExpr'; object: Expr; index: Expr; value: Expr; pos?: SourcePos; inferredType?: PfunType }
  | { type: 'BlockExpr';   statements: Stmt[];              pos?: SourcePos; inferredType?: PfunType };

// ─── Statements ───────────────────────────────────────────────────────────────

/**
 * Statements represent actions or control flow.
 *
 * Functions are pure: no side effects, lazy evaluation, optionally memoized.
 * Procedures are impure: may produce side effects, strict evaluation.
 *
 * Binding statements (LetStmt, VarStmt) carry an inferredType field filled in
 * by the inference pass, reflecting the resolved type of the bound value.
 */
export type Stmt =
  | { type: 'LetStmt';       name: string; initializer: Expr; inferredType?: PfunType; pos?: SourcePos }
  | { type: 'VarStmt';       name: string; initializer: Expr; inferredType?: PfunType; pos?: SourcePos }
  | { type: 'TypeStmt';      name: string; fields: string[]; generic?: boolean; pos?: SourcePos }
  | { type: 'UnionTypeStmt'; name: string; variants: { name: string; fields: string[] }[]; pos?: SourcePos }
  | { type: 'ExprStmt';      expression: Expr; pos?: SourcePos }
  | { type: 'BlockStmt';     statements: Stmt[]; pos?: SourcePos }
  | { type: 'IfStmt';        condition: Expr; thenBranch: Stmt; elseBranch?: Stmt; pos?: SourcePos }
  | { type: 'FunctionStmt';  name: string; params: string[]; body: Stmt[]; memo: boolean; pos?: SourcePos }
  | { type: 'ProcedureStmt'; name: string; params: string[]; body: Stmt[]; pos?: SourcePos }
  | { type: 'ReturnStmt';    value?: Expr; pos?: SourcePos }
  | { type: 'EvalStmt';      expression: Expr; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'named';     names: { name: string; alias?: string }[]; path: string; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'namespace'; alias: string; path: string; pos?: SourcePos }
  | { type: 'ImportStmt';    kind: 'star';      path: string; pos?: SourcePos }
  | { type: 'ExportStmt';    declaration: Stmt; pos?: SourcePos };
