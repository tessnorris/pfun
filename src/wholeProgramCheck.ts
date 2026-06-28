// src/wholeProgramCheck.ts
//
// Whole-program static checking driver. Walks a program's entire import
// graph, parsing each file exactly once, and runs BOTH static checkers —
// procedure-usage/purity (purityCheck.ts, Stage 1) and type/
// exhaustiveness (typechecker.ts's checkTypes, Stage 2) — against every
// module in the graph, not just the entry file, feeding each module real
// cross-module information about what it imports.
//
// This exists because a transpiler has no runtime `inPureContext` check
// (purity) or unification (types) to fall back on: the static checks must
// become the SOLE enforcement of both purity AND type-correctness, which
// means they must run over every file a program depends on, not just the
// one the user invoked. See the project's whole-program checking design
// notes for the full motivation and staging plan.
//
// ─── What "checking a program" means here ──────────────────────────────────
//
//   1. Parse the entry file, and recursively every file it (transitively)
//      imports — each file parsed exactly once, cached by resolved path.
//   2. Order modules so every module is processed only after everything it
//      imports has already been processed (topological order over the
//      import graph), with circular-import detection.
//   3. For each module, in that order: run checkPurity AND
//      checkTypes against it, each seeded with a resolver that can answer
//      "what kind/type/union-shape does this imported name have?" by
//      looking up the already-computed info for whichever module it
//      imports (always already available, since we're going
//      dependency-first).
//   4. After a module's own checks succeed, extract its own export tables
//      — kind (purity), resolved type, and (for unions) variant shape —
//      by walking its ExportStmts, and cache them under that module's
//      resolved path for anything that imports it later.
//   5. Stage 3 (all-errors batching): a module's error does NOT stop the
//      walk. Every error from every check, in every module, is collected
//      — each tagged with that module's file path attached (since the
//      error may not be in the entry file) — and the whole graph is still
//      walked to completion. A module that fails either check simply does
//      NOT get its export tables cached (step 4 above is skipped for it),
//      so anything that later imports it falls back to the same permissive
//      "unresolvable import" behavior checkPurity/checkTypes
//      already have for a missing resolver entry (every name from it reads
//      as kind 'other' / type Unknown) — exactly as if cross-module
//      checking didn't exist for that one edge. That fallback is what
//      makes it safe to keep walking past a broken module instead of
//      aborting: a downstream consumer gets permissive (never-flagged)
//      treatment of bad info, never a false positive caused by a module
//      that itself already failed.
//      Graph-level errors (a missing file, a circular import, or a
//      lex/parse failure while BUILDING the graph) are the one exception
//      and still abort immediately, before any module-level check runs at
//      all — there is no graph left to keep walking once parsing itself
//      can't produce one. See `checkProgram`'s own docblock below for
//      exactly which case is which.
//
// Built-in modules (io, math, ...) are leaf nodes with no .pf source:
// their export kinds come from ModuleLoader.builtinExportNames (entirely
// kind 'other' — natives are never proc-typed); their export TYPES are
// all `Unknown` (the Stage 2 design's deliberate choice — see the design
// doc's "Minimal builtin type table" decision; a full hand-written `Fn`
// signature table for the stdlib is Stage 3 work, not done here); they
// export no unions at all (no built-in module currently defines a
// UnionTypeStmt — they're plain JS function/type registrations).
//
// Stage 3 (REPL preload routing): `checkProgram`/`buildModuleGraph` also
// accept an optional `entrySource` override, used by main.ts's
// `loadReplFile` (`pfun -i somefile.pf`) to route a preloaded file —
// including everything it transitively imports — through this same
// whole-program checker, instead of the REPL's old per-entry, no-resolver
// checkTypes loop (which could never see across `import` boundaries, or
// even across two of the file's own entries, since each chunk was checked
// in total isolation). See `buildModuleGraph`'s docblock for exactly why
// an override is needed at all (the REPL's trailing-`?` print sugar isn't
// valid standalone .pf syntax).

import * as fs from 'fs';
import * as path from 'path';
import { Stmt, Expr, PfunType, UNKNOWN } from './ast';
import { Lexer, SourcePos } from './lexer';
import { Parser } from './parser';
import { buildPfunError, PfunError } from './errors';
import { checkPurity, ImportTable, ModuleImportResolver } from './purityCheck';
import { checkTypes } from './typechecker';
import type { TypeImportTable, TypeImportResolver, UnionImportTable, UnionImportResolver } from './inferencer';
import { BUILTIN_FUNCTION_TYPES } from './inferencer';
import { ModuleLoader, resolveModulePath } from './interpreter';

