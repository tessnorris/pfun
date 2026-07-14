
// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { bootstrapLint } from './bootstrapLint';
import { checkTypes } from './typechecker';
import { checkProgram } from './wholeProgramCheck';
import type { TypeImportTable, TypeImportResolver } from './inferencer';
import { Interpreter, ModuleLoader } from './interpreter';

// ── Bootstrap dialect state ────────────────────────────────────────────────
// The compiler front end runs in one of two dialects. 'legacy' is ordinary V1
// and is the default everywhere. 'bootstrap' accepts the V2 syntax superset in
// the lexer/parser and runs the bootstrapLint rejecter after every parse, so
// V1-extended can build V2 compiler sources. Set once from argv (see the
// require.main block). All source→AST goes through parseSource/lexSource so the
// dialect is applied uniformly at every call site.
let COMPILER_DIALECT: 'legacy' | 'bootstrap' = 'legacy';

function lexSource(source: string) {
  return new Lexer(source, COMPILER_DIALECT).lex();
}

function parseSource(source: string): ReturnType<Parser['parse']> {
  const ast = new Parser(lexSource(source)).parse();
  if (COMPILER_DIALECT === 'bootstrap') {
    const diags = bootstrapLint(ast);
    if (diags.length > 0) {
      const lines = diags.map(d => {
        const at = d.pos ? ` (line ${d.pos.line}, col ${d.pos.col})` : '';
        return `  bootstrap dialect: ${d.message}${at}`;
      });
      throw new Error('Bootstrap dialect violations:\n' + lines.join('\n'));
    }
  }
  return ast;
}
import { stdlibFunctions, stdlibTypes } from './library';
import { mutStructuresFunctions, mutStructuresTypes } from './mutStructures';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { jsonlibFunctions } from './jsonlib';
import { mathlibFunctions } from './mathlib';
import { asynclibFunctions } from './asynclib';
import { httplibFunctions, httplibTypes } from './httplib';
import { foreignlibFunctions, foreignlibTypes } from './foreignlib';
import { timerlibFunctions } from './timerlib';
import { dblibTypes } from './dblib';
import { dblibPostgresqlFunctions } from './dblibPostgresql';
import { dblibMariadbFunctions } from './dblibMariadb';
import { PfunError, buildPfunError } from './errors';
import { transpile } from './transpiler';

/**
 * Sets up a fresh interpreter with the core standard library.
 * IO functions are NOT included here — scripts must: import * from 'io';
 */
function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
}

