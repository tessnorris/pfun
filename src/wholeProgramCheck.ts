// src/wholeProgramCheck.ts
//
// Whole-program static checking driver. Walks a program's entire import
// graph, parsing each file exactly once, and runs BOTH static checkers —
// procedure-usage/purity (procedureCheck.ts, Stage 1) and type/
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
//   3. For each module, in that order: run checkProcedureUsage AND
//      checkTypes against it, each seeded with a resolver that can answer
//      "what kind/type/union-shape does this imported name have?" by
//      looking up the already-computed info for whichever module it
//      imports (always already available, since we're going
//      dependency-first).
//   4. After a module's own checks succeed, extract its own export tables
//      — kind (purity), resolved type, and (for unions) variant shape —
//      by walking its ExportStmts, and cache them under that module's
//      resolved path for anything that imports it later.
//   5. The first error encountered anywhere — whichever module, whichever
//      check, whichever violation — stops the whole walk and is reported
//      with that module's file path attached (since the error may not be
//      in the entry file).
//
// Built-in modules (io, math, ...) are leaf nodes with no .pf source:
// their export kinds come from ModuleLoader.builtinExportNames (entirely
// kind 'other' — natives are never proc-typed); their export TYPES are
// all `Unknown` (the Stage 2 design's deliberate choice — see the design
// doc's "Minimal builtin type table" decision; a full hand-written `Fn`
// signature table for the stdlib is Stage 3 work, not done here); they
// export no unions at all (no built-in module currently defines a
// UnionTypeStmt — they're plain JS function/type registrations).

import * as fs from 'fs';
import * as path from 'path';
import { Stmt, Expr, PfunType, UNKNOWN } from './ast';
import { Lexer, SourcePos } from './lexer';
import { Parser } from './parser';
import { buildPfunError, PfunError } from './errors';
import { checkProcedureUsage, ImportTable, ModuleImportResolver } from './procedureCheck';
import { checkTypes } from './typechecker';
import type { TypeImportTable, TypeImportResolver, UnionImportTable, UnionImportResolver } from './inferencer';
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

/** Thrown internally to unwind out of the graph walk / check loop on the
 *  first error, carrying enough to format a `[Kind] message` PfunError
 *  pointing at the right file. Never escapes checkProgram(). */
class WholeProgramError extends Error {
  constructor(message: string, public sourcePath: string, public source: string, public pos: SourcePos | undefined) {
    super(message);
  }
}

/** Thrown internally (parallel to WholeProgramError, but for checkTypes'
 *  errors specifically) to unwind out of the check loop on the first
 *  type/exhaustiveness error. Unlike checkProcedureUsage's plain thrown
 *  Error, checkTypes() returns already-fully-formatted PfunErrors — this
 *  wrapper carries that formatted PfunError through unchanged (see
 *  attachFilePathIfCrossFile) rather than re-deriving one from a raw
 *  message, avoiding double-formatting. Never escapes checkProgram(). */