// ─── Per-module record ─────────────────────────────────────────────────────

export interface ModuleNode {
  /** Resolved absolute path, or `__builtin__:name` for a built-in module. */
  resolvedPath: string;
  /** Parsed top-level statements. Absent for built-in modules. */
  ast?: Stmt[];
  /** Source text, kept for error formatting. Absent for built-in modules. */
  source?: string;
  /** This module's own resolved imports — edges in the graph, deduped. */
  imports: { resolvedPath: string; importPath: string; pos: SourcePos | undefined }[];
}

/** Populated for every module once its own checks (or, for a builtin, its
 *  trivial tables) are complete — see "What checking a program means" above. */
interface ModuleInfo {
  exportKinds:  ImportTable;
  exportTypes:  TypeImportTable;
  exportUnions: UnionImportTable;
}

/** Carries enough to format a `[Kind] message` PfunError pointing at the
 *  right file. Two uses: (1) thrown internally to unwind out of
 *  buildModuleGraph on a graph-level error (missing file, circular import,
 *  lex/parse failure) — those still abort the whole walk immediately,
 *  since there is no graph to keep walking past a parse failure; and (2)
 *  constructed (not thrown) as a plain value when checkPurity
 *  rejects a module during the Stage 3 batching loop, so it can be pushed
 *  onto the collected `errors` array and checking can continue with the
 *  next module. Never escapes checkProgram() in either case.*/
class WholeProgramError extends Error {
  constructor(message: string, public sourcePath: string, public source: string, public pos: SourcePos | undefined) {
    super(message);
  }
}

// ─── Step 1+2: graph construction (parse-once) + topological order ─────────

/**
 * Parse the entry file and every file it transitively imports, exactly
 * once each, and return them in dependency-first (topological) order:
 * every module appears after everything it imports. Throws
 * WholeProgramError on a lex/parse error, a missing file, or a circular
 * import (mirroring ModuleLoader's existing "Circular import detected"
 * wording and try/finally-based `loading`-set cleanup).
 *
 * @param entrySource  Stage 3 (REPL preload routing): when provided, used
 *   as the entry file's source text INSTEAD OF reading it from disk —
 *   every other file in the graph (anything the entry imports,
 *   transitively) is still read from disk normally. This exists for
 *   `pfun -i somefile.pf`: the REPL's file-preload syntax allows a
 *   trailing `?` on an entry to print its result (see main.ts's
 *   splitEntries/evalEntryImmediately), which is not valid standalone
 *   .pf syntax — a plain disk-read-and-parse of such a file would fail
 *   to lex/parse at every `?`. The caller (loadReplFile) passes a
 *   position-preserving sanitized copy (see stripReplPrintMarkers) with
 *   those markers blanked out in place, so checkProgram can run its real
 *   cross-module purity/type/exhaustiveness checks over the preloaded
 *   file exactly as it would for any other entry point, while any error
 *   position it reports still lines up with the actual file on disk
 *   (same length, same line breaks — only the `?` character itself, and
 *   nothing else, differs from what's on disk).
 * @param entryFromDir  Stage 3 (REPL preload routing): when provided,
 *   used as the directory the ENTRY file's OWN `./`/`../`-relative
 *   imports resolve against, instead of the entry file's actual
 *   directory (`path.dirname(entryPath)`). Every import inside any OTHER
 *   (nested) module always resolves relative to THAT module's own
 *   directory regardless of this parameter — only the entry node's
 *   import statements are affected. This exists because the REPL's
 *   Interpreter resolves a preloaded file's top-level imports relative
 *   to `process.cwd()`, not the preloaded file's own location (see
 *   `runRepl`'s `baseDir`/`Interpreter` construction in main.ts) — so for
 *   checkProgram's resolution of that SAME entry file's imports to agree
 *   with what evaluation will actually do, it needs that same `cwd`
 *   basis, not the file-location basis every other caller (runFile) uses
 *   and wants.
 *
 * Exported (beyond checkProgram, this file's only other public surface)
 * specifically so tests can verify the "each file parsed exactly once"
 * property directly — by construction, every resolved path appears as
 * exactly one ModuleNode in the returned array, which is a more direct and
 * environment-independent check than spying on fs.readFileSync.
 */
