// src/ast.ts

/**
 * A single arm of a match expression.
 *
 * Examples:
 *   | Square s -> s.side          { variant: 'Square', binding: 's',    guard: undefined, body: ... }
 *   | Circle c where c.r > 3 -> c.radius { variant: 'Circle', binding: 'c', guard: ...,  body: ... }
 *   | Circle _ -> 1               { variant: 'Circle', binding: null,   guard: undefined, body: ... }
 *   | _ -> 0                      { variant: null,     binding: null,   guard: undefined, body: ... }
 */
export type MatchArm = {
  variant: string | null;  // null = wildcard '_'
  binding: string | null;  // null = wildcard '_' or no binding
  guard?: Expr;            // optional 'where <expr>' guard
  body: Expr;
};

/**
 * Expressions evaluate to a value.
 * They can be nested and combined to form complex computations.
 */
export type Expr =
  | { type: 'IntExpr'; value: bigint }
  | { type: 'BoolExpr'; value: boolean }
  | { type: 'StrExpr'; value: string }
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
  | { type: 'MatchExpr'; subject: Expr; arms: MatchArm[] };

/**
 * Statements represent actions or control flow.
 * They do not inherently resolve to a value in the same way expressions do.
 */
export type Stmt =
  | { type: 'LetStmt'; name: string; initializer: Expr }
  | { type: 'VarStmt'; name: string; initializer: Expr }       // Mutable, strictly evaluated
  | { type: 'TypeStmt'; name: string; fields: string[] }       // Plain record definitions
  | { type: 'UnionTypeStmt'; name: string; variants: { name: string; fields: string[] }[] } // Discriminated union
  | { type: 'ExprStmt'; expression: Expr }
  | { type: 'BlockStmt'; statements: Stmt[] }
  | { type: 'IfStmt'; condition: Expr; thenBranch: Stmt; elseBranch?: Stmt }
  | { type: 'FunctionStmt'; name: string; params: string[]; body: Stmt[] }
  | { type: 'ReturnStmt'; value?: Expr }
  | { type: 'PrintStmt'; expression: Expr }
  | { type: 'EvalStmt'; expression: Expr };
