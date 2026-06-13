// src/errors.ts
// Error classification, formatting, and context extraction for Pfun.
//
// PfunError wraps every runtime/parse/lex error with:
//   - A classification (Lexical, Syntax, Name, Type, Key, DivideByZero,
//     Purity, Exhaustiveness, Arity, Import, File, IO, Runtime)
//   - Source position (line / col) and the full text of that source line
//   - A snapshot of identifiers referenced on that line and their runtime values
//
// Additional error types beyond the ones requested:
//   Purity      — side-effect or mutation attempt inside a pure function
//   Exhaustiveness — non-exhaustive match / missing union arm
//   Arity       — wrong number of arguments / record fields
//   Import      — module not found, circular import, missing export

import { SourcePos } from './lexer';
import { Expr, Stmt } from './ast';

// ─── Error kinds ──────────────────────────────────────────────────────────────

export type ErrorKind =
  | 'Lexical'        // Unexpected character, bad escape sequence, unterminated literal
  | 'Syntax'         // Unexpected token, malformed expression or statement
  | 'Name'           // Undefined variable / unknown type
  | 'Type'           // Type mismatch (record fields, list homogeneity)
  | 'Key'            // Missing dict key, missing record field
  | 'DivideByZero'   // Integer division by zero
  | 'Purity'         // Side effect attempted inside a pure function
  | 'Exhaustiveness' // Non-exhaustive match expression
  | 'Arity'          // Wrong number of arguments or record fields
  | 'Import'         // Module resolution / circular import / missing export
  | 'File'           // File I/O error
  | 'IO'             // Other I/O error (stdin/stdout)
  | 'TypeCheck'    // Compile-time check failure (e.g. non-exhaustive match)
  | 'Runtime';       // Catch-all for unclassified runtime errors

// ─── Classify a raw Error message ─────────────────────────────────────────────

export function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase();

  // Check most-specific patterns first
  if (m.includes('divide by zero') || m.includes('division by zero') ||
      (m.includes('divided') && m.includes('zero'))) return 'DivideByZero';

  if (m.includes('non-exhaustive match') || m.includes('missing arm'))
    return 'Exhaustiveness';

  if (m.includes('cannot unify') || m.includes('occurs check'))
    return 'TypeCheck';

  if (m.includes("functions cannot use") || m.includes("functions cannot call") ||
      m.includes("functions cannot mutate") || m.includes("side effect") ||
      m.includes("side-effect") || m.includes("pure function") ||
      m.includes("not allowed in pure") || m.includes("functions cannot use 'var'"))
    return 'Purity';

  if (m.includes("unexpected character") || m.includes("unterminated string") ||
      m.includes("unterminated char") || m.includes("unknown escape") ||
      m.includes("char literal must contain"))
    return 'Lexical';

  if (m.includes("type mismatch") || m.includes("expected bigint") ||
      m.includes("expected string") || m.includes("expected list") ||
      m.includes("requires a char") || m.includes("requires a string") ||
      m.includes("requires an integer") || m.includes("requires a list") ||
      m.includes("requires a dict") || m.includes("must be a string") ||
      m.includes("must be an integer") || m.includes("keys must be"))
    return 'Type';

  if (m.includes("undefined variable") || m.includes("unknown type") ||
      m.includes("cannot assign to immutable") || m.includes("property '") ||
      m.includes("not found") && !m.includes("key not found") && !m.includes("module not found"))
    return 'Name';

  if (m.includes("expected '") || m.includes("unexpected token") ||
      m.includes("expected function") || m.includes("expected procedure") ||
      m.includes("expected variable") || m.includes("expected type") ||
      m.includes("expected parameter") || m.includes("expected module") ||
      m.includes("expected import") || m.includes("expected variant") ||
      m.includes("expected namespace") || m.includes("expected alias") ||
      m.includes("'then'") || m.includes("'->'") || m.includes("'=>'") ||
      m.includes("'with'"))
    return 'Syntax';

  if (m.includes("key not found") || m.includes("missing field") ||
      m.includes("index") && m.includes("out of bounds"))
    return 'Key';

  if (m.includes("expects") && (m.includes("field") || m.includes("argument")))
    return 'Arity';

  if (m.includes("module not found") || m.includes("circular import") ||
      m.includes("does not export") || m.includes("cannot find module"))
    return 'Import';

  if (m.includes("enoent") || m.includes("no such file") || m.includes("permission denied") ||
      m.includes("readfile") || m.includes("writefile") || m.includes("fileopen"))
    return 'File';

  if (m.includes("stdin") || m.includes("stdout") || m.includes("readchar") ||
      m.includes("readln"))
    return 'IO';

  return 'Runtime';
}

