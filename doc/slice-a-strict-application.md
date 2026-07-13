# Slice A implementation notes

## Scope

This slice establishes the ordinary strict application-language floor:

1. scalar literals and operators;
2. strict `let`;
3. procedural `var`, assignment, and `while`;
4. ternary and trailing-if values;
5. functions and pure lambdas;
6. exact-arity calls;
7. records and unions;
8. field access;
9. match, guards, and exhaustiveness;
10. format strings and raw strings;
11. direct procedure calls;
12. imports and Node bundle execution.

## Compiler change

Most of this surface was already represented end to end. Format strings were the
remaining broken boundary:

```text
lexer:  TokFmtStr containing the whole raw body
parser: EFmt([FmtLit(rawBody)])
checker: already walks FmtExpr
emitter: already renders FmtExpr through $str and $concatS
```

The parser now splits `TokFmtStr` into `FmtLit` and `FmtExpr` values. Each
interpolation substring goes through the ordinary lexer and Pratt parser, so
holes support the full expression grammar.

The scanner and splitter understand nested braces, normal strings, raw strings,
char literals, and escapes while locating the closing interpolation brace.
Nested format strings inside a hole remain deliberately rejected.

## Acceptance strategy

The runner creates a compiler containing the patch with the existing stage-2
compiler, then asks that compiler to rebuild itself. Those artifacts must be
byte-identical.

Only after the fixed point passes does the runner compile and execute the
multi-module Slice A program. It also verifies diagnostics for exact-arity
failures, guarded-only exhaustiveness, and pure-to-proc calls.
