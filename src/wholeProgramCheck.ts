// src/wholeProgramCheck.ts
//
// Stage 1 of whole-program static checking: walks a program's entire
// import graph, parsing each file exactly once, and runs the static
// procedure-usage checker (procedureCheck.ts) against every module in the
// graph — not just the entry file — feeding each module real cross-module
// kind information about what it imports.
//
// This exists because a transpiler has no runtime `inPureContext` check to
// fall back on: the static checks must become the SOLE enforcement of
// purity, which means they must run over every file a program depends on,
// not just the one the user invoked. See the project's whole-program
// checking design notes for the full motivation and staging plan; this
// file implements Stage 1 (graph + purity) only. Stage 2 (types +
// exhaustiveness) extends this with export *type* tables, layered on top
// of the same graph/ordering/caching machinery built here.
//
// ─── What "checking a program" means here ──────────────────────────────────
//
//   1. Parse the entry file, and recursively every file it (transitively)
//      imports — each file parsed exactly once, cached by resolved path.
//   2. Order modules so every module is processed only after everything it
//      imports has already been processed (topological order over the
//      import graph), with circular-import detection.
//   3. For each module, in that order: run checkProcedureUsage against it,
//      seeded with a resolver that can answer "what kind is this imported
//      name?" by looking up the already-computed ImportTable of whichever
//      module it imports (always already available, since we're going
//      dependency-first).
//   4. After a module's own check succeeds, extract its own ImportTable —
//      the kind of every name it exports — by walking its ExportStmts, and
//      cache it under that module's resolved path for anything that
//      imports it later.
//   5. The first error encountered anywhere — whichever module, whichever
//      violation — stops the whole walk and is reported with that module's
//      file path attached (since the error may not be in the entry file).
//
// Built-in modules (io, math, ...) are leaf nodes with no .pf source: their
// ImportTable is built directly from ModuleLoader.builtinExportNames,
// entirely kind 'other' (see that method's docblock in interpreter.ts for
// why this is always sound: native functions are never proc-typed).

import * as fs from 'fs';
import * as path from 'path';
import { Stmt, Expr } from './ast';
import { Lexer, SourcePos } from './lexer';
import { Parser } from './parser';
import { buildPfunError, PfunError } from './errors';
import { checkProcedureUsage, ImportTable, ModuleImportResolver } from './procedureCheck';
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

/** Populated for every module once its own check (or, for a builtin, its
 *  trivial table) is complete — see "What checking a program means" above. */
interface ModuleInfo {
  exportKinds: ImportTable;
}

/** Thrown internally to unwind out of the graph walk / check loop on the
 *  first error, carrying enough to format a `[Kind] message` PfunError
 *  pointing at the right file. Never escapes checkProgram(). */
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

  const entrySource = fs.readFileSync(entryPath, 'utf-8');
  visit(entryPath, entryPath, undefined, entrySource);
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

// ─── Step 3+5: the driver ──────────────────────────────────────────────────

/**
 * Check an entire program — the entry file plus everything it transitively
 * imports — for static procedure-usage (purity) violations, including
 * across module boundaries (named, namespace, and star imports).
 *
 * Each file is parsed exactly once. Returns null if the whole program
 * passes; returns the first PfunError encountered (from whichever file)
 * otherwise. Never throws — like checkTypes(), this is a plain check, not
 * a try/catch-driven control-flow function, so callers (main.ts) can treat
 * it uniformly.
 *
 * @param entryPath  Absolute path to the entry .pf file.
 * @param loader     A ModuleLoader with built-in modules already
 *                    registered (see registerBuiltinModules in main.ts) —
 *                    reused here purely for its resolve()/builtinExportNames()
 *                    methods; nothing is loaded or interpreted through it.
 */
export function checkProgram(entryPath: string, loader: ModuleLoader): PfunError | null {
  try {
    const graph = buildModuleGraph(entryPath, loader);
    const infoByPath = new Map<string, ModuleInfo>();

    for (const node of graph) {
      if (node.resolvedPath.startsWith('__builtin__:')) {
        const name  = node.resolvedPath.slice('__builtin__:'.length);
        const names = loader.builtinExportNames(name) ?? [];
        const table: ImportTable = new Map(names.map(n => [n, 'other' as const]));
        infoByPath.set(node.resolvedPath, { exportKinds: table });
        continue;
      }

      const resolver: ModuleImportResolver = (importPath, pos) => {
        // Re-resolve relative to *this* module's own directory — an
        // import path string is only meaningful relative to the module
        // that wrote it, never globally.
        const fromDir = path.dirname(node.resolvedPath);
        const resolved = loader.resolve(importPath, fromDir);
        return infoByPath.get(resolved)?.exportKinds ?? null;
      };

      try {
        checkProcedureUsage(node.ast!, resolver);
      } catch (e) {
        const raw = e instanceof Error ? e : new Error(String(e));
        throw new WholeProgramError(raw.message, node.resolvedPath, node.source!, (raw as any).pos);
      }

      infoByPath.set(node.resolvedPath, { exportKinds: extractExportKinds(node.ast!) });
    }

    return null;
  } catch (e) {
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
      return buildPfunError(
        new Error(e.message),
        e.source,
        e.pos,
        null,
        () => undefined,
        { stringify: String },
        filePath,
      );
    }
    throw e; // a genuine bug in this file, not a checked program's own error — let it surface normally
  }
}

/** Built-in sentinels and absolute paths both make poor error-message
 *  prefixes as-is; render something a person reading the error would
 *  recognize. */
function displayPath(resolvedPath: string): string {
  if (resolvedPath.startsWith('__builtin__:')) return resolvedPath.slice('__builtin__:'.length);
  return resolvedPath;
}