// ─── Extract all identifier names referenced in an AST node ──────────────────

export function collectIdents(node: Expr | Stmt | null | undefined): Set<string> {
  const result = new Set<string>();
  if (!node) return result;

  function walk(n: Expr | Stmt | null | undefined) {
    if (!n) return;
    switch (n.type) {
      case 'IdentExpr':
        result.add(n.name);
        break;
      case 'AssignExpr':
        result.add(n.name);
        walk(n.value);
        break;
      case 'GetExpr':
        // Only collect the root object ident (e.g. 'p' in p.x), not field names
        walk(n.object);
        break;
      case 'BinaryExpr':
        walk(n.left);
        walk(n.right);
        break;
      case 'UnaryExpr':
        walk(n.right);
        break;
      case 'GroupExpr':
        walk(n.expression);
        break;
      case 'CallExpr':
        walk(n.callee);
        n.args.forEach(walk);
        break;
      case 'TernaryExpr':
        walk(n.condition);
        walk(n.thenBranch);
        walk(n.elseBranch);
        break;
      case 'IndexExpr':
      case 'IndexAssignExpr':
        walk(n.object);
        walk(n.index);
        if (n.type === 'IndexAssignExpr') walk(n.value);
        break;
      case 'ListExpr':
        n.elements.forEach(walk);
        break;
      case 'RecordExpr':
        n.fields.forEach(f => walk(f.value));
        break;
      case 'MatchExpr':
        walk(n.subject);
        n.arms.forEach(arm => {
          if (arm.guard) walk(arm.guard);
          walk(arm.body);
        });
        break;
      case 'ComprehensionExpr':
        n.generators.forEach(g => walk(g.source));
        if (n.guard) walk(n.guard);
        walk(n.body);
        break;
      case 'DictExpr':
        n.entries.forEach(e => { walk(e.key); walk(e.value); });
        break;
      case 'LambdaExpr':
        // Don't recurse into lambda body — the params shadow outer scope
        break;
      case 'BlockExpr':
        n.statements.forEach(walk);
        break;
      // Statements
      case 'ExprStmt':
      case 'EvalStmt':
        walk(n.expression);
        break;
      case 'LetStmt':
      case 'VarStmt':
        walk(n.initializer);
        break;
      case 'IfStmt':
        walk(n.condition);
        walk(n.thenBranch);
        if (n.elseBranch) walk(n.elseBranch);
        break;
      case 'ReturnStmt':
        if (n.value) walk(n.value);
        break;
      case 'BlockStmt':
        n.statements.forEach(walk);
        break;
      default:
        break;
    }
  }

  walk(node);
  return result;
}

// ─── Collect function/procedure call names referenced directly in an expression
// These are identifiers used as callees — we don't want to print them as values.

export function collectDirectCallees(node: Expr | Stmt | null | undefined): Set<string> {
  const callees = new Set<string>();
  if (!node) return callees;

  function walk(n: Expr | Stmt | null | undefined) {
    if (!n) return;
    if (n.type === 'CallExpr') {
      if (n.callee.type === 'IdentExpr') callees.add(n.callee.name);
      n.args.forEach(walk);
      return;
    }
    // Recurse for compound expressions
    switch (n.type) {
      case 'BinaryExpr':   walk(n.left);      walk(n.right);        break;
      case 'UnaryExpr':    walk(n.right);                           break;
      case 'GroupExpr':    walk(n.expression);                      break;
      case 'TernaryExpr':  walk(n.condition); walk(n.thenBranch); walk(n.elseBranch); break;
      case 'GetExpr':      walk(n.object);                          break;
      case 'AssignExpr':   walk(n.value);                           break;
      case 'IndexExpr':    walk(n.object); walk(n.index);           break;
      case 'IndexAssignExpr': walk(n.object); walk(n.index); walk(n.value); break;
      case 'ListExpr':     n.elements.forEach(walk);                break;
      case 'RecordExpr':   n.fields.forEach(f => walk(f.value));    break;
      case 'MatchExpr':    walk(n.subject); n.arms.forEach(arm => { if (arm.guard) walk(arm.guard); walk(arm.body); }); break;
      case 'ComprehensionExpr': n.generators.forEach(g => walk(g.source)); if (n.guard) walk(n.guard); walk(n.body); break;
      case 'DictExpr':     n.entries.forEach(e => { walk(e.key); walk(e.value); }); break;
      case 'BlockExpr':    n.statements.forEach(walk); break;
      case 'ExprStmt':     walk(n.expression); break;
      case 'EvalStmt':     walk(n.expression); break;
      case 'LetStmt':      walk(n.initializer); break;
      case 'VarStmt':      walk(n.initializer); break;
      case 'IfStmt':       walk(n.condition); walk(n.thenBranch); if (n.elseBranch) walk(n.elseBranch); break;
      case 'ReturnStmt':   if (n.value) walk(n.value); break;
      case 'BlockStmt':    n.statements.forEach(walk); break;
      default: break;
    }
  }

  walk(node);
  return callees;
}

