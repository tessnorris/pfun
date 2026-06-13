
// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { jsonlibFunctions } from './jsonlib';
import { mathlibFunctions } from './mathlib';
import { PfunError, buildPfunError } from './errors';

/**
 * Sets up a fresh interpreter with the core standard library.
 * IO functions are NOT included here — scripts must: import * from 'io';
 */
function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
}

/** Register all built-in system modules ('io', 'file', 'json', 'math') on a loader. */
function registerBuiltinModules(loader: ModuleLoader): void {
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('file', filelibFunctions, filelibTypes);
  loader.registerBuiltin('json', jsonlibFunctions);
  loader.registerBuiltin('math', mathlibFunctions);
}

function runFile(filePath: string) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const baseDir = path.dirname(absolutePath);
  const loader  = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);
  registerBuiltinModules(loader);

  const source = fs.readFileSync(absolutePath, 'utf-8');

  // Lex + parse — catch lexical and syntax errors here
  let ast;
  try {
    ast = new Parser(new Lexer(source).lex()).parse();
  } catch (e) {
    const raw = e instanceof Error ? e : new Error(String(e));
    const pfunErr = buildPfunError(raw, source, (raw as any).pos, null, () => undefined, { stringify: String });
    console.error(pfunErr.pfunMessage);
    process.exit(1);
  }

  const interp = new Interpreter(baseDir, loader);
  setupInterpreter(interp);

  try {
    interp.interpret(ast!, source);
  } catch (e) {
    if (e instanceof PfunError) {
      console.error(e.pfunMessage);
    } else {
      console.error(interp.wrapError(e).pfunMessage);
    }
    process.exit(1);
  }
}

/**
 * Returns true if `source` has balanced (), [], {} brackets — i.e. lexing it
 * does not end mid-construct. Used by the REPL to decide whether to keep
 * reading continuation lines before attempting to parse.
 *
 * Unterminated strings/chars also count as "incomplete" so the REPL waits
 * for the closing quote rather than erroring on a half-typed literal.
 */
function isIncomplete(source: string): boolean {
  let depth = 0;
  try {
    const tokens = new Lexer(source).lex();
    for (const tok of tokens) {
      switch (tok.type) {
        case 'LParenToken': case 'LBraceToken': case 'LBracketToken': depth++; break;
        case 'RParenToken': case 'RBraceToken': case 'RBracketToken': depth--; break;
      }
    }
    return depth > 0;
  } catch (e) {
    // Unterminated string/char literal — the lexer throws. Treat as incomplete
    // so the user can finish typing it on the next line.
    const msg = e instanceof Error ? e.message : String(e);
    if (/unterminated/i.test(msg)) return true;
    return false; // a genuine lex error — let the parser report it normally
  }
}

/**
 * Interactive REPL (`pfun -i`).
 *
 * Pfun's REPL only supports purely functional code: `let`, `function`, `type`,
 * and `union type` declarations accumulate in a persistent environment across
 * inputs. There is no `var`, no procedures, and no `io` import — the REPL is
 * a calculator over pure declarations plus an evaluation convention:
 *
 * - Input ending in `;` or `}` (after optional trailing `?`) is a normal
 *   declaration. It's parsed and evaluated for its definitional effect
 *   (defining `let`/`function`/`type` names) and prints nothing.
 * - If the input (after stripping a trailing `;`/`}`/whitespace as needed)
 *   ends with `?`, the `?` is stripped and the remaining text is parsed as
 *   an EXPRESSION, evaluated, and its value is printed. This lets you write
 *   `1 + 2 ?`, `sq(5)?`, or even define-then-evaluate in one go:
 *     `function sq(n) { return n*n; } sq(5)?`
 *
 * - `allowGlobalRedef` is enabled so re-entering `let x = ...` for a name
 *   already defined doesn't error — essential for iterative REPL use.
 * - Multi-line input: if brackets are unbalanced or a string/char literal is
 *   left open, the REPL keeps prompting with a continuation prompt ("... ")
 *   until the input is complete.
 * - Errors are caught per-entry and reported without exiting the REPL.
 */
function runRepl() {
  const baseDir = process.cwd();
  const loader  = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);
  registerBuiltinModules(loader);

  const interp = new Interpreter(baseDir, loader);
  setupInterpreter(interp);
  interp.allowGlobalRedef = true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  console.log('pfun interactive mode. End a line with ? to evaluate and print it.');
  console.log('Press Ctrl+D or type :quit to exit.');
  rl.prompt();

  let buffer = '';

  rl.on('line', (line) => {
    if (buffer.length === 0 && (line.trim() === ':quit' || line.trim() === ':q')) {
      rl.close();
      return;
    }

    buffer += (buffer.length > 0 ? '\n' : '') + line;

    if (isIncomplete(buffer)) {
      rl.setPrompt('... ');
      rl.prompt();
      return;
    }

    const raw = buffer;
    buffer = '';
    rl.setPrompt('> ');

    if (raw.trim().length === 0) {
      rl.prompt();
      return;
    }

    evalRepl(interp, raw);
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

/**
 * Process one complete REPL input.
 *
 * Detects a trailing `?` (the "evaluate and print" marker), strips it, and
 * — if present — parses the source twice: once as statements (so any
 * declarations before the final expression are still defined), and once with
 * the final expression's text re-parsed and evaluated for its value.
 *
 * Concretely: `?` must be the very last non-whitespace character of the
 * input. Everything before it is parsed as a normal statement sequence. If
 * the LAST statement is an ExprStmt (i.e. the part right before `?` was a
 * bare expression with no trailing `;`), that expression's value is printed.
 * Otherwise (e.g. the text before `?` ended in `;` or `}`), the `?` has
 * nothing to attach to and is reported as a syntax error.
 */
function evalRepl(interp: Interpreter, raw: string) {
  const trimmed = raw.trimEnd();
  const wantsPrint = trimmed.endsWith('?');
  const source = wantsPrint ? trimmed.slice(0, -1) : raw;

  let ast;
  try {
    ast = new Parser(new Lexer(source).lex()).parse();
  } catch (e) {
    const errSource = wantsPrint ? source : raw;
    const rawErr = e instanceof Error ? e : new Error(String(e));
    const pfunErr = buildPfunError(rawErr, errSource, (rawErr as any).pos, null, () => undefined, { stringify: String });
    console.error(pfunErr.pfunMessage);
    return;
  }

  if (wantsPrint && ast.length === 0) {
    console.error("[Syntax] Nothing to evaluate before '?'.");
    return;
  }

  const lastStmt = ast[ast.length - 1];
  const lastIsExpr = wantsPrint && lastStmt.type === 'ExprStmt';

  if (wantsPrint && !lastIsExpr) {
    console.error(
      "[Syntax] '?' must follow an expression with no trailing ';' or '}'. " +
      `Got a '${lastStmt.type}' before '?'.`
    );
    return;
  }

  const env = interp.getGlobalsEnv();
  for (const stmt of ast) {
    try {
      const result = interp.force(interp.evaluateStmt(stmt, env));
      if (wantsPrint && stmt === lastStmt) {
        console.log(interp.stringify(result));
      }
    } catch (e) {
      const pfunErr = e instanceof PfunError ? e : interp.wrapError(e);
      console.error(pfunErr.pfunMessage);
      return; // stop processing remaining statements in this input on error
    }
  }
}

const args = process.argv.slice(2);
if (args.includes('-i') || args.includes('--interactive')) {
  runRepl();
} else if (args.length === 0) {
  console.log('Usage: pfun <script.pf>');
  console.log('       pfun -i        (interactive mode)');
  process.exit(1);
} else {
  runFile(args[0]);
}
