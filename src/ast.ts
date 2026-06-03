// src/ast.ts

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
 */
export type Expr =
  | { type: 'IntExpr'; value: bigint }
  | { type: 'BoolExpr'; value: boolean }
  | { type: 'StrExpr'; value: string }
  | { type: 'CharExpr'; value: string }   // distinct char type, not a string
  | { type: 'IdentExpr'; name: string }
  | { type: 'UnaryExpr'; operator: string; right: Expr }
  | { type: 'BinaryExpr'; left: Expr; operator: string; right: Expr }
  | { type: 'GroupExpr'; expression: Expr }
  | { type: 'AssignExpr'; name: string; value: Expr }
  | { type: 'CallExpr'; callee: Expr; args: Expr[] }
  | { type: 'LambdaExpr'; params: string[]; body: Expr }
  | { type: 'TernaryExpr'; condition: Expr; thenBranch: Expr; elseBranch: Expr }
  | { type: 'ListExpr'; elements: Expr[] }
  | { type: 'RecordExpr'; name: string; fields: { key: string | null, value: Expr }[] }
  | { type: 'GetExpr'; object: Expr; name: string }
  | { type: 'MatchExpr'; subject: Expr; arms: MatchArm[] }
  | { type: 'ComprehensionExpr'; body: Expr; generators: { variable: string; source: Expr }[]; guard?: Expr }
  | { type: 'DictExpr'; entries: { key: Expr; value: Expr }[] }
  | { type: 'IndexExpr'; object: Expr; index: Expr }
  | { type: 'IndexAssignExpr'; object: Expr; index: Expr; value: Expr }
  | { type: 'BlockExpr'; statements: Stmt[] };

/**
 * Statements represent actions or control flow.
 *
 * Functions are pure: no side effects, lazy evaluation, memoized.
 * Procedures are impure: may produce side effects, strict evaluation, not memoized.
 */
export type Stmt =
  | { type: 'LetStmt'; name: string; initializer: Expr }
  | { type: 'VarStmt'; name: string; initializer: Expr }
  | { type: 'TypeStmt'; name: string; fields: string[] }
  | { type: 'UnionTypeStmt'; name: string; variants: { name: string; fields: string[] }[] }
  | { type: 'ExprStmt'; expression: Expr }
  | { type: 'BlockStmt'; statements: Stmt[] }
  | { type: 'IfStmt'; condition: Expr; thenBranch: Stmt; elseBranch?: Stmt }
  | { type: 'FunctionStmt'; name: string; params: string[]; body: Stmt[] }
  | { type: 'ProcedureStmt'; name: string; params: string[]; body: Stmt[] }
  | { type: 'ReturnStmt'; value?: Expr }
  | { type: 'EvalStmt'; expression: Expr }
  | { type: 'ImportStmt'; kind: 'named'; names: { name: string; alias?: string }[]; path: string }
  | { type: 'ImportStmt'; kind: 'namespace'; alias: string; path: string }
  | { type: 'ImportStmt'; kind: 'star'; path: string }
  | { type: 'ExportStmt'; declaration: Stmt };
