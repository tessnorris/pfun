
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
 * Split source into the same top-level "entries" the interactive REPL would
 * receive one at a time: lines accumulate until bracket/string balance is
 * complete, then that chunk is one entry. Used by loadReplFile() to check
 * purity entry-by-entry (since a trailing `?` makes a chunk un-parseable as
 * a whole-file AST) and by feedSource() to evaluate them.
 */
function splitEntries(source: string): string[] {
  const lines = source.split('\n');
  const entries: string[] = [];
  let buffer = '';
  for (const line of lines) {
    buffer += (buffer.length > 0 ? '\n' : '') + line;
    if (isIncomplete(buffer)) continue;
    if (buffer.trim().length > 0) entries.push(buffer);
    buffer = '';
  }
  if (buffer.trim().length > 0) entries.push(buffer);
  return entries;
}

/**
 * Feed pre-split entries through the REPL's evaluation pipeline. Trailing `?`
 * behaves identically whether the entries came from stdin or a file.
 */
function feedEntries(interp: Interpreter, entries: string[]): void {
  for (const entry of entries) evalEntryImmediately(interp, entry);
}

/**
 * Load a .pf file's declarations into the REPL's persistent environment
 * before the interactive prompt starts.
 *
 * The file is split into entries (see splitEntries) and each entry is
 * evaluated IMMEDIATELY via evalEntryImmediately() — unlike interactive
 * input, file entries are NOT queued waiting for a `?`. The file's contents
 * are fully known upfront, so there's nothing to gain by deferring, and a
 * file with no `?` lines should still define everything it contains.
 *
 * Evaluation still happens under the `inPureContext` enforcement set up by
 * runRepl(), so any side-effecting call (println, var, array/dict mutation,
 * calling a `proc`, etc.) throws "side effects are not allowed" exactly as
 * it would if typed interactively. There's no separate static check: a
 * module full of `function`s loads regardless of what it imports, because
 * the functions are pure by construction.
 *
 * Entries ending in `?` print their result immediately during load — this
 * lets a "REPL warm-up file" double as a quick smoke test (e.g.
 * `assertEquals(...)?` lines).
 *
 * On a lex/parse error, prints an error and exits without starting the REPL
 * (matching `runFile`'s fail-fast behavior). Runtime errors during loading
 * (including purity violations) are reported per-entry without aborting the
 * load — later entries still get a chance to load.
 */
function loadReplFile(interp: Interpreter, filePath: string): void {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const source  = fs.readFileSync(absolutePath, 'utf-8');
  const entries = splitEntries(source);

  // Fail fast on lex/parse errors before evaluating anything.
  for (const entry of entries) {
    const trimmed = entry.trimEnd();
    const withoutQ = trimmed.endsWith('?') ? trimmed.slice(0, -1) : entry;
    try {
      new Parser(new Lexer(withoutQ).lex()).parse();
    } catch (e) {
      const rawErr = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(rawErr, withoutQ, (rawErr as any).pos, null, () => undefined, { stringify: String });
      console.error(pfunErr.pfunMessage);
      process.exit(1);
    }
  }

  feedEntries(interp, entries);
}