export function buildModuleGraph(entryPath: string, loader: ModuleLoader, entrySource?: string, entryFromDir?: string): ModuleNode[] {
  const nodes    = new Map<string, ModuleNode>();   // resolvedPath -> node
  const visiting = new Set<string>();                // cycle detection
  const order: ModuleNode[] = [];                    // post-order = dependency-first

  function visit(resolvedPath: string, importPath: string, importerPos: SourcePos | undefined, importerSource: string | undefined): ModuleNode {
    // Check in-progress BEFORE completed: a node is added to `nodes` (line
    // below) before its own imports are walked, specifically so a
    // re-import of an already-fully-checked module is a cheap no-op. But
    // that means an in-progress module is ALSO already in `nodes` by the
    // time one of its own (transitive) imports tries to revisit it — so
    // checking `nodes` first would find that not-yet-complete entry and
    // return early, mistaking "still being checked" for "already checked"
    // and silently skipping the cycle check below entirely. Checking
    // `visiting` first catches that case before it can be misread.
    if (visiting.has(resolvedPath)) {
      throw new WholeProgramError(
        `Circular import detected: ${resolvedPath}`,
        resolvedPath, importerSource ?? '', importerPos
      );
    }
    const existing = nodes.get(resolvedPath);
    if (existing) return existing;

    if (resolvedPath.startsWith('__builtin__:')) {
      const node: ModuleNode = { resolvedPath, imports: [] };
      nodes.set(resolvedPath, node);
      order.push(node);
      return node;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new WholeProgramError(
        `Module not found: ${resolvedPath}`,
        resolvedPath, importerSource ?? '', importerPos
      );
    }

    visiting.add(resolvedPath);
    try {
      // entrySource only ever substitutes for THIS exact path (the entry
      // file itself, the one and only call where resolvedPath === the
      // original entryPath argument) — anything resolvedPath could equal
      // here for any OTHER (imported) module always reads from disk
      // normally, same as before this parameter existed.
      const source = (resolvedPath === entryPath && entrySource !== undefined)
        ? entrySource
        : fs.readFileSync(resolvedPath, 'utf-8');
      let ast: Stmt[];
      try {
        ast = new Parser(new Lexer(source).lex()).parse();
      } catch (e) {
        const raw = e instanceof Error ? e : new Error(String(e));
        throw new WholeProgramError(raw.message, resolvedPath, source, (raw as any).pos);
      }

      const node: ModuleNode = { resolvedPath, ast, source, imports: [] };
      nodes.set(resolvedPath, node);

      // Same one-node-only override pattern as entrySource above: only
      // the entry node's OWN imports ever use entryFromDir; every nested
      // module's imports resolve relative to ITS OWN directory exactly
      // as before, matching how the interpreter constructs a fresh
      // baseDir of path.dirname(resolvedPath) for every submodule it
      // loads regardless of where the top-level baseDir came from.
      const fromDir = (resolvedPath === entryPath && entryFromDir !== undefined)
        ? entryFromDir
        : path.dirname(resolvedPath);
      for (const importStmt of collectImportStmts(ast)) {
        const childResolved = loader.resolve(importStmt.path, fromDir);
        node.imports.push({ resolvedPath: childResolved, importPath: importStmt.path, pos: importStmt.pos });
        visit(childResolved, importStmt.path, importStmt.pos, source);
      }

      order.push(node); // post-order: after all of this node's imports are already pushed
      return node;
    } finally {
      // Always clear, success or failure — mirrors ModuleLoader.load's
      // own try/finally around its `loading` Set (interpreter.ts), so a
      // later, separate attempt to check the same path (e.g. a REPL
      // re-check after fixing a syntax error) doesn't wrongly report
      // "Circular import detected" because of a stuck in-progress marker.
      visiting.delete(resolvedPath);
    }
  }

  // No separate pre-read of the entry file here: the very first visit()
  // call can never actually need an `importerSource` for error
  // formatting (the "Circular import detected"/"Module not found"
  // branches only fire for files OTHER than the entry file on this very
  // first call — the entry file can't be circular or missing relative to
  // itself before `visiting` even has an entry yet, and a missing entry
  // file is already caught separately by runFile's own existsSync check
  // before checkProgram ever runs). visit() reads resolvedPath itself
  // (line 158 above) regardless, so a pre-read here would just be a
  // second, wasted read of the exact same file.
  visit(entryPath, entryPath, undefined, undefined);
  return order;
}

