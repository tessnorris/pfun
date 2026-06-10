// src/ast.ts
import { SourcePos } from './lexer';

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
 * Every expression node carries an optional `pos` for error reporting.
 */
export type Expr =
  | { type: 'IntExpr'; value: bigint; pos?: SourcePos }
  | { type: 'BoolExpr'; value: boolean; pos?: SourcePos }
  | { type: 'StrExpr'; value: string; pos?: SourcePos }
  | { type: 'CharExpr'; value: string; pos?: SourcePos }
  | { type: 'IdentExpr'; name: string; pos?: SourcePos }
  | { type: 'UnaryExpr'; operator: string; right: Expr; pos?: SourcePos }
  | { type: 'BinaryExpr'; left: Expr; operator: string; right: Expr; pos?: SourcePos }
  | { type: 'GroupExpr'; expression: Expr; pos?: SourcePos }
  | { type: 'AssignExpr'; name: string; value: Expr; pos?: SourcePos }
  | { type: 'CallExpr'; callee: Expr; args: Expr[]; pos?: SourcePos }
  | { type: 'LambdaExpr'; params: string[]; body: Expr; pos?: SourcePos }
  | { type: 'TernaryExpr'; condition: Expr; thenBranch: Expr; elseBranch: Expr; pos?: SourcePos }
  | { type: 'ListExpr'; elements: Expr[]; pos?: SourcePos }
  | { type: 'RecordExpr'; name: string; fields: { key: string | null, value: Expr }[]; pos?: SourcePos }
  | { type: 'GetExpr'; object: Expr; name: string; pos?: SourcePos }
  | { type: 'MatchExpr'; subject: Expr; arms: MatchArm[]; pos?: SourcePos }
  | { type: 'ComprehensionExpr'; body: Expr; generators: { variable: string; source: Expr }[]; guard?: Expr; pos?: SourcePos }
  | { type: 'DictExpr'; entries: { key: Expr; value: Expr }[]; pos?: SourcePos }
  | { type: 'ArrayExpr'; elements: Expr[]; pos?: SourcePos }
  | { type: 'IndexExpr'; object: Expr; index: Expr; pos?: SourcePos }
  | { type: 'IndexAssignExpr'; object: Expr; index: Expr; value: Expr; pos?: SourcePos }
  | { type: 'BlockExpr'; statements: Stmt[]; pos?: SourcePos };

/**
 * Statements represent actions or control flow.
 * Every statement node carries an optional `pos` for error reporting.
 *
 * Functions are pure: no side effects, lazy evaluation, memoized.
 * Procedures are impure: may produce side effects, strict evaluation, not memoized.
 */
export type Stmt =
  | { type: 'LetStmt'; name: string; initializer: Expr; pos?: SourcePos }
  | { type: 'VarStmt'; name: string; initializer: Expr; pos?: SourcePos }
  | { type: 'TypeStmt'; name: string; fields: string[]; pos?: SourcePos }
  | { type: 'UnionTypeStmt'; name: string; variants: { name: string; fields: string[] }[]; pos?: SourcePos }
  | { type: 'ExprStmt'; expression: Expr; pos?: SourcePos }
  | { type: 'BlockStmt'; statements: Stmt[]; pos?: SourcePos }
  | { type: 'IfStmt'; condition: Expr; thenBranch: Stmt; elseBranch?: Stmt; pos?: SourcePos }
  | { type: 'FunctionStmt'; name: string; params: string[]; body: Stmt[]; pos?: SourcePos }
  | { type: 'ProcedureStmt'; name: string; params: string[]; body: Stmt[]; pos?: SourcePos }
  | { type: 'ReturnStmt'; value?: Expr; pos?: SourcePos }
  | { type: 'EvalStmt'; expression: Expr; pos?: SourcePos }
  | { type: 'ImportStmt'; kind: 'named'; names: { name: string; alias?: string }[]; path: string; pos?: SourcePos }
  | { type: 'ImportStmt'; kind: 'namespace'; alias: string; path: string; pos?: SourcePos }
  | { type: 'ImportStmt'; kind: 'star'; path: string; pos?: SourcePos }
  | { type: 'ExportStmt'; declaration: Stmt; pos?: SourcePos };