/**
 * Interactive REPL (`pfun -i [file.pf]`).
 *
 * Pfun's REPL only supports purely functional code: `let`, `function`, `type`,
 * and `union type` declarations accumulate in a persistent environment across
 * inputs. There's no static restriction on `var`/`proc`/`import`/`export` —
 * instead, `interp.inPureContext` is set to `true` for the whole session, so
 * the interpreter's existing purity rules apply at the top level exactly as
 * they would inside a `function` body:
 *   - `var` and array/dict mutation throw immediately.
 *   - Calling a `proc` throws "Functions cannot call procedures".
 *   - Any impure builtin (println, readLine, writeFile, jsonWriteFile, ...)
 *     throws "side effects are not allowed in pure functions" the moment
 *     it's called — not when it's merely defined or imported.
 * This means `import * from "math"` (or any user module) is always allowed;
 * if that module happens to export something impure, using it throws at the
 * call site with a clear message, same as it would in a `function`. Users
 * can build and import their own pure libraries freely.
 *
 * Lines entered interactively are QUEUED, not evaluated, until `?` appears:
 *
 * - `let`/`function`/`type`/`union type`/expression — each complete entry
 *   (one bracket-balanced statement-group) is appended to a pending queue
 *   and the prompt returns immediately. Nothing is evaluated yet.
 * - When an entry ends in `?`, the WHOLE QUEUE (including this entry, minus
 *   its `?`) is flushed: each entry's statements are forced in order against
 *   the persistent global environment, exactly as `interp.interpret()` would
 *   for a `.pf` file. The queue is then cleared.
 *   - If every entry evaluates successfully AND the final entry is a bare
 *     expression (no trailing `;`/`}`), that expression's value is printed.
 *   - If any entry throws, the error is reported and the flush stops there
 *     — later entries (including the final expression) are never reached
 *     and nothing is printed. Earlier entries' effects are NOT rolled back:
 *     a `let` that succeeded before the error remains defined.
 *   - `?` after a declaration with no trailing expression (`let x = 5; ?`)
 *     is a syntax error for THAT entry specifically.
 *   - A lone `?` flushes the queue but has no expression of its own.
 *
 * Example:
 *     > let x = 3;     (queued)
 *     > 1/0;           (queued)
 *     > 8?             (queued, '?' triggers flush)
 *
 *     Flush evaluates `let x = 3;` (succeeds — x=3), then `1/0;` (throws
 *     DivideByZero) — error reported, flush stops. `8` is never reached.
 *     The queue is cleared either way; `x` remains 3 for future input.
 *
 * - `allowGlobalRedef` is enabled so re-entering `let x = ...` for a name
 *   already defined doesn't error — essential for iterative REPL use.
 * - Multi-line input: if brackets are unbalanced or a string/char literal is
 *   left open, the REPL keeps prompting with a continuation prompt ("... ")
 *   until that single entry is complete (independent of queueing).
 * - Errors are caught per-flush and reported without exiting the REPL.
 *
 * If `filePath` is given, its declarations (let/function/type/union type/
 * import/...) are loaded into the session first via loadReplFile() — subject
 * to the same `inPureContext` enforcement as interactive input. A lex/parse
 * error in the file aborts before the prompt starts; a runtime purity
 * violation in one entry is reported but doesn't stop later entries from
 * loading.
 */
function runRepl(filePath?: string) {
  const baseDir = process.cwd();
  const loader  = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);
  registerBuiltinModules(loader);

  const interp = new Interpreter(baseDir, loader);
  setupInterpreter(interp);
  interp.allowGlobalRedef = true;
  // Treat top-level REPL input as if it were inside a `function` body: var,
  // mutation, calling procedures, and impure builtins all throw "side effects
  // are not allowed" at the point of use, exactly as the interpreter already
  // enforces inside user-defined functions.
  interp.inPureContext = true;

  console.log('pfun interactive mode. End a line with ? to evaluate and print it.');
  console.log('Press Ctrl+D or type :quit to exit.');


  if (filePath) {
    console.log(`Loading '${filePath}'...`);
    loadReplFile(interp, filePath);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  let buffer = '';
  // Entries accumulated since the last '?' flush. Each entry is one
  // complete (bracket-balanced) statement-group, evaluated only when '?'
  // is seen — see flushQueue().
  const queue: string[] = [];

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

    queue.push(raw);

    if (raw.trim() === '?' || raw.trim().endsWith('?')) {
      flushQueue(interp, queue);
      queue.length = 0;
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

/**
 * Evaluate one already-complete entry for file loading: every statement is
 * forced in order (matching `interp.interpret()`), and if the entry ends in
 * `?`, the final bare expression's value is printed. Used by feedEntries() —
 * files are evaluated immediately, entry by entry, with no queueing (the
 * file's contents are fully known upfront, so there's nothing to defer).
 */
function evalEntryImmediately(interp: Interpreter, raw: string): void {
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

  if (wantsPrint && ast.length === 0) return; // lone '?' — nothing to print

  const lastStmt = ast[ast.length - 1];
  const lastIsExpr = lastStmt?.type === 'ExprStmt';

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
      return;
    }
  }
}