/** Find every ImportStmt anywhere in a module's statement tree (not just
 *  top level — imports may be nested, same as exports; see
 *  wholeProgramCheck's design notes). Mirrors the recursive shape already
 *  used elsewhere in this codebase for "find all X anywhere" walks (e.g.
 *  typechecker.ts's registerAllUnions). */
function collectImportStmts(stmts: Stmt[]): { path: string; pos: SourcePos | undefined }[] {
  const result: { path: string; pos: SourcePos | undefined }[] = [];
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ImportStmt':     result.push({ path: s.path, pos: s.pos }); break;
      case 'IfStmt':          walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':       s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':   s.body.forEach(walk); break;
      case 'ExportStmt':      walk(s.declaration); break;
      // Every other statement type cannot contain an ImportStmt.
    }
  }
  for (const s of stmts) walk(s);
  return result;
}

// ─── Step 4: export-kind extraction ────────────────────────────────────────

/**
 * Build a module's ImportTable by walking its own statement tree for
 * ExportStmts (which, like imports, may be nested — see
 * collectImportStmts's docblock) and classifying each exported
 * declaration's kind. Mirrors purityCheck.ts's own per-declaration kind
 * assignment (LetStmt -> 'other', VarStmt -> 'var', FunctionStmt ->
 * 'function', ProcedureStmt -> 'proc') so a module's exports are kind-typed
 * identically whether read from outside (here) or from within
 * (purityCheck.ts's own ExportStmt handling).
 *
 * UnionTypeStmt's zero-field variants (singletons, e.g. `None`) are also
 * exported as values at runtime (see interpreter.ts's ExportStmt handling)
 * — kind 'other', since a singleton is a plain value, never a function or
 * proc. TypeStmt and non-singleton union variants export only type
 * metadata, not a callable/value name, so they contribute nothing to this
 * (purity-only) table.
 */
function extractExportKinds(stmts: Stmt[]): ImportTable {
  const table: ImportTable = new Map();

  function classify(decl: Stmt): void {
    switch (decl.type) {
      case 'LetStmt':       table.set(decl.name, 'other'); break;
      case 'VarStmt':       table.set(decl.name, 'var'); break;
      case 'FunctionStmt':  table.set(decl.name, 'function'); break;
      case 'ProcedureStmt': table.set(decl.name, 'proc'); break;
      case 'UnionTypeStmt':
        for (const v of decl.variants) if (v.fields.length === 0) table.set(v.name, 'other');
        break;
      // TypeStmt: type-only, no value/kind to record here.
    }
  }

  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExportStmt':      classify(s.declaration); break;
      case 'IfStmt':          walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':       s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':   s.body.forEach(walk); break;
      // Every other statement type cannot contain an ExportStmt.
    }
  }
  for (const s of stmts) walk(s);
  return table;
}

/**
 * Build a module's UnionImportTable by walking its own statement tree for
 * exported UnionTypeStmts, capturing each union's full variant descriptor
 * list (name + fields) — the same shape typechecker.ts's own
 * registerAllUnions registers locally-declared unions with. A TypeStmt
 * (plain record) or any non-union declaration contributes nothing here;
 * only UnionTypeStmt carries variant-shape information for exhaustiveness
 * purposes.
 */
function extractExportUnions(stmts: Stmt[]): UnionImportTable {
  const table: UnionImportTable = new Map();

  function classify(decl: Stmt): void {
    if (decl.type === 'UnionTypeStmt') table.set(decl.name, decl.variants);
  }

  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExportStmt':      classify(s.declaration); break;
      case 'IfStmt':          walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':       s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':   s.body.forEach(walk); break;
      // Every other statement type cannot contain an ExportStmt.
    }
  }
  for (const s of stmts) walk(s);
  return table;
}

// ─── Step 3+5: the driver ──────────────────────────────────────────────────