/** Register all built-in system modules ('io', 'file', 'json', 'math', 'async', 'http', 'foreign', 'random', 'db/postgresql', 'db/mariadb') on a loader. */
export function registerBuiltinModules(loader: ModuleLoader): void {
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('file', filelibFunctions, filelibTypes);
  loader.registerBuiltin('json', jsonlibFunctions);
  loader.registerBuiltin('math', mathlibFunctions);
  loader.registerBuiltin('async', asynclibFunctions);
  loader.registerBuiltin('http', httplibFunctions, httplibTypes);
  loader.registerBuiltin('foreign', foreignlibFunctions, foreignlibTypes);
  loader.registerBuiltin('timer', timerlibFunctions);
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
    const tokens = lexSource(source);
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
 * it would if typed interactively — checkProgram's checkPurity
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
    ast = parseSource(source);
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
      ast = parseSource(source);
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

  // Bootstrap dialect opt-in: `--dialect=bootstrap` (or `--bootstrap`).
  if (args.includes('--dialect=bootstrap') || args.includes('--bootstrap')) {
    COMPILER_DIALECT = 'bootstrap';
  }

  // ── $PFUN_HOME expansion ──────────────────────────────────────────────────
  // Expand a leading $PFUN_HOME/ token in a user-module import path.
  // Mirrors expandPfunHome() in interpreter.ts (used by the runtime and
  // wholeProgramCheck); this copy covers the compile-only paths in -c,
  // --serve, and --validate that bypass resolveModulePath entirely.
  function expandPfunNamespace(importPath: string): string {
  if (
    !importPath.startsWith('testing/') &&
    !importPath.startsWith('browser/')
  ) {
    return importPath;
  }

  const pfunHome = process.env.PFUN_HOME;
  if (!pfunHome) return importPath;

  return path.join(pfunHome, 'bootstrap', 'src', importPath);
}

function expandPfunHome(importPath: string): string {
  if (importPath.startsWith('$PFUN_HOME/')) {
    const pfunHome = process.env.PFUN_HOME;
    if (!pfunHome) return importPath;

    return pfunHome + importPath.slice('$PFUN_HOME'.length);
  }

  return expandPfunNamespace(importPath);
}

// ── Builtin module union table ────────────────────────────────────────────
  // Used by both -c and --serve to tell the type inferencer which union types
  // each builtin module exports — mirrors loader.builtinUnionTypes().
  const BUILTIN_UNION_TABLE: Record<string, Array<{
    name: string; variants: { name: string; fields: string[] }[]
  }>> = {
    'file': [
      { name: 'FileHandle',  variants: [{ name: 'ReadHandle', fields: [] }, { name: 'WriteHandle', fields: [] }] },
      { name: 'FileMode',    variants: [{ name: 'Read', fields: [] }, { name: 'Write', fields: [] }, { name: 'Append', fields: [] }] },
      { name: 'Result',      variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Err', fields: ['message'] }] },
      { name: 'ReadResult',  variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Err', fields: ['message'] }, { name: 'Eof', fields: [] }] },
      { name: 'BufferMode',  variants: [{ name: 'ByteMode', fields: [] }, { name: 'CharMode', fields: [] }] },
    ],
    'http': [
      { name: 'HttpResult', variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Err', fields: ['message'] }] },
    ],
    'foreign': [
      { name: 'ForeignResult', variants: [{ name: 'FOk', fields: ['value'] }, { name: 'FErr', fields: ['kind', 'message'] }] },
    ],
    'db/postgresql': [
      { name: 'DbResult', variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Err', fields: ['message'] }] },
      { name: 'DbValue',  variants: [
        { name: 'DbInt', fields: ['value'] }, { name: 'DbFloat', fields: ['value'] },
        { name: 'DbText', fields: ['value'] }, { name: 'DbBool', fields: ['value'] },
        { name: 'DbBytes', fields: ['value'] }, { name: 'DbNull', fields: [] },
      ]},
    ],
    'db/mariadb': [
      { name: 'DbResult', variants: [{ name: 'Ok', fields: ['value'] }, { name: 'Err', fields: ['message'] }] },
      { name: 'DbValue',  variants: [
        { name: 'DbInt', fields: ['value'] }, { name: 'DbFloat', fields: ['value'] },
        { name: 'DbText', fields: ['value'] }, { name: 'DbBool', fields: ['value'] },
        { name: 'DbBytes', fields: ['value'] }, { name: 'DbNull', fields: [] },
      ]},
    ],
  };
  const builtinUnionResolver = (importPath: string) => {
    const unions = BUILTIN_UNION_TABLE[importPath];
    if (!unions) return null;
    return new Map(unions.map(u => [u.name, u.variants]));
  };

  // Extract union type declarations from a parsed module's statements.
  // Used to build a per-file union resolver for cross-module type checking.
  function extractUnions(stmts: any[]): Array<{ name: string; variants: { name: string; fields: string[] }[] }> {
    const result: Array<{ name: string; variants: { name: string; fields: string[] }[] }> = [];
    for (let s of stmts) {
      if (s.type === 'ExportStmt' && s.declaration) s = s.declaration;
      // UnionTypeStmt: type Foo = { | A: x | B: y }
      if (s.type === 'UnionTypeStmt' && s.name && Array.isArray(s.variants)) {
        result.push({ name: s.name, variants: s.variants });
      }
      // TypeStmt with variants (discriminated union shorthand, if used)
      if (s.type === 'TypeStmt' && Array.isArray(s.variants) && s.variants.length > 0) {
        result.push({ name: s.name, variants: s.variants });
      }
    }
    return result;
  }

  if (args.includes('-i') || args.includes('--interactive')) {
    // Any non-flag argument is treated as a file to pre-load into the session.
    const fileArg = args.find(a => a !== '-i' && a !== '--interactive');
    runRepl(fileArg);
  } else if (args.includes('-c') || args.includes('--compile')) {
    // ── Parse compile flags ─────────────────────────────────────────────────
    const compileFlags = new Set(['-c', '--compile', '--inline']);
    const oIdx = args.indexOf('-o');
    const hasInline = args.includes('--inline');

    // Strip all known flags/options to find the positional file argument.
    const positional = args.filter((a, i) => {
      if (compileFlags.has(a)) return false;
      if (a === '-o') return false;
      if (i > 0 && args[i - 1] === '-o') return false;
      return true;
    });

    if (positional.length === 0) {
      console.error('Usage: pfun -c <script.pf> [-o <dir|file.js|dir/file.js>] [--inline]');
      process.exit(1);
    }

    const entryPath = path.resolve(positional[0]);
    if (!fs.existsSync(entryPath)) {
      console.error(`File not found: ${entryPath}`);
      process.exit(1);
    }

    // ── Directory layout ────────────────────────────────────────────────────
    // -o can be:
    //   <dir>           — output tree mirrored under dir/
    //   <file.js>       — entry compiled to exactly this file; deps in same dir
    //   <dir/file.js>   — entry compiled to dir/file.js; deps in dir/
    //
    // Default output root: <cwd>/output
    const cwd = process.cwd();
    const oArg = oIdx !== -1 ? args[oIdx + 1] : undefined;

    // Determine whether -o names a file or a directory.
    // It's a file if it ends with .js; otherwise treat as a directory.
    const oIsFile   = !!oArg && oArg.endsWith('.js');
    const oResolved = oArg ? path.resolve(oArg) : undefined;

    // outDir: the directory compiled files land in (entry's dir for file-o).
    // entryOutPath: explicit output path for the entry file (null = use tree).
    const outDir      = oResolved
      ? (oIsFile ? path.dirname(oResolved) : oResolved)
      : path.join(cwd, 'output');
    const entryOutPath = oIsFile ? oResolved! : null;

    const libDir = path.join(outDir, 'lib');

    // Ensure output directories exist.
    fs.mkdirSync(outDir,  { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });

    // Builtins are handled by separate pfun-*.js runtime modules; skip them.
    const BUILTIN_PATHS = new Set([
      'io','file','math','json','async','http','foreign','random','timer','db/postgresql','db/mariadb',
    ]);

    // Maps pfun module name → libs filename (without path).
    const BUILTIN_LIB_FILES: Record<string, string> = {
      'math': 'pfun-math.js',
      'json': 'pfun-json.js',
      'file': 'pfun-file.js',
      'async': 'pfun-async.js',
      'http': 'pfun-http.js',
      'foreign': 'pfun-foreign.js',
      'timer': 'pfun-timer.js',
      'random': 'pfun-random.js',
      'db/postgresql': 'pfun-db-postgresql.js',
      'db/mariadb': 'pfun-db-mariadb.js',
    };

    // ── Inline support ──────────────────────────────────────────────────────
    // Map from lib name (e.g. 'pfun-runtime') to its absolute source path.
    // Resolved lazily when needed; cached here.
    const libSourcePaths: Record<string, string> = {};

    // Canonical source for runtime .js files is src/runtime/.
    // Falls back to output/lib/ (already-copied files) then the project root
    // (legacy location / symlinks from earlier workflow).
    const srcRuntimeDir = path.join(cwd, 'src', 'runtime');

    function resolveLibPath(libName: string): string | null {
      if (libSourcePaths[libName]) return libSourcePaths[libName];
      const candidates = [
        path.join(srcRuntimeDir, `${libName}.js`),  // src/runtime/ (canonical source)
        path.join(libDir,       `${libName}.js`),  // output/lib/ (already deployed)
        path.join(cwd,           `${libName}.js`),  // project root (legacy / symlinked)
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) { libSourcePaths[libName] = c; return c; }
      }
      return null;
    }

    // For --inline: strip all require('./pfun-*') calls and prepend the
    // raw file contents instead. Also strips require() calls to compiled
    // user modules, inlining those too.
    function stripLibBoilerplate(code: string): string {
      return code
        .replace(/^'use strict';\s*/gm, '')
        .replace(/^module\.exports\s*=\s*\{[^}]*\};\s*/gms, '');
    }

    function inlineRequires(jsCode: string, inlinedLibs: Set<string>, inlinedModules: Set<string>): string {
      // Match require() with either single or double quotes.
      const requirePattern = /const\s+(?:\{[^}]*\}|\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g;
      return jsCode.replace(requirePattern, (match, reqPath) => {
        const baseName = path.basename(reqPath);
        if (baseName.startsWith('pfun-')) {
          const libName = baseName.replace(/\.js$/, '');
          if (!inlinedLibs.has(libName)) {
            inlinedLibs.add(libName);
            const src = resolveLibPath(libName);
            if (src) {
              const libContent = fs.readFileSync(src, 'utf-8');
              const cleaned = stripLibBoilerplate(libContent);
              // Inline at this position, recursively stripping nested requires.
              return inlineRequires(cleaned, inlinedLibs, inlinedModules);
            }
          }
          // Already inlined — just remove the require.
          return `// (already inlined: ${libName})`;
        }
        // User module require — inline the compiled .js at this position.
        const absModPath = path.resolve(outDir, reqPath.replace(/\.js$/, '') + '.js');
        const modKey = absModPath;
        if (!inlinedModules.has(modKey) && fs.existsSync(absModPath)) {
          inlinedModules.add(modKey);
          const modJs = fs.readFileSync(absModPath, 'utf-8');
          return inlineRequires(stripLibBoilerplate(modJs), inlinedLibs, inlinedModules);
        }
        return `// (already inlined or not found: ${reqPath})`;
      });
    }

    // ── Builtin module union resolver ───────────────────────────────────────
    // Tells the type inferencer which union types each builtin module exports,
    // so that `import * from "db/mariadb"` makes DbValue variants known as
    // union constructors with unionName set — same information wholeProgramCheck
    // gets from loader.builtinUnionTypes(). Without this, DbInt/DbFloat/etc.
    // have no unionName and [DbText{"x"}, DbFloat{1.0}] is falsely rejected.
    // ── Compile function ────────────────────────────────────────────────────
    // compiled: prevents recompiling a source file twice in a diamond.
    // outPaths: maps absoluteSourcePath → absoluteOutputPath for post-processing.
    const compiled   = new Set<string>();
    const outPaths   = new Map<string, string>();

    function safeOutputRelativePath(root: string, sourcePath: string): string | null {
      const rel = path.relative(root, sourcePath);

      // An output-relative path must never escape its chosen root.
      if (
        rel.length === 0 ||
        rel === '..' ||
        rel.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rel)
      ) {
        return null;
      }

      return rel;
    }

    function sourceToOutPath(sourcePath: string): string {
      // An explicit file output controls only the entry file's exact name.
      if (entryOutPath && sourcePath === entryPath) {
        return entryOutPath;
      }

      if (entryOutPath) {
        // Keep modules beneath the entry source directory beside the entry
        // output. examples/mathutils.pf therefore becomes output/mathutils.js.
        const entryLocalRel = safeOutputRelativePath(
          path.dirname(entryPath),
          sourcePath,
        );

        if (entryLocalRel !== null) {
          return path.join(outDir, entryLocalRel.replace(/\.pf$/, '.js'));
        }
      }

      // Modules outside the entry directory mirror from the project root.
      // lib/datelib.pf therefore becomes output/lib/datelib.js.
      const cwdRel = safeOutputRelativePath(cwd, sourcePath);
      if (cwdRel !== null) {
        return path.join(outDir, cwdRel.replace(/\.pf$/, '.js'));
      }

      // A $PFUN_HOME dependency may live outside the current project.
      const pfunHome = process.env.PFUN_HOME
        ? path.resolve(process.env.PFUN_HOME)
        : null;

      if (pfunHome !== null) {
        const homeRel = safeOutputRelativePath(pfunHome, sourcePath);
        if (homeRel !== null) {
          return path.join(outDir, homeRel.replace(/\.pf$/, '.js'));
        }
      }

      // Last-resort containment for a dependency outside both roots.
      const volumeRoot = path.parse(sourcePath).root;
      const externalRel = path.relative(volumeRoot, sourcePath);

      return path.join(
        outDir,
        '_external',
        externalRel.replace(/\.pf$/, '.js'),
      );
    }

    // Maps absolutePath → union declarations from that module's TypeStmt/UnionTypeStmt.
    // Built during compilation so each module can resolve types from its imports.
    const userModuleUnions = new Map<string, Array<{ name: string; variants: { name: string; fields: string[] }[] }>>();

    function makeUnionResolver(forFile: string) {
      return (importPath: string) => {
        // Builtin modules
        const builtin = BUILTIN_UNION_TABLE[importPath];
        if (builtin) return new Map(builtin.map((u: any) => [u.name, u.variants]));
        // User modules — resolve the path and look up its declarations
        const srcDir = path.dirname(forFile);
        const expanded = expandPfunHome(importPath); const depPf = expanded.endsWith('.pf') ? expanded : expanded + '.pf'; const depPath = path.resolve(srcDir, depPf);
        const unions  = userModuleUnions.get(depPath);
        if (!unions || unions.length === 0) return null;
        return new Map(unions.map(u => [u.name, u.variants]));
      };
    }

    function compileFile(absolutePath: string): void {
      if (compiled.has(absolutePath)) return;
      compiled.add(absolutePath);

      const source = fs.readFileSync(absolutePath, 'utf-8');
      let stmts;
      try {
        stmts = parseSource(source);
      } catch (e) {
        const rawErr = e instanceof Error ? e : new Error(String(e));
        const pfunErr = rawErr instanceof PfunError
          ? rawErr
          : buildPfunError(rawErr, source, (rawErr as any).pos, null, () => undefined, { stringify: String });
        console.error(`In ${absolutePath}:`);
        console.error(pfunErr.pfunMessage);
        process.exit(1);
      }

      // Recurse into user-module dependencies first.
      const srcDir = path.dirname(absolutePath);
      for (const stmt of stmts) {
        if (stmt.type !== 'ImportStmt') continue;
        const imp = stmt as any;
        if (BUILTIN_PATHS.has(imp.path)) continue;
        const expanded = expandPfunHome(imp.path);
        const depPf   = expanded.endsWith('.pf') ? expanded : expanded + '.pf';
        const depPath = path.resolve(srcDir, depPf);
        if (!fs.existsSync(depPath)) {
          console.error(`Module not found: ${depPath} (imported by ${absolutePath})`);
          process.exit(1);
        }
        compileFile(depPath);
      }

      // Register this file's union declarations for use by its importers
      userModuleUnions.set(absolutePath, extractUnions(stmts));

      const errors = checkTypes(stmts, source, undefined, makeUnionResolver(absolutePath));
      if (errors.length > 0) {
        for (const e of errors) console.error(e.pfunMessage);
        process.exit(1);
      }

      // Compute the output path for this file.
      const outPath = sourceToOutPath(absolutePath);
      outPaths.set(absolutePath, outPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      // Compute relative path from the output .js file to libs dir.
      const rawRel = path.relative(path.dirname(outPath), libDir).replace(/\\/g, '/');
      const relToLibs = rawRel.startsWith('.') ? rawRel : './' + rawRel;
      const runtimeRequirePath = relToLibs + '/pfun-runtime';

      // Build builtinRequirePaths in the same way.
      const builtinRequirePaths: Record<string, string> = {};
      for (const [modName, libFile] of Object.entries(BUILTIN_LIB_FILES)) {
        builtinRequirePaths[modName] = relToLibs + '/' + libFile.replace(/\.js$/, '');
      }

      // For user-module require() paths: compute relative path from outPath
      // to each dep's output path.
      // This is handled automatically by the transpiler since it emits the
      // original import path (e.g. './mathutils') and the output mirrors the
      // source tree — so the relative path between two output files is the
      // same as between two source files.
      //
      // Exception: imports using $PFUN_HOME (e.g. "$PFUN_HOME/lib/datelib")
      // emit verbatim require() paths that Node cannot resolve. We build
      // userModuleRequirePaths to map each such import to the correct relative
      // path from the output .js file to the dependency's output .js file.
      // This mirrors the --serve path's equivalent logic.

      // Collect zero-field variants from all already-compiled dependency modules
      const externalSingletons = new Set<string>();
      for (const [depPath, unions] of userModuleUnions.entries()) {
        if (depPath === absolutePath) continue;
        for (const u of unions) {
          for (const v of u.variants) {
            if (v.fields.length === 0) externalSingletons.add(v.name);
          }
        }
      }

      const userModuleRequirePaths: Record<string, string> = {};
      for (const stmt of stmts) {
        if (stmt.type !== 'ImportStmt') continue;
        const imp = stmt as any;
        if (BUILTIN_PATHS.has(imp.path)) continue;
        const expandedDep = expandPfunHome(imp.path);
        const depPf       = expandedDep.endsWith('.pf') ? expandedDep : expandedDep + '.pf';
        const depAbsPath  = path.resolve(srcDir, depPf);
        const depOutPath  = outPaths.get(depAbsPath);
        if (depOutPath) {
          const relReq = path.relative(path.dirname(outPath), depOutPath).replace(/\.js$/, '');
          userModuleRequirePaths[imp.path] = relReq.startsWith('.') ? relReq : './' + relReq;
        }
      }

      const js = transpile(stmts, source, { runtimeRequirePath, builtinRequirePaths, externalSingletons, userModuleRequirePaths });
      fs.writeFileSync(outPath, js, 'utf-8');
      console.log(`Compiled: ${path.relative(cwd, absolutePath)} → ${path.relative(cwd, outPath)}`);
    }

    compileFile(entryPath);

    // ── Copy runtime libs to output/lib ────────────────────────────────────
    // Lib names to copy: pfun-runtime always, plus any builtin modules used.
    const usedBuiltinMods = new Set<string>();
    for (const absPath of compiled) {
      const source = fs.readFileSync(absPath, 'utf-8');
      let stmts;
      try {
        stmts = parseSource(source);
      } catch (e) {
        const rawErr = e instanceof Error ? e : new Error(String(e));
        const pfunErr = rawErr instanceof PfunError
          ? rawErr
          : buildPfunError(rawErr, source, (rawErr as any).pos, null, () => undefined, { stringify: String });
        console.error(`In ${absPath}:`);
        console.error(pfunErr.pfunMessage);
        process.exit(1);
      }
      for (const stmt of stmts) {
        if (stmt.type !== 'ImportStmt') continue;
        const imp = stmt as any;
        if (BUILTIN_PATHS.has(imp.path) && imp.path !== 'io') {
          usedBuiltinMods.add(imp.path);
        }
      }
    }

    // pfun-runtime always needed (unless --inline).
    const libsToCopy = ['pfun-runtime', ...Array.from(usedBuiltinMods).map(m => BUILTIN_LIB_FILES[m]?.replace(/\.js$/, '') ?? '')].filter(Boolean);

    if (!hasInline) {
      for (const libName of libsToCopy) {
        const src = resolveLibPath(libName);
        if (!src) {
          console.warn(`Warning: could not find ${libName}.js — you may need to copy it to output/lib/ manually.`);
          continue;
        }
        const dest = path.join(libDir, `${libName}.js`);
        if (src !== dest) fs.copyFileSync(src, dest);
      }
    }

    // ── --inline: rewrite entry output to a single self-contained file ──────
    if (hasInline) {
      const entryOut = outPaths.get(entryPath)!;
      const raw = fs.readFileSync(entryOut, 'utf-8');
      const inlinedLibs = new Set<string>();
      const inlinedMods = new Set<string>();
      const inlined = inlineRequires(raw, inlinedLibs, inlinedMods);

      // Output path: honour -o <file.js> if given; otherwise derive from entry name.
      const singleOut = entryOutPath
        ?? path.join(outDir, path.basename(entryPath, '.pf') + '.js');
      fs.writeFileSync(singleOut, inlined, 'utf-8');

      // Clean up intermediate per-module files that are now inlined.
      for (const absOut of outPaths.values()) {
        if (absOut !== singleOut && fs.existsSync(absOut)) fs.unlinkSync(absOut);
      }
      console.log(`Inlined to: ${path.relative(cwd, singleOut)}`);
    }
  } else if (args.includes('--serve') || args.includes('--validate')) {
    // ── Serve / Validate mode ─────────────────────────────────────────────────
    // pfun --serve    <entry.pf> [--port N]   — compile + launch HTTP server
    // pfun --validate <entry.pf>              — compile + static-check only (no server)
    //
    // validateOnly skips require()ing the compiled server output and starting
    // the HTTP server; everything else (parse, type-check, transpile for both
    // the browser bundle and the Node server side) runs identically.
    const validateOnly = args.includes('--validate');
    (async () => {
    //
    // Two sub-modes detected by inspecting the entry file:
    //
    // APP MODE — entry has `let server = "..."` and `let client = "..."`:
    //   Compiles client to a browser bundle, compiles server and extracts its
    //   exported handleRequest, runs a single HTTP server that serves the
    //   bundle at / and routes apiPath to the handler.
    //
    // PLAIN MODE — any other .pf file:
    //   Compiles it as a browser-only program and serves the bundle at /.

    const portArg = args.indexOf('--port');
    const cliPort = portArg !== -1 ? parseInt(args[portArg + 1], 10) : -1;

    const positional = args.filter((a, i) => {
      if (a === '--serve' || a === '--validate' || a === '--port') return false;
      if (i > 0 && args[i - 1] === '--port') return false;
      return true;
    });

    if (positional.length === 0) {
      console.error('Usage: pfun --serve <script.pf> [--port N]');
      console.error('       pfun --validate <script.pf>');
      process.exit(1);
    }

    const entryPath = path.resolve(positional[0]);
    if (!fs.existsSync(entryPath)) {
      console.error(`File not found: ${entryPath}`);
      process.exit(1);
    }

    const cwd       = process.cwd();
    const projectRoot0 = path.resolve(__dirname, '..');
    const srcRtDir  = path.join(projectRoot0, 'src', 'runtime');
    const browserRt = path.join(srcRtDir, 'pfun-runtime-browser.js');

    if (!fs.existsSync(browserRt)) {
      console.error(`Browser runtime not found: ${browserRt}`);
      console.error('Expected: src/runtime/pfun-runtime-browser.js');
      process.exit(1);
    }

    // ── Parse the entry file to detect app manifest ───────────────────────
    const entrySource = fs.readFileSync(entryPath, 'utf-8');
    let entryStmts;
    try {
      entryStmts = parseSource(entrySource);
    } catch (e) {
      const rawErr = e instanceof Error ? e : new Error(String(e));
      const pfunErr = rawErr instanceof PfunError
        ? rawErr
        : buildPfunError(rawErr, entrySource, (rawErr as any).pos, null, () => undefined, { stringify: String });
      console.error(`In ${entryPath}:`);
      console.error(pfunErr.pfunMessage);
      process.exit(1);
    }

    // Extract top-level `let name = "string"` and `let name = number` values
    function extractManifestValues(stmts: any[]): Record<string, string | number> {
      const vals: Record<string, string | number> = {};
      for (const s of stmts) {
        const stmt = s.type === 'ExportStmt' ? s.declaration : s;
        if (stmt.type !== 'LetStmt') continue;
        const init = stmt.initializer ?? stmt.init ?? stmt.value;
        if (!init) continue;
        if (init.type === 'StrExpr')  vals[stmt.name] = init.value;
        if (init.type === 'IntExpr')  vals[stmt.name] = Number(init.value);
      }
      return vals;
    }

    const manifest = extractManifestValues(entryStmts);
    const isAppManifest = typeof manifest.server === 'string' && typeof manifest.client === 'string';

    const entryDir    = path.dirname(entryPath);
    const port        = cliPort !== -1 ? cliPort : (typeof manifest.port === 'number' ? manifest.port : 3170);
    const apiPath     = typeof manifest.apiPath === 'string' ? manifest.apiPath : '/api';

    // ── Data model generation (--validate only) ───────────────────────────
    // If the manifest has `dataModelOut` and `connectionString`/`schema`,
    // regenerate the data model from the live DB before type-checking.
    // This ensures the static check validates against the actual DB schema.
    if (validateOnly && isAppManifest && typeof manifest.dataModelOut === 'string') {
      const connectionString = typeof manifest.CONNECTION_STRING === 'string' ? manifest.CONNECTION_STRING : null;
      const schema           = typeof manifest.SCHEMA === 'string' ? manifest.SCHEMA : 'public';
      const lookupTablesRaw  = typeof manifest.lookupTables === 'string' ? manifest.lookupTables : '';
      const lookupTablesList = lookupTablesRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
      const dataModelOutDir  = path.resolve(entryDir, manifest.dataModelOut as string);
      const dataModelOutFile = path.join(dataModelOutDir, `${schema}_data_model.pf`);

      if (!connectionString) {
        console.error('--validate: manifest has dataModelOut but no connectionString');
        process.exit(1);
      }

      const pfunHome = process.env.PFUN_HOME;
      if (!pfunHome) {
        console.error('--validate: $PFUN_HOME must be set to regenerate data model');
        process.exit(1);
      }

      // Build a self-contained temp Pfun script that runs the generation
      // with the manifest's connection/schema/lookup values injected as
      // literals, without depending on any project-local config file.
      const lookupTablesLiteral = '[' + lookupTablesList.map((t: string) => `"${t}"`).join(', ') + ']';
      const genScript = `
import * from "io";
import * from "file";
import * from "db/postgresql";
import * from "$PFUN_HOME/lib/dbschema";
import * from "$PFUN_HOME/lib/db/dbschema_utils";
import * from "$PFUN_HOME/lib/dataModelGen";

let CONNECTION_STRING = ${JSON.stringify(connectionString)};
let SCHEMA            = ${JSON.stringify(schema)};
let LOOKUP_TABLES     = ${lookupTablesLiteral};
let OUT_DIR           = ${JSON.stringify(dataModelOutDir)};
let OUT_FILE          = ${JSON.stringify(dataModelOutFile)};

proc mkdirSafe(p) {
  match mkdirP(p) with
  | Ok _  -> true
  | Err e -> { println("Could not create directory '" + p + "': " + e.message); false };
}

proc writeSafe(p, content) {
  match writeFile(p, content) with
  | Ok _  -> true
  | Err e -> { println("Could not write file '" + p + "': " + e.message); false };
}

async proc fetchLookupSections(conn, lookupTbls) {
  if length(lookupTbls) == 0 then [] else {
    let t    = head(lookupTbls);
    let rest = tail(lookupTbls);
    let vals = await loadLookupValues(conn, SCHEMA, t.name);
    let sec  = genLookupEnum(t, vals);
    let more = await fetchLookupSections(conn, rest);
    [sec] + more;
  }
}

async proc main() {
  println("Generating data model from " + CONNECTION_STRING + "...");
  let conn = await dbConnect(CONNECTION_STRING);
  match conn with
  | Err e -> { println("Connect failed: " + e.message); exit(1) }
  | Ok c  -> {
      let meta = await loadSchema(c.value, SCHEMA);
      match meta with
      | SchemaErr e -> { println("Schema load failed: " + e.message); exit(1) }
      | SchemaOk s  -> {
          let tables     = s.meta.tables;
          let lookupTbls = filter(fn t => isLookup(t.name, LOOKUP_TABLES), tables);
          let lookupVals = await loadAllLookupValues(c.value, SCHEMA, LOOKUP_TABLES);
          let lookupSections = await fetchLookupSections(c.value, lookupTbls);
          let fp         = fingerprintSchema(tables, lookupVals);
          let output     = generateOutput(s.meta.schemaName, tables, lookupSections, LOOKUP_TABLES);
          let fpLine     = "export let SCHEMA_FINGERPRINT = \\"" + fp + "\\";\\n";
          let stubFp     = fingerprintSchema(tables, []);
          let stubFpLine = "export let SCHEMA_FINGERPRINT = \\"" + stubFp + "\\";\\n";
          let patched    = join(split(output, stubFpLine), fpLine);
          let dirOk = mkdirSafe(OUT_DIR);
          if dirOk then {
            let ok = writeSafe(OUT_FILE, patched);
            if ok then { println("✓ Data model written: " + OUT_FILE) }
          }
        };
      await dbClose(c.value);
    };
}

main();
`.trim();

      // Write temp script alongside the config file, run it, then delete it
      const tmpScript = path.join(entryDir, '__pfun_gen_tmp__.pf');
      fs.writeFileSync(tmpScript, genScript, 'utf-8');
      try {
        console.log(`Regenerating data model...`);
        await runFile(tmpScript);
      } finally {
        fs.unlinkSync(tmpScript);
      }
    }

    const BUILTIN_PATHS_BROWSER = new Set([
      'io','file','math','json','async','http','foreign','random','timer','db/postgresql','db/mariadb',
    ]);
    const builtinUnionResolverForServe = builtinUnionResolver;

    // ── Browser bundle compilation (shared by both modes) ─────────────────
    const compiledServe = new Set<string>();
    const serveModules: Array<{ js: string }> = [];
    const serveUserUnions = new Map<string, Array<{ name: string; variants: { name: string; fields: string[] }[] }>>();

    function makeServeUnionResolver(forFile: string) {
      return (importPath: string) => {
        const builtin = BUILTIN_UNION_TABLE[importPath];
        if (builtin) return new Map(builtin.map((u: any) => [u.name, u.variants]));
        const srcDir = path.dirname(forFile);
        const depPf   = importPath.endsWith('.pf') ? importPath : importPath + '.pf';
        const depPath = path.resolve(srcDir, depPf);
        const unions  = serveUserUnions.get(depPath);
        if (!unions || unions.length === 0) return null;
        return new Map(unions.map(u => [u.name, u.variants]));
      };
    }

    function compileBrowserFile(absPath: string): void {
      if (compiledServe.has(absPath)) return;
      compiledServe.add(absPath);
      const src   = fs.readFileSync(absPath, 'utf-8');
      let stmts;
      try {
        stmts = parseSource(src);
      } catch (e) {
        const rawErr = e instanceof Error ? e : new Error(String(e));
        const pfunErr = rawErr instanceof PfunError
          ? rawErr
          : buildPfunError(rawErr, src, (rawErr as any).pos, null, () => undefined, { stringify: String });
        console.error(`In ${absPath}:`);
        console.error(pfunErr.pfunMessage);
        process.exit(1);
      }
      const srcDir = path.dirname(absPath);
      for (const stmt of stmts) {
        if (stmt.type !== 'ImportStmt') continue;
        const imp = stmt as any;
        if (BUILTIN_PATHS_BROWSER.has(imp.path)) continue;
        const expanded = expandPfunHome(imp.path);
        const depPf   = expanded.endsWith('.pf') ? expanded : expanded + '.pf';
        const depPath = path.resolve(srcDir, depPf);
        if (!fs.existsSync(depPath)) {
          console.error(`Module not found: ${depPath} (imported by ${absPath})`);
          process.exit(1);
        }
        compileBrowserFile(depPath);
      }
      serveUserUnions.set(absPath, extractUnions(stmts));
      const errors = checkTypes(stmts, src, undefined, makeServeUnionResolver(absPath));
      if (errors.length > 0) {
        for (const e of errors) console.error(e.pfunMessage);
        process.exit(1);
      }
      // Collect zero-field variants from all compiled dependency modules
      const externalSingletons = new Set<string>();
      for (const [depPath, unions] of serveUserUnions.entries()) {
        if (depPath === absPath) continue;
        for (const u of unions) {
          for (const v of u.variants) {
            if (v.fields.length === 0) externalSingletons.add(v.name);
          }
        }
      }
      serveModules.push({ js: transpile(stmts, src, { externalSingletons }) });
    }

    const clientEntryPath = isAppManifest
      ? path.resolve(entryDir, (manifest.client as string).endsWith('.pf')
          ? manifest.client as string : manifest.client + '.pf')
      : entryPath;

    compileBrowserFile(clientEntryPath);

    // Runtime destructure — reads from window.__pfunRuntime instead of require()
    const runtimeDestructure = 'const {' + [
      'PfunChar','PfunByte','PfunArray','PfunDict','PfunBuffer',
      '$curry','$memoize',
      '$char','$byte','$record','$registerType',
      '$stringify','$println','$print','$flushStdout','$mountHtml','$clearOutput','$attachDomHandler','$httpPost','$truthy',
      '$readln','$readChar','$scriptArgs','$getEnv','$envVars',
      '$ck',
      '$add','$sub','$mul','$div','$mod','$neg',
      '$eq','$neq','$lt','$lte','$gt','$gte',
      '$bitAnd','$bitOr','$shl','$shr',
      '$get','$index','$indexSet',
      '$match',
      '$length','$head','$tail','$map','$filter','$reduce',
      '$reverse','$join','$split','$range','$cons','$take','$drop','$nth',
      '$slice','$find','$findSlice',
      '$iterate','$repeat','$cycle','$isInfinite','$isLazy',
      '$LazyIterate','$LazyRepeat','$LazyCycle','$LazyFilter','$LazyMap','$LazyCons','$LazyTail',
      '$asc','$chr','$__str__',
      '$toFloat','$toInt','$floor','$ceil','$round','$isNaN','$isFinite',
      '$toByte','$toChar','$charBytes','$bytesToChar',
      '$array_from','$dict_from',
      '$arrayLength','$append','$removeAt','$insertAt','$toList','$toArray','$toDict',
      '$has','$remove','$keys','$values','$dictToList','$listToDict',
      '$makeBuffer','$makeStringBuffer','$appendBuffer','$appendChar','$appendString',
      '$bufferToBytes','$bufferToString','$bufferLength',
      'ByteMode','CharMode','None','Some',
    ].join(',') + '} = window.__pfunRuntime;';

    function browserifyModule(js: string, isFirst: boolean): string {
      let result = js;
      result = result.replace(
        /^const\s+\{[^}]+\}\s*=\s*require\("[^"]*pfun-runtime[^"]*"\);\n?/m,
        isFirst ? runtimeDestructure + '\n' : '',
      );
      result = result.replace(
        /^\s*const\s+(?:\{[^}]*\}|[^\s=]+)\s*=\s*require\(['"][^'"]+['"]\);\n?(?:\s*Object\.assign\(globalThis,[^)]+\);\n?)?/gm,
        '',
      );
      result = result.replace(/^\s*module\.exports\s*=\s*\{[^}]*\};\s*\n?/gm, '');
      result = result.replace(/^\s*module\.exports\.\w+\s*=\s*\w+;\s*\n?/gm, '');
      result = result.replace(
        /process\.stderr\.write\([^)]+\);\s*\n\s*process\.exit\(1\);/g,
        'console.error($e$.message);',
      );
      const lines = result.split('\n');
      const firstIife = lines.findIndex(l => /^\(async \(\) => \{/.test(l));
      const lastClose = lines.map((l, i) => [l, i]).filter(([l]) => /^\}\)\(\);/.test(l as string)).pop();
      if (firstIife !== -1 && lastClose) {
        const closeIdx = lastClose[1] as number;
        const withoutClose = [
          ...lines.slice(0, firstIife),
          ...lines.slice(firstIife + 2, closeIdx - 3),
          ...lines.slice(closeIdx + 1),
        ];
        result = withoutClose.join('\n');
      }
      return result;
    }

    const rawModules = serveModules.map(({ js }, i) => browserifyModule(js, i === 0));
    let innerCode = rawModules.join('\n');

    // In app mode, patch the client's serverUrl to apiPath.
    // client.pf declares `let serverUrl = "..."` which compiles to
    // `const serverUrl = "..."` in the bundle. Replace the value in place
    // rather than injecting a second declaration (which would be a SyntaxError).
    if (isAppManifest) {
      innerCode = innerCode.replace(
        /\bconst serverUrl\s*=\s*"[^"]*";/,
        `const serverUrl = ${JSON.stringify(apiPath)};`
      );
    }

    const bundledJs = `(async () => {\ntry {\n${innerCode}\n} catch ($e$) {\nconsole.error($e$);\n}\n})();`;

    const runtimeJs = fs.readFileSync(browserRt, 'utf-8');
    const entryName = path.basename(clientEntryPath, '.pf');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${entryName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1e1e2e;
      color: #cdd6f4;
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      padding: 1.5rem;
    }
    #pfun-output {
      white-space: pre-wrap;
      line-height: 1.6;
    }
    #pfun-output div:empty::before { content: '\\00a0'; }
  </style>
