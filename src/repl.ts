// src/repl.ts
// Pure functional REPL for Pfun.
//
// Usage:  npm run repl
//
// Rules:
//   - The interpreter runs in pure mode: var, proc, and all I/O are disallowed.
//   - Lines accumulate in a buffer until a line ending with '?' is entered.
//   - The '?' is stripped and the entire buffer is parsed and evaluated.
//   - Definitions (let, function, type) print a confirmation.
//   - Expression statements print their value.
//   - Errors print a formatted PfunError and clear the buffer; the session continues.
//   - Incomplete input (unexpected EOF from the parser) keeps accumulating silently.
//   - Type 'exit' or 'quit' (or Ctrl-D) to leave.

import * as readline from 'readline';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader, PfunFunction, PfunChar, LazyList, PfunDict, NativeFunction } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { PfunError, buildPfunError } from './errors';
import { Stmt } from './ast';

// ─── Interpreter setup ────────────────────────────────────────────────────────

const loader = new ModuleLoader(path.join(process.cwd(), 'lib'));
const interp = new Interpreter(process.cwd(), loader);
interp.registerLibrary(stdlibFunctions, stdlibTypes);
interp.inPureContext = true;  // Pure mode: no var, no proc, no I/O

// ─── Pretty-print a value for REPL output ─────────────────────────────────────
// More verbose than stringify() — shows function signatures, type tags, etc.

function prettyPrint(value: any): string {
  if (value === undefined || value === null) return 'nil';

  if (value instanceof PfunFunction) {
    const fn = value as any;
    const params = fn.params.join(', ');
    if (fn.kind === 'procedure') return `<proc ${fn.name ?? '?'}(${params})>`;
    if (fn.name)                 return `<fun ${fn.name}(${params})>`;
    // Anonymous lambda — show as fn expression
    return `<fn (${params})>`;
  }

  if (value instanceof NativeFunction) return '<built-in fn>';
  if (value instanceof LazyList)       return '<lazylist>';
  if (value instanceof PfunDict) {
    const entries = [...value.entries.entries()]
      .map(([k, v]) => `${k.slice(2)} -> ${interp.stringify(v)}`);
    if (entries.length === 0) return 'dict {}';
    return `dict { ${entries.join(', ')} }`;
  }

  // Everything else delegates to the interpreter's stringify
  return interp.stringify(value);
}

// ─── Describe what a statement defined (for confirmation messages) ────────────

function describeStmt(stmt: Stmt): string | null {
  switch (stmt.type) {
    case 'LetStmt':       return `${stmt.name}`;
    case 'FunctionStmt':  return `${stmt.name}(${stmt.params.join(', ')})`;
    case 'TypeStmt':      return `type ${stmt.name}`;
    case 'UnionTypeStmt': return `type ${stmt.name}`;
    case 'ImportStmt':    return stmt.kind === 'star' ? `* from "${stmt.path}"`
                               : stmt.kind === 'namespace' ? `* as ${stmt.alias} from "${stmt.path}"`
                               : `{ ${stmt.names.map(n => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ')} } from "${stmt.path}"`;
    default:              return null;
  }
}

// ─── Detect whether a parse error looks like incomplete input ─────────────────
// If the parser hit EOF unexpectedly, the user is probably mid-expression.
// Any other syntax error should be reported immediately.

function isIncompleteInput(err: Error): boolean {
  const m = err.message.toLowerCase();
  return m.includes('unexpected token') && m.includes('eof') ||
         m.includes("expected '}'") ||
         m.includes("expected ')'") ||
         m.includes("expected ']'") ||
         m.includes("expected '->'") ||
         m.includes("expected 'then'");
}

// ─── Evaluate a complete buffer ───────────────────────────────────────────────
// Returns true if eval succeeded, false on error.

function evalBuffer(buffer: string): boolean {
  // Try to lex and parse
  let stmts: Stmt[];
  try {
    stmts = new Parser(new Lexer(buffer).lex()).parse();
  } catch (e) {
    const raw = e instanceof Error ? e : new Error(String(e));
    const pfunErr = buildPfunError(raw, buffer, (raw as any).pos, null, () => undefined, interp);
    console.error('\n' + pfunErr.pfunMessage);
    return false;
  }

  // Execute each statement, printing results
  interp.sourceText = buffer;
  for (const stmt of stmts) {
    try {
      const result = interp.force(interp.evaluateStmt(stmt, (interp as any).globals));

      if (stmt.type === 'ExprStmt' || stmt.type === 'EvalStmt') {
        // Expression — print its value
        if (result !== undefined) {
          console.log('=> ' + prettyPrint(result));
        }
      } else {
        // Definition — print a confirmation
        const desc = describeStmt(stmt);
        if (desc) console.log(`   ${desc}`);
      }
    } catch (e) {
      const pfunErr = e instanceof PfunError ? e : interp.wrapError(e);
      console.error('\n' + pfunErr.pfunMessage);
      return false;
    }
  }

  return true;
}

// ─── REPL loop ────────────────────────────────────────────────────────────────

const PROMPT_FRESH    = 'pfun> ';
const PROMPT_CONTINUE = '   .. ';

let buffer: string[] = [];

function prompt(): string {
  return buffer.length === 0 ? PROMPT_FRESH : PROMPT_CONTINUE;
}

console.log('Pfun REPL — pure functional mode');
console.log('End a line with ? to evaluate. Type exit or quit to leave.\n');

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: PROMPT_FRESH,
});

rl.prompt();

rl.on('line', (rawLine: string) => {
  const line = rawLine;
  const trimmed = line.trimEnd();

  // Exit commands
  if (buffer.length === 0 && (trimmed === 'exit' || trimmed === 'quit')) {
    rl.close();
    return;
  }

  // Does this line end with '?' (after trimming whitespace)?
  const evalNow = trimmed.endsWith('?');
  // Strip the trailing '?' before adding to buffer
  const codeLine = evalNow ? trimmed.slice(0, -1) : line;

  buffer.push(codeLine);

  if (!evalNow) {
    // Try a speculative parse to detect genuine syntax errors early
    // (as opposed to just incomplete input). If it's incomplete, keep going.
    const speculative = buffer.join('\n');
    try {
      new Parser(new Lexer(speculative).lex()).parse();
      // Parses fine with no eval requested — just keep accumulating
    } catch (e) {
      const raw = e instanceof Error ? e : new Error(String(e));
      if (!isIncompleteInput(raw)) {
        // Real syntax error — report it and clear
        const pfunErr = buildPfunError(raw, speculative, (raw as any).pos, null, () => undefined, interp);
        console.error('\n' + pfunErr.pfunMessage);
        buffer = [];
      }
      // If incomplete, stay silent and keep accumulating
    }
    rl.setPrompt(prompt());
    rl.prompt();
    return;
  }

  // Evaluate the accumulated buffer
  const source = buffer.join('\n');
  buffer = [];
  evalBuffer(source);

  rl.setPrompt(PROMPT_FRESH);
  rl.prompt();
});

rl.on('close', () => {
  console.log('\nBye.');
  process.exit(0);
});