class WholeProgramTypeError extends Error {
  constructor(public original: PfunError, public sourcePath: string) {
    super(original.message);
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
 * Exported (beyond checkProgram, this file's only other public surface)
 * specifically so tests can verify the "each file parsed exactly once"
 * property directly — by construction, every resolved path appears as
 * exactly one ModuleNode in the returned array, which is a more direct and
 * environment-independent check than spying on fs.readFileSync.
 */
export function buildModuleGraph(entryPath: string, loader: ModuleLoader): ModuleNode[] {
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
      const source = fs.readFileSync(resolvedPath, 'utf-8');
      let ast: Stmt[];
      try {
        ast = new Parser(new Lexer(source).lex()).parse();
      } catch (e) {
        const raw = e instanceof Error ? e : new Error(String(e));
        throw new WholeProgramError(raw.message, resolvedPath, source, (raw as any).pos);
      }

      const node: ModuleNode = { resolvedPath, ast, source, imports: [] };
      nodes.set(resolvedPath, node);

      const fromDir = path.dirname(resolvedPath);
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
 * declaration's kind. Mirrors procedureCheck.ts's own per-declaration kind
 * assignment (LetStmt -> 'other', VarStmt -> 'var', FunctionStmt ->
 * 'function', ProcedureStmt -> 'proc') so a module's exports are kind-typed
 * identically whether read from outside (here) or from within
 * (procedureCheck.ts's own ExportStmt handling).
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
 * @param entryPath  Absolute path to the entry .pf file.
 * @param loader     A ModuleLoader with built-in modules already
 *                    registered (see registerBuiltinModules in main.ts) —
 *                    reused here purely for its resolve()/builtinExportNames()
 *                    methods; nothing is loaded or interpreted through it.
 * @returns  `error` is null if the whole program passes, or the first
 *   PfunError encountered (from whichever file, whichever check)
 *   otherwise. `checkedAsts` maps each NON-BUILTIN module's resolved path
 *   to its already-parsed-and-checked (and, since checkTypes mutates in
 *   place, already INFERREDTYPE-ANNOTATED) AST — exactly the
 *   `Map<resolvedPath, checkedAST>` the Stage 3 design calls for, so
 *   `ModuleLoader.load` can consult it instead of re-parsing (see
 *   ModuleLoader.checkedAsts in interpreter.ts). `checkedSources` is the
 *   parallel map of each NON-BUILTIN module's already-read source text —
 *   so a caller (main.ts's runFile) can get the entry file's source for
 *   its own error-formatting needs without a second `fs.readFileSync` of
 *   the same file. Both maps only ever contain entries for modules
 *   reached BEFORE the first error (on failure, the graph walk stops
 *   early — see "What checking a program means" above) — safe because a
 *   failing program never reaches interpretation at all (main.ts exits
 *   first), so a partial map is never actually consulted by load() in
 *   that case. Builtins are deliberately absent from both maps;
 *   ModuleLoader.load already has its own, separate, non-AST-based fast
 *   path for the `__builtin__:` sentinel that doesn't need or want an
 *   entry here.
 */
export function checkProgram(entryPath: string, loader: ModuleLoader): { error: PfunError | null; checkedAsts: Map<string, Stmt[]>; checkedSources: Map<string, string> } {
  const checkedAsts    = new Map<string, Stmt[]>();
  const checkedSources = new Map<string, string>();
  try {
    const graph = buildModuleGraph(entryPath, loader);
    const infoByPath = new Map<string, ModuleInfo>();

    for (const node of graph) {
      if (node.resolvedPath.startsWith('__builtin__:')) {
        const name  = node.resolvedPath.slice('__builtin__:'.length);
        const names = loader.builtinExportNames(name) ?? [];
        const kinds: ImportTable     = new Map(names.map(n => [n, 'other' as const]));
        // Every builtin export gets type Unknown — the deliberate Stage 2
        // choice (see this file's header); a full hand-written Fn
        // signature table for the stdlib is Stage 3 work. Unknown
        // unifies with anything (see ast.ts's UNKNOWN docs), so this
        // never produces a false-positive type error — it just means a
        // misuse of a builtin's return value isn't YET caught statically
        // by this pass (same gap as before this stage, for builtins
        // specifically — user-module cross-module types are the actual
        // improvement here).
        const types: TypeImportTable = new Map(names.map(n => [n, UNKNOWN]));
        // No built-in module currently exports a union type (they're
        // plain JS function/type registrations, not parsed UnionTypeStmts)
        // — an empty table is exactly correct, not a placeholder.
        const unions: UnionImportTable = new Map();
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

      try {
        checkProcedureUsage(node.ast!, kindResolver);
      } catch (e) {
        const raw = e instanceof Error ? e : new Error(String(e));
        throw new WholeProgramError(raw.message, node.resolvedPath, node.source!, (raw as any).pos);
      }

      const typeResolver: TypeImportResolver = (importPath, pos) => {
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportTypes ?? null;
      };
      const unionResolver: UnionImportResolver = (importPath, pos) => {
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportUnions ?? null;
      };

      const exportTypesOut = new Map<string, PfunType>();
      const typeErrors = checkTypes(node.ast!, node.source!, typeResolver, unionResolver, exportTypesOut);
      if (typeErrors.length > 0) {
        // checkTypes() never throws — it returns errors — so convert its
        // FIRST error into the same WholeProgramError-throwing shape used
        // by checkProcedureUsage above, for uniform first-error handling
        // across both checks and every module. typeErrors[0].pfunMessage
        // is already fully formatted (with its own [Kind]/caret/etc.) by
        // checkTypes' own buildPfunError call, so re-running it through
        // buildPfunError again at the bottom of this function would
        // double-format it — pass the already-formatted message straight
        // through via a thin wrapper instead (see the catch block below).
        throw new WholeProgramTypeError(typeErrors[0], node.resolvedPath);
      }

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

    return { error: null, checkedAsts, checkedSources };
  } catch (e) {
    if (e instanceof WholeProgramTypeError) {
      // Already a fully-formatted PfunError from checkTypes() itself —
      // just attach the cross-file path header (same suppress-when-
      // entry-file logic as the WholeProgramError branch below) without
      // re-running it through buildPfunError, which would double-wrap
      // the [Kind]/caret formatting checkTypes already produced.
      return { error: attachFilePathIfCrossFile(e.original, e.sourcePath, entryPath), checkedAsts, checkedSources };
    }
    if (e instanceof WholeProgramError) {
      // Only attach a file-path header when the error is in a DIFFERENT
      // file than the one the user actually ran — for the common
      // single-file-program case, "In <the file I just invoked>:" adds
      // visual noise with no information (there was never any ambiguity
      // about which file the error could be in). path.resolve normalizes
      // both sides so the comparison isn't fooled by e.g. a trailing
      // slash or '.' segment difference.
      const resolvedEntry = path.resolve(entryPath);
      const filePath = e.sourcePath === resolvedEntry ? undefined : displayPath(e.sourcePath);
      const error = buildPfunError(
        new Error(e.message),
        e.source,
        e.pos,
        null,
        () => undefined,
        { stringify: String },
        filePath,
      );
      return { error, checkedAsts, checkedSources };
    }
    throw e; // a genuine bug in this file, not a checked program's own error — let it surface normally
  }
}

/**
 * Given an already-fully-formatted PfunError (as returned by checkTypes(),
 * which this file never reformats further — see WholeProgramTypeError's
 * docblock) and the resolved path of the file it came from, prepend an
 * "In <path>:" header line when, and only when, that file is NOT the
 * entry file the user actually ran (same suppress-for-the-common-case
 * policy as the WholeProgramError/checkProcedureUsage branch, which
 * builds its PfunError fresh via buildPfunError's filePath parameter
 * instead — that path isn't available here because a finished PfunError
 * instance only ever exposes its already-formatted .pfunMessage, never
 * the raw kind/message/pos/source/bindings buildPfunError needs to
 * reformat it; PfunError's own format() method is private and its
 * .message getter (from the base Error class) returns the ALREADY-
 * FORMATTED string too — there is no way to recover the original inputs
 * from a finished instance, so this constructs a new PfunError-shaped
 * value with the header text spliced directly into pfunMessage instead).
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
