
// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { checkTypes } from './typechecker';
import { checkProgram } from './wholeProgramCheck';
import { Interpreter, ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { mutStructuresFunctions, mutStructuresTypes } from './mutStructures';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { jsonlibFunctions } from './jsonlib';
import { mathlibFunctions } from './mathlib';
import { asynclibFunctions } from './asynclib';
import { httplibFunctions, httplibTypes } from './httplib';
import { dblibTypes } from './dblib';
import { dblibPostgresqlFunctions } from './dblibPostgresql';
import { dblibMariadbFunctions } from './dblibMariadb';
import { PfunError, buildPfunError } from './errors';

/**
 * Sets up a fresh interpreter with the core standard library.
 * IO functions are NOT included here — scripts must: import * from 'io';
 */
function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
}

/** Register all built-in system modules ('io', 'file', 'json', 'math', 'async', 'http', 'db/postgresql', 'db/mariadb') on a loader. */
export function registerBuiltinModules(loader: ModuleLoader): void {
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('file', filelibFunctions, filelibTypes);
  loader.registerBuiltin('json', jsonlibFunctions);
  loader.registerBuiltin('math', mathlibFunctions);
  loader.registerBuiltin('async', asynclibFunctions);
  loader.registerBuiltin('http', httplibFunctions, httplibTypes);
  loader.registerBuiltin('db/postgresql', dblibPostgresqlFunctions, dblibTypes);
  loader.registerBuiltin('db/mariadb', dblibMariadbFunctions, dblibTypes);
}