/**
 * Check an entire program — the entry file plus everything it transitively
 * imports — for static procedure-usage (purity) violations AND type/
 * exhaustiveness errors, including across module boundaries (named,
 * namespace, and star imports).
 *
 * Each file is parsed exactly once. Never throws — like checkTypes()
 * itself, this is a plain check, not a try/catch-driven control-flow
 * function, so callers (main.ts) can treat it uniformly.
 *
 * Stage 3 (all-errors batching): a violation in one module does NOT stop
 * checking of the rest of the graph. Every module is still visited in
 * dependency-first order and gets BOTH checkPurity and checkTypes
 * run against it regardless of whether an earlier module already failed;
 * every resulting error (purity, type, exhaustiveness — from every file)
 * is collected into `errors`, each tagged with its own file path. A
 * module that fails either check simply has its export tables withheld
 * from `infoByPath` (see the loop body), so anything that later imports
 * it gets the same permissive "imported name of unknown kind/type"
 * fallback checkPurity/checkTypes already use for an unresolvable
 * import — never a cascade of bogus secondary errors caused by one
 * already-broken module. The one thing that still aborts immediately,
 * before any module-level check runs at all, is a GRAPH-level failure
 * (a missing file, a circular import, or a lex/parse error encountered
 * while building the graph itself — see buildModuleGraph) — there is no
 * graph left to keep walking once parsing can't produce one, so that
 * path is unavoidably single-error.
 *
 * @param entryPath  Absolute path to the entry .pf file.
 * @param loader     A ModuleLoader with built-in modules already
 *                    registered (see registerBuiltinModules in main.ts) —
 *                    reused here purely for its resolve()/builtinExportNames()
 *                    methods; nothing is loaded or interpreted through it.
 * @param entrySource  Stage 3 (REPL preload routing): forwarded verbatim
 *   to buildModuleGraph — see that function's own docblock for the full
 *   rationale. Omit for the normal runFile path, where the entry file's
 *   real on-disk content is always exactly what should be checked.
 * @param entryFromDir  Stage 3 (REPL preload routing): forwarded verbatim
 *   to buildModuleGraph — see that function's own docblock. Omit for the
 *   normal runFile path, where the entry file's own directory is always
 *   the correct resolution base for its imports.
 * @returns  `errors` lists every PfunError found across the whole graph,
 *   in dependency-first order (empty if the whole program passes). `error`
 *   is a convenience alias for `errors[0] ?? null` — kept for callers (and
 *   tests) that only care whether *some* error occurred and what the
 *   first one says; new callers that want the full picture should read
 *   `errors`. `checkedAsts` maps each NON-BUILTIN module's resolved path
 *   to its already-parsed-and-checked (and, since checkTypes mutates in
 *   place, already INFERREDTYPE-ANNOTATED) AST — exactly the
 *   `Map<resolvedPath, checkedAST>` the Stage 3 design calls for, so
 *   `ModuleLoader.load` can consult it instead of re-parsing (see
 *   ModuleLoader.checkedAsts in interpreter.ts). `checkedSources` is the
 *   parallel map of each NON-BUILTIN module's already-read source text —
 *   so a caller (main.ts's runFile) can get the entry file's source for
 *   its own error-formatting needs without a second `fs.readFileSync` of
 *   the same file. Both maps only ever contain entries for modules that
 *   passed BOTH checks — so when `errors` is non-empty, both maps may be
 *   incomplete (a module that itself failed, or anything appearing after
 *   the LAST module reached if a graph-level error cut the walk short, is
 *   simply absent) — safe because a failing program never reaches
 *   interpretation at all (main.ts exits first on any non-empty `errors`),
 *   so a partial map is never actually consulted by load() in that case.
 *   Builtins are deliberately absent from both maps; ModuleLoader.load
 *   already has its own, separate, non-AST-based fast path for the
 *   `__builtin__:` sentinel that doesn't need or want an entry here. The
 *   REPL preload path (loadReplFile) ignores both maps entirely — it
 *   still evaluates the file through its own entry-by-entry pipeline,
 *   unrelated to checkProgram's AST-reuse optimization for runFile.
 */