/**
 * Flush a queue of accumulated REPL entries: evaluate each entry's statements
 * in order against the persistent global environment, stopping at the first
 * error. Earlier entries' effects (e.g. `let x = 3;` defining `x`) persist
 * even if a later entry in the queue throws — nothing is rolled back.
 *
 * If the LAST entry in the queue ends in `?` and parses to a trailing bare
 * expression, that expression's value is printed — but only if every entry
 * up to and including it evaluated successfully. If an earlier entry throws,
 * the error is reported and evaluation stops there; the final expression
 * (and anything queued after the failing entry) is never reached.
 *
 * A lone `?` as the last entry flushes everything queued before it but has
 * no expression of its own to print.
 *
 * Example:
 *     > let x = 3;     (queued)
 *     > 1/0;           (queued)
 *     > 8?             (queued, ends in '?' -> flush now)
 *
 *     Flush evaluates: `let x = 3;` (succeeds, x=3 now defined),
 *     then `1/0;` (throws DivideByZero) -> report error, stop.
 *     `8` is never evaluated or printed. The queue is cleared; `x` remains 3
 *     for future input.
 */
function flushQueue(interp: Interpreter, queue: string[]): void {
  if (queue.length === 0) return;

  // A lone '?' entry has nothing of its own to print — it means "evaluate
  // and show me the most recent expression's value". Strip any number of
  // trailing lone-'?' entries; if at least one was stripped, the new last
  // entry (if it's a bare expression) becomes the print target instead.
  // Example: ["x", "?"] -> printIndex = 0 (the "x" entry).
  //          ["x", "?", "?"] -> same, still entry 0.
  //          ["let y = 1;", "?"] -> printIndex = -1 (declaration, nothing to print).
  let end = queue.length;
  let strippedLoneQuestion = false;
  while (end > 0 && queue[end - 1].trim() === '?') {
    end--;
    strippedLoneQuestion = true;
  }

  // printIndex: index of the entry whose final expression should be printed
  // after a successful flush, or -1 if nothing should be printed.
  let printIndex = -1;
  if (end === 0) {
    // The whole queue was lone '?'s — nothing to print, just flush (no-op).
  } else if (strippedLoneQuestion) {
    // "x" / "?" — print entry [end-1] if it's a bare expression.
    printIndex = end - 1;
  } else if (queue[end - 1].trimEnd().endsWith('?')) {
    // "x?" on one line — print entry [end-1] (with its own '?' stripped).
    printIndex = end - 1;
  }
  // else: last entry ends in ';'/'}' with no '?' anywhere — nothing to print.

  const env = interp.getGlobalsEnv();

  for (let i = 0; i < end; i++) {
    const raw = queue[i];
    const isPrintTarget = i === printIndex;
    const trimmed = raw.trimEnd();
    // Strip a trailing '?' only from the entry that actually had one of its
    // own (not from an entry whose print duty was inherited from a later
    // lone '?', which has no '?' of its own to strip).
    const hasOwnQuestion = trimmed.endsWith('?');
    const source = (isPrintTarget && hasOwnQuestion) ? trimmed.slice(0, -1) : raw;

    let ast;
    try {
      ast = new Parser(new Lexer(source).lex()).parse();
    } catch (e) {
      const errSource = source;
      const rawErr = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(rawErr, errSource, (rawErr as any).pos, null, () => undefined, { stringify: String });
      console.error(pfunErr.pfunMessage);
      return;
    }

    const lastStmt = ast[ast.length - 1];
    const lastIsExpr = lastStmt?.type === 'ExprStmt';

    if (isPrintTarget && hasOwnQuestion && !lastIsExpr) {
      console.error(
        "[Syntax] '?' must follow an expression with no trailing ';' or '}'. " +
        `Got a '${lastStmt.type}' before '?'.`
      );
      return;
    }

    for (const stmt of ast) {
      try {
        const result = interp.force(interp.evaluateStmt(stmt, env));
        if (isPrintTarget && stmt === lastStmt && lastIsExpr) {
          console.log(interp.stringify(result));
        }
      } catch (e) {
        const pfunErr = e instanceof PfunError ? e : interp.wrapError(e);
        console.error(pfunErr.pfunMessage);
        return; // stop the whole flush — later queue entries are discarded
      }
    }
  }
}

const args = process.argv.slice(2);
if (args.includes('-i') || args.includes('--interactive')) {
  // Any non-flag argument is treated as a file to pre-load into the session.
  const fileArg = args.find(a => a !== '-i' && a !== '--interactive');
  runRepl(fileArg);
} else if (args.length === 0) {
  console.log('Usage: pfun <script.pf>');
  console.log('       pfun -i [script.pf]   (interactive mode, optionally pre-loading a file)');
  process.exit(1);
} else {
  runFile(args[0]);
}