// ── Async/await (phase 4) ────────────────────────────────────────────────
// runFile is now async and drives top-level statements via interpretAsync,
// so a top-level `await` (or a top-level call to an async proc that itself
// awaits) performs a real suspend/resume rather than throwing runSync's
// "yielded an Effect" error. Non-async programs are unaffected — runAsync
// is a no-op driver loop when no 'await' Effect is ever yielded.
export async function runFile(filePath: string, scriptArgs: string[] = []) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const baseDir = path.dirname(absolutePath);
  const loader  = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);
  registerBuiltinModules(loader);

  // Whole-program static checking: walks the entire import graph (the
  // entry file plus everything it transitively imports), parsing each
  // file EXACTLY ONCE, and runs BOTH procedure-usage/purity checking AND
  // type/exhaustiveness checking against every module in the graph — not
  // just this one (including a lex/syntax error in the entry file itself,
  // which used to be caught by a separate try/catch here before
  // checkProgram existed — checkProgram's own internal parsing already
  // produces an identically-formatted [Lexical]/[Syntax] PfunError via
  // the same buildPfunError pipeline, so that separate try/catch is gone
  // too). See wholeProgramCheck.ts's file header for the full design.
  //
  // Stage 3 ("remove the double-parse"): checkProgram now returns the
  // Map<resolvedPath, checkedAST> (and the parallel Map<resolvedPath,
  // sourceText>) it built internally — every module's AST, already
  // parsed, already checked, already inferredType-annotated, plus its
  // already-read source text — so this function no longer does ANY
  // separate parse or read of the entry file at all; `ast`/`source`
  // below come directly from these maps.
  //
  // Stage 3 (all-errors batching): `errors` collects EVERY violation
  // found anywhere in the whole import graph, not just the first — print
  // all of them before exiting, so a single run surfaces everything that
  // needs fixing instead of one error per run. (The one exception is a
  // graph-level failure — missing file, circular import, or a lex/parse
  // error while building the graph itself — which is unavoidably a
  // single error; see checkProgram's docblock.)
  const { errors: programErrors, checkedAsts, checkedSources } = checkProgram(absolutePath, loader);
  if (programErrors.length > 0) {
    for (const err of programErrors) console.error(err.pfunMessage);
    process.exit(1);
  }
  // Hand the whole map to the loader so load() (interpreter.ts), called
  // for every `import` actually reached during interpretation below,
  // reuses these already-checked ASTs instead of re-parsing and
  // re-checking each dependency file a second time — the other half of
  // the double-parse this stage removes. See ModuleLoader.checkedAsts's
  // docblock for why a non-empty map is also a sufficient signal that the
  // whole graph was already statically checked.
  loader.checkedAsts = checkedAsts;

  const ast    = checkedAsts.get(absolutePath)!;
  const source = checkedSources.get(absolutePath)!;

  const interp = new Interpreter(baseDir, loader);
  interp.scriptArgs = scriptArgs;
  setupInterpreter(interp);

  try {
    await interp.interpretAsync(ast, source);
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
 * complete, then that chunk is one entry. Used by loadReplFile() (both to
 * build the sanitized whole-file text for checkProgram — see
 * stripReplPrintMarkers — and to actually evaluate the file entry-by-entry
 * afterward) and by feedSource() to evaluate interactively-typed entries.
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
 * Stage 3 (REPL preload routing): produce a version of `source` that is
 * valid standalone .pf syntax — suitable for checkProgram, which parses
 * the WHOLE file (and everything it imports) as one ordinary program —
 * by blanking out exactly the trailing `?` REPL-print markers `entries`
 * (from splitEntries(source)) identified as "this entry wants its result
 * printed", and nothing else.
 *
 * Each qualifying `?` is replaced with a single space IN PLACE, rather
 * than removed: every other character keeps its exact original offset,
 * so any error position checkProgram reports against the sanitized text
 * still points at the exact same line/column the user would see by
 * opening the real file (same length, same line breaks throughout —
 * the lexer treats the replacement space as ordinary skippable
 * whitespace, same as it would the `?` it replaced from the parser's
 * point of view... except now it parses).
 *
 * `entries` must be exactly `splitEntries(source)`'s own output for this
 * `source` — the caller already has it (needed separately for the actual
 * entry-by-entry evaluation pass), so this takes it as a parameter rather
 * than re-deriving it.
 */
function stripReplPrintMarkers(source: string, entries: string[]): string {
  let sanitized  = source;
  let searchFrom = 0;
  for (const entry of entries) {
    const idx = sanitized.indexOf(entry, searchFrom);
    if (idx === -1) continue; // defensive: entries are always exact substrings of source in order
    const trimmed = entry.trimEnd();
    if (trimmed.endsWith('?')) {
      const qPos = idx + trimmed.length - 1; // absolute offset of the '?' within `sanitized`
      sanitized = sanitized.slice(0, qPos) + ' ' + sanitized.slice(qPos + 1);
    }
    searchFrom = idx + entry.length;
  }
  return sanitized;
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
 * Stage 3 (REPL preload routing): the WHOLE file — including everything it
 * transitively imports — is checked up front via checkProgram, exactly as
 * runFile() checks an entry file. This replaces the old per-entry,
 * no-resolver checkTypes loop, which checked each chunk in total isolation
 * and so could never catch a type error spanning two of the file's own
 * entries, let alone anything across an `import` boundary. Since the
 * file's trailing-`?` print markers aren't valid standalone .pf syntax,
 * checkProgram is given a sanitized copy (see stripReplPrintMarkers) with
 * those markers blanked out in place — entryPath itself still points at
 * the real file on disk, so any error position reported still lines up
 * with what the user sees in their editor. On any error (now batched —
 * see checkProgram's docblock — so every violation in the file or its
 * imports is reported in one shot, not just the first), prints and exits
 * without starting the REPL, matching runFile's fail-fast behavior.
 *
 * Once the whole file passes, it's split into entries (see splitEntries)
 * and each is evaluated IMMEDIATELY via evalEntryImmediately() — unlike
 * interactive input, file entries are NOT queued waiting for a `?`. The
 * file's contents are fully known upfront, so there's nothing to gain by
 * deferring, and a file with no `?` lines should still define everything
 * it contains.
 *
 * Evaluation still happens under the `inPureContext` enforcement set up by
 * runRepl(), so any side-effecting call (println, var, array/dict mutation,
 * calling a `proc`, etc.) throws "side effects are not allowed" exactly as
 * it would if typed interactively — checkProgram's checkProcedureUsage
 * pass only flags genuine same-module rule violations (a `function`
 * misusing a `proc`/`var`), never a side-effecting call by itself; it
 * doesn't change what's loadable here, only what's caught statically
 * up front versus at the call site during evaluation.
 *
 * Entries ending in `?` print their result immediately during load — this
 * lets a "REPL warm-up file" double as a quick smoke test (e.g.
 * `assertEquals(...)?` lines).
 *
 * Runtime errors during loading (including purity violations, which are
 * only ever caught at the call site — see above) are reported per-entry
 * without aborting the load — later entries still get a chance to load.
 *
 * @param loader,baseDir  The SAME ModuleLoader instance and baseDir
 *   `runRepl` constructed `interp` with. These are passed in (rather than
 *   this function building its own) specifically so checkProgram resolves
 *   the file's own `./`/`../`-relative imports exactly the way evaluation
 *   will actually resolve them afterward: the REPL's Interpreter always
 *   resolves a preloaded/typed-in import relative to `process.cwd()` (see
 *   runRepl), not relative to wherever the preloaded file happens to live
 *   on disk — a mismatch here would mean checkProgram silently validates
 *   against a different file than the one `import` statements will
 *   actually hit at evaluation time (see buildModuleGraph's
 *   `entryFromDir` parameter, which carries this baseDir through).
 */
function loadReplFile(interp: Interpreter, filePath: string, loader: ModuleLoader, baseDir: string): void {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const source  = fs.readFileSync(absolutePath, 'utf-8');
  const entries = splitEntries(source);

  const { errors } = checkProgram(absolutePath, loader, stripReplPrintMarkers(source, entries), baseDir);
  if (errors.length > 0) {
    for (const err of errors) console.error(err.pfunMessage);
    process.exit(1);
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
 *   - Any impure builtin (println, readLine, writeFile, ...) throws "side
 *     effects are not allowed in pure functions" the moment it's called —
 *     not when it's merely defined or imported.
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
    loadReplFile(interp, filePath, loader, baseDir);
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
    const typeErrors = checkTypes(ast, source);
    if (typeErrors.length > 0) throw typeErrors[0];
  } catch (e) {
    const errSource = wantsPrint ? source : raw;
    const rawErr = e instanceof Error ? e : new Error(String(e));
    const pfunErr = rawErr instanceof PfunError
      ? rawErr
      : buildPfunError(rawErr, errSource, (rawErr as any).pos, null, () => undefined, { stringify: String });
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
      const typeErrors = checkTypes(ast, source);
      if (typeErrors.length > 0) throw typeErrors[0];
    } catch (e) {
      const errSource = source;
      const rawErr = e instanceof Error ? e : new Error(String(e));
      const pfunErr = rawErr instanceof PfunError
        ? rawErr
        : buildPfunError(rawErr, errSource, (rawErr as any).pos, null, () => undefined, { stringify: String });
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

// Only run the CLI driver when this file is executed directly (`pfun ...`),
// not when imported as a module (e.g. by tests importing
// registerBuiltinModules) — otherwise `process.exit(1)` in the
// no-arguments branch would kill the importing process/test runner.
if (require.main === module) {
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
    runFile(args[0], args.slice(1)).catch(e => {
      // runFile already handles PfunError/wrapError + process.exit(1) for
      // expected interpreter errors. This catch only guards against truly
      // unexpected exceptions escaping interpretAsync (e.g. a bug in the
      // driver itself) so they're reported rather than becoming a silent
      // unhandled rejection.
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
  }
}