export function checkProgram(entryPath: string, loader: ModuleLoader, entrySource?: string, entryFromDir?: string): { error: PfunError | null; errors: PfunError[]; checkedAsts: Map<string, Stmt[]>; checkedSources: Map<string, string> } {
  const checkedAsts    = new Map<string, Stmt[]>();
  const checkedSources = new Map<string, string>();
  const errors: PfunError[] = [];
  try {
    const graph = buildModuleGraph(entryPath, loader, entrySource, entryFromDir);
    const infoByPath = new Map<string, ModuleInfo>();

    for (const node of graph) {
      if (node.resolvedPath.startsWith('__builtin__:')) {
        const name  = node.resolvedPath.slice('__builtin__:'.length);
        const names = loader.builtinExportNames(name) ?? [];
        const kinds: ImportTable     = new Map(names.map(n => [n, 'other' as const]));
        // Stage 3: real Fn signatures for every builtin export this
        // project can express precisely — see BUILTIN_FUNCTION_TYPES's
        // own docblock in inferencer.ts for exactly which functions are
        // covered and which are deliberately left Unknown (genuinely
        // polymorphic ones, e.g. mathlib's abs/min/max/clamp, where a
        // monomorphic Fn signature would be WRONG for half their
        // legitimate uses — Unknown there is the honest answer, not a
        // placeholder). Unknown unifies with anything (see ast.ts's
        // UNKNOWN docs), so a function without a table entry never
        // produces a false-positive type error — it just means a misuse
        // of THAT specific function's return value isn't caught
        // statically by this pass, same as every builtin export was
        // before this stage.
        const types: TypeImportTable = new Map(
          names.map(n => [n, BUILTIN_FUNCTION_TYPES.get(n) ?? UNKNOWN])
        );
        // Stage 3: real union variant data for builtin-module-registered
        // unions (filelib's Result/ReadResult/..., httplib's HttpResult,
        // dblib's DbResult/DbValue) — these are RegistryTypes (hand-coded
        // TypeScript, not parsed UnionTypeStmts), but exhaustiveness
        // checking only needs a name + variant list, which
        // loader.builtinUnionTypes exposes directly from the SAME
        // RegistryType[] the runtime itself registers from (no
        // duplicated data to drift out of sync). Modules with no union
        // exports (io, json, math, async) correctly get an empty list
        // here, same as an empty UnionImportTable would.
        const unions: UnionImportTable = new Map(
          (loader.builtinUnionTypes(name) ?? []).map(u => [u.name, u.variants])
        );
        infoByPath.set(node.resolvedPath, { exportKinds: kinds, exportTypes: types, exportUnions: unions });
        continue;
      }

      const fromDir = path.dirname(node.resolvedPath);

      const kindResolver: ModuleImportResolver = (importPath, pos) => {
        // Re-resolve relative to *this* module's own directory — an
        // import path string is only meaningful relative to the module
        // that wrote it, never globally.
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportKinds ?? null;
      };
      const typeResolver: TypeImportResolver = (importPath, pos) => {
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportTypes ?? null;
      };
      const unionResolver: UnionImportResolver = (importPath, pos) => {
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportUnions ?? null;
      };

      // Stage 3: both checks always run for this module, regardless of
      // whether the OTHER one already failed it — they're independent
      // passes over the same already-parsed AST (checkPurity
      // never mutates it; checkTypes' in-place mutation of
      // inferredType/missingVariants is unconditional and safe either
      // way), so running both maximizes how much real information this
      // one pass over the file surfaces, rather than hiding a type error
      // behind an earlier purity error in the same module. `moduleOk`
      // gates only step 4 (export-table caching) below — never whether a
      // check runs.
      let moduleOk = true;

      try {
        checkPurity(node.ast!, kindResolver);
      } catch (e) {
        moduleOk = false;
        const raw = e instanceof Error ? e : new Error(String(e));
        errors.push(formatModuleError(raw.message, node.resolvedPath, node.source!, (raw as any).pos, entryPath));
      }

      const exportTypesOut = new Map<string, PfunType>();
      const typeErrors = checkTypes(node.ast!, node.source!, typeResolver, unionResolver, exportTypesOut);
      if (typeErrors.length > 0) {
        moduleOk = false;
        // checkTypes() never throws — it returns errors, already fully
        // formatted (with their own [Kind]/caret/etc.) by its own
        // buildPfunError calls — so every one of them, not just the
        // first, is pushed straight through via attachFilePathIfCrossFile
        // (which only ever adds a header, never re-runs buildPfunError,
        // avoiding double-formatting).
        for (const typeErr of typeErrors) {
          errors.push(attachFilePathIfCrossFile(typeErr, node.resolvedPath, entryPath));
        }
      }

      if (!moduleOk) continue; // see this function's docblock: withhold export info, keep walking

      infoByPath.set(node.resolvedPath, {
        exportKinds:  extractExportKinds(node.ast!),
        exportTypes:  exportTypesOut,
        exportUnions: extractExportUnions(node.ast!),
      });
      // This module passed BOTH checks and is now fully annotated
      // (checkTypes mutates node.ast! in place) — record it, and its
      // already-read source text, so ModuleLoader.load (and runFile,
      // for the entry file specifically) can reuse both verbatim instead
      // of re-reading/re-parsing.
      checkedAsts.set(node.resolvedPath, node.ast!);
      checkedSources.set(node.resolvedPath, node.source!);
    }

    return { error: errors[0] ?? null, errors, checkedAsts, checkedSources };
  } catch (e) {
    if (e instanceof WholeProgramError) {
      // A graph-level failure (missing file / circular import / lex-parse
      // error while BUILDING the graph) — there is no graph to keep
      // walking past this, so it's unavoidably the program's only error.
      const formatted = formatModuleError(e.message, e.sourcePath, e.source, e.pos, entryPath);
      return { error: formatted, errors: [formatted], checkedAsts, checkedSources };
    }
    throw e; // a genuine bug in this file, not a checked program's own error — let it surface normally
  }
}