</head>
<body>
  <div id="pfun-output"></div>
  <script>
${runtimeJs}
  </script>
  <script>
window.addEventListener('unhandledrejection', function(e) {
  console.error('Unhandled rejection:', e.reason);
  const el = document.getElementById('pfun-output');
  if (el) { el.innerHTML = '<pre style="color:#f38ba8;white-space:pre-wrap">Async error: ' + (e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)) + '</pre>'; }
});
document.addEventListener('DOMContentLoaded', function() {
${bundledJs}
});
  </script>
</body>
</html>`;

    if (!isAppManifest) {
      // ── Plain mode: browser-only, no server handler ───────────────────────
      if (validateOnly) {
        console.log(`✓ Validation passed: ${path.relative(cwd, entryPath)}`);
        process.exit(0);
      }
      const http = require('http');
      const srv = http.createServer((_req: any, res: any) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      srv.listen(port, '127.0.0.1', () => {
        console.log(`Serving ${path.relative(cwd, entryPath)} at http://localhost:${port}/`);
        console.log('Press Ctrl+C to stop.');
      });
    } else {
      // ── App mode: compile server, wire single HTTP server ─────────────────
      const serverPfPath = path.resolve(entryDir,
        (manifest.server as string).endsWith('.pf')
          ? manifest.server as string : manifest.server + '.pf');

      if (!fs.existsSync(serverPfPath)) {
        console.error(`Server file not found: ${serverPfPath}`);
        process.exit(1);
      }

      // Compile server.pf to a temp JS file and require it.
      // Always use the pfun project root (where main.ts lives) as the base,
      // so lib/ paths resolve correctly regardless of where --serve is invoked from.
      const projectRoot = projectRoot0;
      const tmpDir = path.join(projectRoot, 'output', '__serve_tmp__');
      fs.mkdirSync(tmpDir, { recursive: true });

      // Reuse -c compilation machinery for the server side
      const serverCompiled  = new Set<string>();
      const serverOutPaths  = new Map<string, string>();
      const serverUserUnions = new Map<string, Array<{ name: string; variants: { name: string; fields: string[] }[] }>>();
      // Per-module export TYPES (function signatures + variant constructor
      // types), captured from each dependency's own checkTypes pass and made
      // available to its importers via the typeResolver below. Without this,
      // imported names (notably union variant CONSTRUCTORS like a ServerCmd's
      // Reply/Perform) bind to independent fresh vars at each use site, so the
      // checker can't tell they belong to the same union — producing spurious
      // "Cannot unify X with Y" errors that the whole-program checkProgram
      // path (which threads these types) never hits. Mirrors checkProgram's
      // infoByPath.exportTypes + typeResolver exactly.
      const serverExportTypes = new Map<string, TypeImportTable>();

      function makeServerUnionResolver(forFile: string) {
        return (importPath: string) => {
          const builtin = BUILTIN_UNION_TABLE[importPath];
          if (builtin) return new Map(builtin.map((u: any) => [u.name, u.variants]));
          const sd = path.dirname(forFile);
          const expanded = expandPfunHome(importPath);
          const dp = expanded.endsWith('.pf') ? expanded : expanded + '.pf';
          const depPath = path.resolve(sd, dp);
          const unions = serverUserUnions.get(depPath);
          if (!unions || unions.length === 0) return null;
          return new Map(unions.map(u => [u.name, u.variants]));
        };
      }

      // Type resolver for the server compile path. Serves USER modules only:
      // hand back the export types captured when that dependency was compiled
      // (it always was — compileServerFile recurses into deps before checking
      // the importer, so serverExportTypes.get(depPath) is populated by the
      // time this runs). Builtin modules return null here, exactly as before:
      // their imported names fall through to the unbound→fresh-var path, which
      // already works for builtin function calls (this bug was never about
      // builtins — it's about USER union variant constructors like a
      // ServerCmd's Reply/Perform binding to independent fresh vars without a
      // shared type). Mirrors checkProgram's typeResolver for the user-module
      // case.
      function makeServerTypeResolver(forFile: string): TypeImportResolver {
        return (importPath: string) => {
          const sd = path.dirname(forFile);
          const expanded = expandPfunHome(importPath);
          const dp = expanded.endsWith('.pf') ? expanded : expanded + '.pf';
          const depPath = path.resolve(sd, dp);
          return serverExportTypes.get(depPath) ?? null;
        };
      }

      function compileServerFile(absPath: string): void {
        if (serverCompiled.has(absPath)) return;
        serverCompiled.add(absPath);
        const src   = fs.readFileSync(absPath, 'utf-8');
        let stmts;
        try {
          stmts = parseSource(src);
        } catch (e) {
          const rawErr = e instanceof Error ? e : new Error(String(e));
          const pfunErr = rawErr instanceof PfunError
            ? rawErr
            : buildPfunError(rawErr, src, (rawErr as any).pos, null, () => undefined, { stringify: String });
          console.error(`In ${absPath}:`);
          console.error(pfunErr.pfunMessage);
          process.exit(1);
        }
        const sd    = path.dirname(absPath);
        const BUILTIN_PATHS_SERVER = new Set([
          'io','file','math','json','async','http','foreign','random','timer','db/postgresql','db/mariadb',
        ]);
        for (const stmt of stmts) {
          if (stmt.type !== 'ImportStmt') continue;
          const imp = stmt as any;
          if (BUILTIN_PATHS_SERVER.has(imp.path)) continue;
          const expanded = expandPfunHome(imp.path);
          const depPf   = expanded.endsWith('.pf') ? expanded : expanded + '.pf';
          const depPath = path.resolve(sd, depPf);
          if (!fs.existsSync(depPath)) {
            console.error(`Server module not found: ${depPath}`);
            process.exit(1);
          }
          compileServerFile(depPath);
        }
        serverUserUnions.set(absPath, extractUnions(stmts));
        const exportTypesOut: TypeImportTable = new Map();
        const errors = checkTypes(
          stmts,
          src,
          makeServerTypeResolver(absPath),
          makeServerUnionResolver(absPath),
          exportTypesOut,
        );
        // Make this module's export types available to its importers (this
        // file is only reached after all its own deps were compiled, so by
        // the time an importer calls makeServerTypeResolver, this is set).
        serverExportTypes.set(absPath, exportTypesOut);
        if (errors.length > 0) {
          for (const e of errors) console.error(e.pfunMessage);
          process.exit(1);
        }
        // Output to tmp dir mirroring structure relative to project root
        const rel     = path.relative(projectRoot, absPath);
        const outPath = path.join(tmpDir, rel.replace(/\.pf$/, '.js'));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const relToLib      = path.relative(path.dirname(outPath), path.join(projectRoot, 'output', 'lib'));
        const libPathOption = relToLib.startsWith('.') ? relToLib : './' + relToLib;
        const builtinReqPaths: Record<string, string> = {};
        const BUILTIN_LIB_FILES_LOCAL: Record<string, string> = {
          'io': 'pfun-io', 'file': 'pfun-file', 'math': 'pfun-math',
          'json': 'pfun-json', 'async': 'pfun-async', 'http': 'pfun-http',
          'foreign': 'pfun-foreign',
          'timer': 'pfun-timer',
          'random': 'pfun-random',
          'db/postgresql': 'pfun-db-postgresql', 'db/mariadb': 'pfun-db-mariadb',
        };
        for (const [mod, lib] of Object.entries(BUILTIN_LIB_FILES_LOCAL)) {
          builtinReqPaths[mod] = libPathOption + '/' + lib;
        }
        const serverExternalSingletons = new Set<string>();
        for (const [depPath, unions] of serverUserUnions.entries()) {
          if (depPath === absPath) continue;
          for (const u of unions) {
            for (const v of u.variants) {
              if (v.fields.length === 0) serverExternalSingletons.add(v.name);
            }
          }
        }
        // Build the require()-path override for every user-module import in
        // THIS file, keyed by the raw source path string (exactly as
        // transpile's ImportStmt case looks it up). Each dependency was
        // already compiled above (compileServerFile recurses depth-first),
        // so serverOutPaths.get(depPath) is populated — compute the path
        // from THIS file's compiled output location to THAT dependency's,
        // the only thing Node's require() can actually resolve at runtime.
        // Without this, a raw source path like "$PFUN_HOME/lib/serverDispatch"
        // (or any import whose compiled output doesn't sit in the same
        // relative position as its source) gets emitted into the .js
        // verbatim and require() fails at runtime — this is what produced
        // "Cannot find module '$PFUN_HOME/lib/serverDispatch'".
        const userModuleRequirePaths: Record<string, string> = {};
        for (const stmt of stmts) {
          if (stmt.type !== 'ImportStmt') continue;
          const imp = stmt as any;
          if (BUILTIN_PATHS_SERVER.has(imp.path)) continue;
          const expandedDep = expandPfunHome(imp.path);
          const depPf       = expandedDep.endsWith('.pf') ? expandedDep : expandedDep + '.pf';
          const depAbsPath  = path.resolve(sd, depPf);
          const depOutPath  = serverOutPaths.get(depAbsPath);
          if (!depOutPath) continue; // shouldn't happen — compiled above — but stay permissive
          const relReq = path.relative(path.dirname(outPath), depOutPath).replace(/\.js$/, '');
          userModuleRequirePaths[imp.path] = relReq.startsWith('.') ? relReq : './' + relReq;
        }
        const js = transpile(stmts, src, {
          runtimeRequirePath: libPathOption + '/pfun-runtime',
          builtinRequirePaths: builtinReqPaths,
          externalSingletons: serverExternalSingletons,
          userModuleRequirePaths,
        });
        fs.writeFileSync(outPath, js, 'utf-8');
        serverOutPaths.set(absPath, outPath);
      }

      compileServerFile(serverPfPath);

      // Ensure runtime libs are in output/lib/ under the project root
      const libDir = path.join(projectRoot, 'output', 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      const RT_LIBS = ['pfun-runtime','pfun-io','pfun-json','pfun-http',
                       'pfun-math','pfun-file','pfun-async','pfun-foreign','pfun-timer','pfun-random',
                       'pfun-db-postgresql','pfun-db-mariadb'];
      for (const lib of RT_LIBS) {
        const dest = path.join(libDir, lib + '.js');
        // pfun-runtime.js lives at the project root; others are in src/runtime/
        const src = lib === 'pfun-runtime'
          ? path.join(projectRoot, 'pfun-runtime.js')
          : path.join(srcRtDir, lib + '.js');
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      }

      // --validate: static checks and compilation are complete — skip loading
      // the compiled server and starting the HTTP server.
      if (validateOnly) {
        const clientRel = path.relative(cwd, clientEntryPath);
        const serverRel = path.relative(cwd, serverPfPath);
        console.log(`✓ Validation passed: ${clientRel} (client) + ${serverRel} (server)`);
        process.exit(0);
      }

      // Clear require cache for runtime libs to ensure fresh copies are used
      const runtimeLibPath = require.resolve(path.join(libDir, 'pfun-runtime.js'));
      delete require.cache[runtimeLibPath];

      // Require the compiled server entry and get handleRequest
      const serverOutPath = serverOutPaths.get(serverPfPath)!;
      let handleRequest: ((req: any, res: any) => Promise<void>) | null = null;
      try {
        const serverModule = require(serverOutPath);
        handleRequest = serverModule.handleRequest ?? null;
      } catch (e: any) {
        console.error(`Failed to load compiled server: ${e.message}`);
        process.exit(1);
      }
      if (!handleRequest) {
        console.error(`server.pf must export handleRequest — add 'export' before the proc declaration.`);
        process.exit(1);
      }

      // Build the req/res objects (same shape as pfun-http.js's httpListen)
      const { URL: NodeURL } = require('url');
      const { PfunDict: PfunDictNode, PfunByte: PfunByteNode, $stringify: $stringifyNode } = require(
        path.join(libDir, 'pfun-runtime.js')
      );
      function dictFromRecord(rec: Record<string, string>) {
        const map = new Map<string, string>();
        for (const [k, v] of Object.entries(rec)) map.set(`s:${k}`, v as string);
        return new PfunDictNode(map);
      }
      function pfunToJsonValue(value: any): any {
        if (value === null || value === undefined) return null;
        if (typeof value === 'bigint')  return { __pfun: 'int', v: value.toString() };
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number')  return value;
        if (typeof value === 'string')  return value;
        if (value instanceof PfunDictNode) {
          const obj: any = {};
          for (const [k, v] of (value as any).entries.entries()) obj[k.slice(2)] = pfunToJsonValue(v);
          return obj;
        }
        if (Array.isArray(value)) return value.map(pfunToJsonValue);
        if (value && typeof value === 'object' && '__type' in value) {
          const out: any = { __pfun: 'record', __type: value.__type, __union: value.__union ?? null };
          for (const key of Object.keys(value)) {
            if (key === '__type' || key === '__union') continue;
            out[key] = pfunToJsonValue(value[key]);
          }
          return out;
        }
        return $stringifyNode(value);
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      const http = require('http');
      const srv  = http.createServer((nodeReq: any, nodeRes: any) => {
        const chunks: Buffer[] = [];
        nodeReq.on('data', (chunk: Buffer) => chunks.push(chunk));
        nodeReq.on('end', () => {
          const rawBody  = Buffer.concat(chunks);
          const body     = rawBody.toString('utf8');
          const bodyBytes = Array.from(rawBody, (b: number) => new PfunByteNode(b));

          let pathname = nodeReq.url ?? '/';
          const queryEntries = new Map<string, string>();
          try {
            const parsed = new NodeURL(nodeReq.url ?? '/', `http://${nodeReq.headers.host ?? 'localhost'}`);
            pathname = parsed.pathname;
            parsed.searchParams.forEach((v: string, k: string) => queryEntries.set(`s:${k}`, v));
          } catch { /* fall back to raw path */ }

          const headersEntries = new Map<string, string>();
          for (const [k, v] of Object.entries(nodeReq.headers as Record<string, string | string[]>)) {
            if (typeof v === 'string') headersEntries.set(`s:${k}`, v);
            else if (Array.isArray(v)) headersEntries.set(`s:${k}`, v.join(', '));
          }

          let responded = false;
          const send = (status: bigint, contentType: string, payload: string | Buffer) => {
            if (responded) return;
            responded = true;
            nodeRes.writeHead(Number(status), { 'Content-Type': contentType, ...corsHeaders });
            nodeRes.end(payload);
          };

          const isApi = pathname === apiPath;

          if (!isApi) {
            // Serve client bundle for all non-API routes
            send(200n, 'text/html; charset=utf-8', html);
            return;
          }

          const req = {
            __type: 'Request', method: nodeReq.method ?? 'GET', path: pathname,
            query: new PfunDictNode(queryEntries), headers: new PfunDictNode(headersEntries),
            body, bodyBytes,
          };
          const res = {
            __type: 'Response',
            text:  (status: bigint, value: any) => send(status, 'text/plain; charset=utf-8', typeof value === 'string' ? value : $stringifyNode(value)),
            json:  (status: bigint, value: any) => send(status, 'application/json; charset=utf-8', JSON.stringify(pfunToJsonValue(value))),
            bytes: (status: bigint, byteList: any[], contentType: string) => {
              const buf = Buffer.from(byteList.map((b: any) => b.value));
              send(status, contentType, buf);
            },
          };

          Promise.resolve(handleRequest!(req, res)).catch((e: any) => {
            const msg = e instanceof Error ? e.message : String(e);
            const stack = e instanceof Error ? e.stack : '';
            process.stderr.write(`[server] handler error: ${msg}\n${stack}\n`);
            if (!responded) send(500n, 'text/plain; charset=utf-8', 'Internal Server Error');
          });
        });
      });

      srv.listen(port, '127.0.0.1', () => {
        console.log(`App running at http://localhost:${port}/`);
        console.log(`  client → /`);
        console.log(`  server → ${apiPath}`);
        console.log('Press Ctrl+C to stop.');
      });
    }

    })().catch((e: any) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });

  } else if (args.length === 0) {
    console.log('Usage: pfun <script.pf>');
    console.log('       pfun -i [script.pf]   (interactive mode, optionally pre-loading a file)');
    console.log('       pfun -c <script.pf>   (compile to JavaScript)');
    console.log('       pfun --serve    <script.pf> [--port N]   (serve in browser, default port 3170)');
    console.log('       pfun --validate <script.pf>              (static checks + compile, no server)');
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