// ─── Format a runtime value as a short summary string ─────────────────────────

export function formatValue(value: any, interp: { stringify(v: any): string }): string {
  if (value === undefined || value === null) return '<Undef>';

  // Lazy thunk — not yet evaluated
  if (value && value.constructor && value.constructor.name === 'Thunk') return '<Undef>';

  // PfunFunction (function or procedure)
  if (value && value.constructor && value.constructor.name === 'PfunFunction') {
    const fn = value as any;
    if (fn.kind === 'procedure') {
      return `proc ${fn.name ?? '(anonymous)'}`;
    }
    // Distinguish single-param inline lambda (body is an Expr) from named function
    if (fn.name === null) {
      // Lambda — show inline if body is a simple expression
      const bodyExpr = fn.body;
      if (!Array.isArray(bodyExpr)) {
        const paramStr = fn.params.join(', ');
        const bodyStr = exprToString(bodyExpr);
        if (bodyStr !== null && bodyStr.length <= 40) {
          return `fn ${paramStr} => ${bodyStr}`;
        }
        return 'fn ...';
      }
      return 'fn ...';
    }
    return `fun ${fn.name}`;
  }

  // NativeFunction
  if (value && value.constructor && value.constructor.name === 'NativeFunction') {
    return '<native fn>';
  }

  // LazyList
  if (value && value.constructor && value.constructor.name === 'LazyList') {
    return '<lazylist>';
  }

  // PfunDict
  if (value && value.constructor && value.constructor.name === 'PfunDict') {
    return 'dict { ... }';
  }

  // PfunChar
  if (value && value.constructor && value.constructor.name === 'PfunChar') {
    return `'${value.value}'`;
  }

  // Arrays (lists)
  if (Array.isArray(value)) {
    // Char list — it's a string at runtime
    if (value.length > 0 && value.every((c: any) => c && c.constructor && c.constructor.name === 'PfunChar')) {
      const s = value.map((c: any) => c.value).join('');
      return `"${s.length > 20 ? s.slice(0, 20) + '...' : s}"`;
    }
    if (value.length === 0) return 'List (empty)';
    const first = interp.stringify(value[0]);
    return `List (${first} ...)`;
  }

  // Union/record type
  if (value && typeof value === 'object' && value.__type) {
    const unionName = value.__union;
    const typeName  = value.__type;
    if (unionName && unionName !== typeName) {
      return `${unionName}: ${typeName}`;
    }
    const fields = Object.keys(value).filter(k => k !== '__type' && k !== '__union');
    if (fields.length === 0) return `${typeName}`;
    return `${typeName} record`;
  }

  // Primitives — just stringify
  const s = interp.stringify(value);
  // Truncate long strings
  if (s.length > 60) return s.slice(0, 57) + '...';
  return s;
}

// ─── Convert a simple Expr back to a short source string (for lambda display) ─

function exprToString(expr: Expr): string | null {
  switch (expr.type) {
    case 'IntExpr':   return expr.value.toString();
    case 'BoolExpr':  return expr.value.toString();
    case 'StrExpr':   return `"${expr.value}"`;
    case 'CharExpr':  return `'${expr.value}'`;
    case 'IdentExpr': return expr.name;
    case 'BinaryExpr': {
      const l = exprToString(expr.left);
      const r = exprToString(expr.right);
      if (l === null || r === null) return null;
      const opMap: Record<string, string> = {
        PlusToken: '+', MinusToken: '-', StarToken: '*', SlashToken: '/',
        PercentToken: '%', EqualToken: '==', NotEqualToken: '!=',
        GreaterToken: '>', LessToken: '<', GreaterEqualToken: '>=',
        LessEqualToken: '<=', BooleanAnd: '&&', BooleanOr: '||',
      };
      const op = opMap[expr.operator] ?? expr.operator;
      return `${l} ${op} ${r}`;
    }
    case 'UnaryExpr': {
      const r = exprToString(expr.right);
      if (r === null) return null;
      return expr.operator === 'BooleanNot' ? `!${r}` : `-${r}`;
    }
    case 'GroupExpr': {
      const inner = exprToString(expr.expression);
      return inner === null ? null : `(${inner})`;
    }
    case 'GetExpr': {
      const obj = exprToString(expr.object);
      return obj === null ? null : `${obj}.${expr.name}`;
    }
    default: return null;
  }
}