/**
 * Format a raw error message (as thrown by checkPurity, or
 * carried by a graph-level WholeProgramError) into a fully-formatted
 * PfunError, attaching an "In <path>:" file-path header when, and only
 * when, the error is in a DIFFERENT file than the one the user actually
 * ran — for the common single-file-program case, "In <the file I just
 * invoked>:" adds visual noise with no information (there was never any
 * ambiguity about which file the error could be in). path.resolve
 * normalizes both sides so the comparison isn't fooled by e.g. a trailing
 * slash or '.' segment difference.
 *
 * Shared by both call sites that start from a raw (not yet PfunError-
 * shaped) message: the per-module checkPurity catch in the Stage
 * 3 batching loop above, and the graph-level WholeProgramError catch
 * below it. checkTypes' own errors never go through this function — they
 * arrive already fully formatted and are headered via
 * attachFilePathIfCrossFile instead (see that function's docblock for why
 * a finished PfunError can't be re-run through buildPfunError).
 */
function formatModuleError(message: string, sourcePath: string, source: string, pos: SourcePos | undefined, entryPath: string): PfunError {
  const resolvedEntry = path.resolve(entryPath);
  const filePath = sourcePath === resolvedEntry ? undefined : displayPath(sourcePath);
  return buildPfunError(
    new Error(message),
    source,
    pos,
    null,
    () => undefined,
    { stringify: String },
    filePath,
  );
}

/**
 * Given an already-fully-formatted PfunError (as returned by checkTypes(),
 * which this file never reformats further) and the resolved path of the
 * file it came from, prepend an "In <path>:" header line when, and only
 * when, that file is NOT the entry file the user actually ran (same
 * suppress-for-the-common-case policy as formatModuleError's
 * checkPurity/graph-level branch, which builds its PfunError
 * fresh via buildPfunError's filePath parameter instead — that path isn't
 * available here because a finished PfunError instance only ever exposes
 * its already-formatted .pfunMessage, never the raw kind/message/pos/
 * source/bindings buildPfunError needs to reformat it; PfunError's own
 * format() method is private and its .message getter (from the base
 * Error class) returns the ALREADY-FORMATTED string too — there is no way
 * to recover the original inputs from a finished instance, so this
 * constructs a new PfunError-shaped value with the header text spliced
 * directly into pfunMessage instead).
 *
 * Returns the original PfunError UNCHANGED (same identity) when no
 * header is needed, so the overwhelmingly common single-file case is
 * byte-for-byte identical to calling checkTypes() directly.
 */
function attachFilePathIfCrossFile(original: PfunError, sourcePath: string, entryPath: string): PfunError {
  const resolvedEntry = path.resolve(entryPath);
  if (sourcePath === resolvedEntry) return original;
  const withHeader = `In ${displayPath(sourcePath)}:\n${original.pfunMessage}`;
  // A plain object matching the one property callers (main.ts) actually
  // read (`.pfunMessage`) is sufficient and avoids re-deriving kind/pos/
  // bindings the original PfunError already computed correctly; the
  // `as PfunError` cast reflects that this file's only real contract with
  // its return value, end to end, is "has a .pfunMessage string" (see
  // main.ts's sole use of checkProgram's result).
  return { ...original, pfunMessage: withHeader } as PfunError;
}

/** Built-in sentinels and absolute paths both make poor error-message
 *  prefixes as-is; render something a person reading the error would
 *  recognize. */
function displayPath(resolvedPath: string): string {
  if (resolvedPath.startsWith('__builtin__:')) return resolvedPath.slice('__builtin__:'.length);
  return resolvedPath;
}