// ─── PfunError ────────────────────────────────────────────────────────────────

export class PfunError extends Error {
  public readonly kind: ErrorKind;
  public readonly pfunMessage: string;

  constructor(
    kind: ErrorKind,
    message: string,
    pos: SourcePos | undefined,
    sourceText: string,
    bindings: { name: string; display: string }[]
  ) {
    const formattedMessage = PfunError.format(kind, message, pos, sourceText, bindings);
    super(formattedMessage);
    this.name = 'PfunError';
    this.kind = kind;
    this.pfunMessage = formattedMessage;
    // Hide the TypeScript stack trace from user-facing output
    this.stack = this.name + ': ' + formattedMessage;
  }

  private static format(
    kind: ErrorKind,
    message: string,
    pos: SourcePos | undefined,
    sourceText: string,
    bindings: { name: string; display: string }[]
  ): string {
    const lines: string[] = [];

    // Header: "[Type] Error on line N/chM:"
    if (pos) {
      lines.push(`[${kind}] Error on line ${pos.line}/ch${pos.col}:`);
    } else {
      lines.push(`[${kind}] Error:`);
    }

    // The error message itself, indented
    lines.push(`  ${message}`);

    // The failing source line, if available
    if (pos && sourceText) {
      const srcLines = sourceText.split('\n');
      const lineText = srcLines[pos.line - 1];
      if (lineText !== undefined) {
        lines.push(`  ${lineText.trimEnd()}`);
        // Caret pointing at the column
        const caretPad = ' '.repeat(pos.col + 1);
        lines.push(`  ${caretPad}^`);
      }
    }

    // Identifier bindings
    if (bindings.length > 0) {
      lines.push('');
      for (const { name, display } of bindings) {
        lines.push(`  ${name} = ${display}`);
      }
    }

    return lines.join('\n');
  }
}

// ─── Error builder — called by the interpreter ────────────────────────────────

/**
 * Build a PfunError from a raw Error, source text, position, and environment snapshot.
 *
 * @param err        The original Error thrown by lexer / parser / interpreter
 * @param source     The full source text of the file (for extracting the failing line)
 * @param pos        The SourcePos where the error occurred (may be undefined)
 * @param node       The AST node being evaluated (to extract referenced identifiers)
 * @param envLookup  A function to look up an identifier's current value
 * @param interp     The interpreter instance (needed for stringify / formatValue)
 */
export function buildPfunError(
  err: Error,
  source: string,
  pos: SourcePos | undefined,
  node: Expr | Stmt | null | undefined,
  envLookup: (name: string) => any,
  interp: { stringify(v: any): string }
): PfunError {
  const kind = classifyError(err.message);

  // Collect identifiers, then exclude those that are direct callees
  const allIdents  = node ? collectIdents(node)        : new Set<string>();
  const calleeIds  = node ? collectDirectCallees(node) : new Set<string>();

  // Builtins / keywords we don't want to show
  const builtins = new Set([
    'head', 'tail', 'cons', 'map', 'filter', 'reduce',
    'take', 'iterate', 'repeat', 'cycle', 'slice', 'nth', 'isInfinite',
    'find', 'findSlice', 'asc', 'chr', 'has', 'remove', 'keys', 'values',
    'print', 'println', '__str__', 'readChar', 'readln',
    'readFile', 'writeFile', 'fileOpen', 'fileClose', 'readLine', 'writeLine', 'writeChar',
    'Some', 'None', 'true', 'false',
  ]);

  const bindings: { name: string; display: string }[] = [];
  for (const name of allIdents) {
    if (calleeIds.has(name)) continue;  // Skip direct callees
    if (builtins.has(name)) continue;   // Skip builtins
    let rawValue: any;
    try {
      rawValue = envLookup(name);
    } catch {
      rawValue = undefined;
    }
    bindings.push({ name, display: formatValue(rawValue, interp) });
  }

  return new PfunError(kind, err.message, pos, source, bindings);
}
