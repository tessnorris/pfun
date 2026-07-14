// src/interpreter.ts
import { Expr, Stmt, PfunType } from './ast';
import { SourcePos } from './lexer';
import { buildPfunError, PfunError } from './errors';
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { checkPurity } from './purityCheck';
import { checkTypes } from './typechecker';

// ─── Registry Types ───────────────────────────────────────────────────────────

/**
 * A named native function entry for the interpreter registry.
 * The fn receives forced-thunk args and the interpreter instance.
 */
export type RegistryFunction = {
  name: string;
  arity?: number;  // required for currying native functions; omit for non-curriable
  fn: (args: any[], interpreter: Interpreter) => any;
};

/**
 * A type entry for the interpreter registry.
 * Plain records have fields; union types have variants each with their own fields.
 */
export type RegistryType =
  | { kind: 'plain'; name: string; fields: string[]; generic?: boolean }
  | { kind: 'union'; name: string; variants: { name: string; fields: string[] }[]; generic?: boolean };
// ─── Value Types ──────────────────────────────────────────────────────────────

function getValueType(v: any, schemas?: Map<string, any[]>): string {
  if (v === null || v === undefined) return 'nil';
  if (v instanceof LazyList) return 'lazylist';
  if (v instanceof PfunDict) return 'dict';
  if (v instanceof PfunArray) return v.elementType ? `array<${v.elementType}>` : 'array';
  if (v instanceof PfunByte) return 'byte';
  if (v instanceof PfunChar) return 'char';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'list';
    return `list<${getValueType(v[0], schemas)}>`;
  }
  if (v instanceof PfunFunction || v instanceof NativeFunction) return 'function';
  if (v && v.__type) {
    const baseName = v.__union ?? v.__type;
    if (schemas) {
      const schemaList = schemas.get(v.__type);
      const isGeneric = schemaList?.some((s: any) => s.generic) ?? false;
      if (isGeneric) return baseName;
    }
    return baseName;
  }
  // NOTE: returns 'number' (not 'float') specifically so this agrees with
  // pfunTypeToRuntimeType's case 'Float': return 'number' — both
  // describe the SAME conceptual runtime representation of a Pfun Float
  // (a JS number), and TypeRegistry.instantiate() compares strings from
  // BOTH sources directly (getValueType for the actual constructed
  // value, pfunTypeToRuntimeType for a static inferredType-seeded
  // expectation — see seedFromExpr above). A vocabulary mismatch here
  // ('float' vs 'number' for the literal same thing) was a real,
  // pre-existing bug: it made the FIRST construction of any record with
  // a Float-typed field, reached via seedFromExpr's eager LetStmt-time
  // seeding, spuriously fail with "Type mismatch... expected number, got
  // float" — confirmed reproducible with a plain user-defined type
  // (`type Box = { value }; let x = Box { 5.5 }; println(x);`), with no
  // connection to builtins or any whole-program-checking stage; it
  // simply required a Float-typed field AND the value actually being
  // forced (pfun's laziness meant an unforced `let` never triggered
  // instantiate() at all, masking this for any code that never printed
  // the unused-but-Float-containing binding).
  if (typeof v === 'number') return 'number';
  return typeof v;
}

/**
 * Convert a static PfunType to the runtime type string that getValueType()
 * would return for a value of that type.  Returns null for types that have
 * no direct runtime representation (Fn, TyVar, Unknown, Generic).
 *
 * Used by seedTypes() to pre-populate TypeSchema.inferredTypes from static
 * type annotations before any value is constructed at runtime.
 */
export function pfunTypeToRuntimeType(t: PfunType): string | null {
  switch (t.kind) {
    case 'Int':     return 'bigint';
    case 'Float':   return 'number';
    case 'Bool':    return 'boolean';
    case 'Str':     return 'string';
    case 'Char':    return 'char';
    case 'Byte':    return 'byte';
    case 'Nil':     return 'nil';
    case 'Named':   return t.unionName ?? t.name;
    case 'List': {
      const elem = pfunTypeToRuntimeType(t.element);
      return elem ? `list<${elem}>` : 'list';
    }
    case 'Array': {
      const elem = pfunTypeToRuntimeType(t.element);
      return elem ? `array<${elem}>` : 'array';
    }
    // Fn, Generic, TyVar, Option, Dict, Unknown — no runtime string
    default: return null;
  }
}

/**
 * A single mutable memory cell: `{ value }`. Environment now stores every
 * binding as a Cell rather than a bare value, specifically so a `var`
 * binding's underlying storage can be SHARED BY REFERENCE — not merely
 * copied by value — when it's exported and then imported by another
 * module. Without this, `export var counter = 0;` followed later by
 * `counter = counter + 1;` inside the exporting module would leave any
 * importer holding a stale snapshot from the moment the export statement
 * itself ran, with no way to observe later mutations (from the exporter
 * OR from another importer) — confirmed as the actual pre-existing
 * behavior before this fix. See ExportStmt/ImportStmt's handling below,
 * and ModuleLoader.load's `exports` map, all of which now pass the same
 * Cell object through end to end for a `var` export, rather than a
 * snapshotted plain value.
 */
export class Cell {
  constructor(public value: any) {}
}

export class Environment {
  private values = new Map<string, { cell: Cell, mutable: boolean }>();
  constructor(public parent?: Environment) {}

  define(name: string, value: any, mutable: boolean = false) {
    this.values.set(name, { cell: new Cell(value), mutable });
  }

  /**
   * Like define(), but installs an EXISTING Cell rather than wrapping
   * `value` in a fresh one — so this binding shares its underlying
   * storage with whatever else already holds a reference to that same
   * Cell (e.g. the module that originally declared and exported it, or
   * another module that previously imported it). Used by ImportStmt's
   * handling for `var` exports specifically; every other binding kind
   * (let, function, proc, plain imports of those) still goes through
   * ordinary define(), getting its own fresh, unshared Cell.
   */
  defineCell(name: string, cell: Cell, mutable: boolean = false) {
    this.values.set(name, { cell, mutable });
  }

  /**
   * The underlying Cell for `name`, or undefined if not found in this
   * frame or any parent — used by ExportStmt's handling to capture a
   * `var`'s actual storage (for sharing with importers) rather than a
   * snapshotted value via get(). Plain bindings (let/function/proc) never
   * need this — get() suffices for anything that's never reassigned.
   */
  getCell(name: string): Cell | undefined {
    if (this.values.has(name)) return this.values.get(name)!.cell;
    return this.parent?.getCell(name);
  }

  isDefined(name: string): boolean {
    if (this.values.has(name)) return true;
    return this.parent ? this.parent.isDefined(name) : false;
  }

  /** True if name is defined in THIS environment frame (not a parent). */
  isDefinedLocally(name: string): boolean {
    return this.values.has(name);
  }

  /** True if name resolves to a NativeFunction anywhere in the chain. */
  isNative(name: string): boolean {
    if (this.values.has(name)) return this.values.get(name)!.cell.value instanceof NativeFunction;
    return this.parent ? this.parent.isNative(name) : false;
  }

  get(name: string): any {
    if (this.values.has(name)) return this.values.get(name)!.cell.value;
    if (this.parent) return this.parent.get(name);
    throw new Error(`Undefined variable '${name}'.`);
  }

  assign(name: string, value: any) {
    if (this.values.has(name)) {
      const binding = this.values.get(name)!;
      if (!binding.mutable) throw new Error(`Cannot assign to immutable variable '${name}'.`);
      binding.cell.value = value;
      return;
    }
    if (this.parent) { this.parent.assign(name, value); return; }
    throw new Error(`Undefined variable '${name}'.`);
  }
}

export class Thunk {
  constructor(public expr: Expr, public env: Environment) {}
}

export class TailCall {
  constructor(public fn: PfunFunction, public args: any[]) {}
}

export class PfunDict {
  public entries: Map<string, any>;
  constructor(entries: Map<string, any>) { this.entries = entries; }
  static keyOf(k: any): string {
    if (typeof k === 'string') return `s:${k}`;
    if (typeof k === 'bigint') return `i:${k}`;
    if (typeof k === 'boolean') return `b:${k}`;
    throw new Error(`Dictionary keys must be strings, integers, or booleans, got ${typeof k}.`);
  }
}

/**
 * PfunArray — mutable, zero-indexed, contiguous, homogeneous array.
 * A distinct class from JS arrays so Array.isArray() keeps identifying
 * Pfun lists without ambiguity.
 */
export class PfunArray {
  public elements: any[];
  public elementType: string | null = null;
  constructor(elements: any[]) { this.elements = elements; }
}

export class PfunChar {
  constructor(public value: string) {}
}

export class PfunByte {
  constructor(public value: number) {}  // always 0–255
}

export class LazyList {
  constructor(public descriptor: LazyListDescriptor) {}
}

export type LazyListDescriptor =
  | { kind: 'iterate'; f: any; seed: any }
  | { kind: 'repeat';  value: any }
  | { kind: 'cycle';   source: any }
  | { kind: 'map';     f: any; source: any }
  | { kind: 'filter';  f: any; source: any }
  | { kind: 'cons';    head: any; tail: any }
  | { kind: 'drop';    n: number; source: LazyList };

// ─── Async/await (phase 2): the Effect protocol ────────────────────────────
//
// The evaluator core (evaluateExpr/evaluateStmt/force/PfunFunction.execute/
// trampoline, plus — from step 3 — the lazy-list machinery) is implemented
// as a mutually-recursive chain of generator functions (`function*`) that
// communicate via `yield*` delegation. Every `yield` in that chain yields an
// `Effect`:
//
//   - 'await'  — (step 4) the evaluator hit an `AwaitExpr`; carries a real JS
//                 Promise that the top-level driver must `await` before
//                 resuming. Unhandled by intermediate frames — bubbles all
//                 the way up via `yield*`.
//   - 'emit'   — (step 3) a lazy-list generator (makeGenerator) has produced
//                 the next element; consumed internally by takeFrom/etc.,
//                 never escapes to the top-level driver.
//
// In phase 2, NOTHING in source can produce either kind of Effect yet (no
// `await` expressions are evaluated, and makeGenerator/takeFrom haven't been
// unified into this protocol yet — that's step 3). So every generator in
// this phase runs to completion on the first `.next()` with `done: true`
// and never yields. `runSync` below enforces this: if a generator DOES
// yield in phase 2, that's a bug (most likely a missed `yield*` during the
// conversion), and runSync throws loudly rather than silently dropping the
// effect.
export type Effect =
  | { kind: 'await'; promise: Promise<any> }
  | { kind: 'emit';  value: any };

/**
 * Drive a generator-core method to completion synchronously, assuming it
 * never yields an Effect. This is the "Option B" sync wrapper: library code
 * (library.ts, mathlib.ts, iolib.ts, jsonlib.ts, filelib.ts, and their
 * tests) keeps calling `interp.force(...)`, `interp.evaluateExpr(...)`,
 * `fn.execute(...)`, etc. with the same synchronous signatures as before —
 * those names now drive the `*Gen` generator core via runSync.
 *
 * Phase 2/3: no Effect can ever be produced, so this is purely a mechanical
 * adapter. Phase 4+: per the typechecker's async-contagion rule, a sync
 * (non-async) calling context is guaranteed to never need to suspend, so
 * runSync remains correct for library call sites that are themselves
 * reachable only from sync Pfun code.
 */
export function runSync<T>(gen: Generator<Effect, T, any>): T {
  const step = gen.next();
  if (!step.done) {
    throw new Error(
      `Internal error: synchronous evaluation path yielded an Effect ` +
      `(kind: '${step.value.kind}'). This indicates either an 'await' was ` +
      `reached from a context that cannot suspend, or a generator-core ` +
      `method is missing a 'yield*' delegation.`
    );
  }
  return step.value;
}

/**
 * Drive a generator-core method to completion, performing a real JS `await`
 * whenever an 'await' Effect is yielded (step 4).
 *
 * This is the top-level driver for any evaluation that might contain
 * `AwaitExpr`. A single call to runAsync corresponds to one "task" — for
 * now (before step 6's scheduler exists) there is exactly one task at a
 * time, so this is just `interpret`'s evaluation loop made `async`.
 *
 * 'emit' effects should never reach here — they're consumed internally by
 * takeFromGen/makeGeneratorGen (step 3). If one does escape to this driver,
 * that's a bug in the lazy-list plumbing, so we throw loudly rather than
 * silently misinterpreting it as an await.
 *
 * Promise rejection: if the awaited promise rejects, we resume the
 * generator via `.throw(err)` rather than `.next(...)` — the rejection
 * becomes a normal thrown error at the `yield` inside AwaitExpr's
 * evaluation, propagating through Pfun's existing try/catch and
 * wrapError/PfunError machinery exactly like a synchronous throw.
 */
export async function runAsync<T>(gen: Generator<Effect, T, any>): Promise<T> {
  let step = gen.next();
  while (!step.done) {
    const eff = step.value;
    if (eff.kind !== 'await') {
      throw new Error(
        `Internal error: top-level driver received an unexpected Effect ` +
        `(kind: '${(eff as any).kind}'). 'emit' effects must be consumed ` +
        `internally by takeFromGen/makeGeneratorGen.`
      );
    }
    try {
      const resolved = await eff.promise;
      step = gen.next(resolved);
    } catch (err) {
      step = gen.throw(err);
    }
  }
  return step.value;
}

export class NativeFunction {
  constructor(
    public fn: (args: any[], interpreter: Interpreter) => any,
    public arity: number = 0
  ) {}
  execute(args: any[], interpreter: Interpreter) { return this.fn(args, interpreter); }
}

export class PfunFunction {
  public cache = new Map<string, any>();
  constructor(
    public name: string | null,
    public params: string[],
    public body: Stmt[] | Expr,
    public closure: Environment,
    public kind: 'function' | 'procedure' = 'function',
    public memo: boolean = false,
    // ── Async/await (phase 4) ──────────────────────────────────────────────
    // Mirrors FunctionStmt.async/ProcedureStmt.async (phase 1, purely
    // syntactic until now). Used by Interpreter.containsAwait so that
    // `f()` — a call to a function/proc whose own body contains `await` —
    // is treated as itself "containing await" for the purposes of deciding
    // whether an argument/let-initializer expression must be evaluated
    // eagerly rather than thunked (see containsAwait for the full
    // explanation). Defaults to false for PfunFunctions constructed without
    // it (lambdas, currying partials — see PfunFunction construction sites).
    public async: boolean = false
  ) {}

  // ── Async/await (phase 2) ────────────────────────────────────────────────
  // execute() is now a sync wrapper around executeGen(), the generator-core
  // implementation. Library code calling fn.execute(args, interp) is
  // unaffected — same signature, same synchronous return (see runSync).
  execute(args: any[], interpreter: Interpreter): any {
    return runSync(this.executeGen(args, interpreter));
  }

  /**
   * Generator-core implementation of execute(). Identical logic to the
   * original execute(), but every recursive call into the evaluator
   * (evaluateStmtGen/evaluateExprGen) is delegated via `yield*` so that an
   * Effect (e.g. an 'await' from step 4) yielded deep inside a function body
   * propagates all the way out to the top-level driver through this
   * trampoline loop.
   */
  *executeGen(args: any[], interpreter: Interpreter): Generator<Effect, any, any> {
    let currentArgs = args;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let currentFn: PfunFunction = this;
    // ── Async/await (phase 5) ────────────────────────────────────────────
    // Save the caller's inAsyncContext once; restore it when this call
    // (including any TailCall trampoline iterations) finishes. Within the
    // loop, inAsyncContext tracks currentFn.async — a TailCall to a
    // differently-`async`-flagged function correctly updates the context
    // for that iteration's body.
    const prevAsyncContext = interpreter.inAsyncContext;
    try {
      while (true) {
        interpreter.inAsyncContext = currentFn.async;
        const env = new Environment(currentFn.closure);
        for (let i = 0; i < currentFn.params.length; i++) {
          env.define(currentFn.params[i], currentArgs[i], false);
        }
        let result: any;
        if (Array.isArray(currentFn.body)) {
          try {
            result = undefined;
            const stmts = currentFn.body;
            for (let i = 0; i < stmts.length; i++) {
              interpreter.inTailPosition = (i === stmts.length - 1);
              result = yield* interpreter.evaluateStmtGen(stmts[i], env);
            }
            interpreter.inTailPosition = false;
          } catch (e) {
            interpreter.inTailPosition = false;
            if (e instanceof ReturnValue) result = e.value;
            else throw e;
          }
        } else {
          interpreter.inTailPosition = true;
          result = yield* interpreter.evaluateExprGen(currentFn.body, env);
          interpreter.inTailPosition = false;
        }
        if (result instanceof TailCall) {
          currentFn   = result.fn;
          currentArgs = result.args;
          continue;
        }
        return result;
      }
    } finally {
      interpreter.inAsyncContext = prevAsyncContext;
    }
  }
}

export class ReturnValue { constructor(public value: any) {} }

// ─── Type Registry ────────────────────────────────────────────────────────────

interface TypeSchema {
  fields: string[];
  inferredTypes: string[] | null;
  unionName: string | null;
  generic?: boolean;
}

/**
 * TypeRegistry supports shared variant names across different union types.
 * For example, both Result and ReadResult can define Ok, Err variants —
 * they are disambiguated at runtime by the value's __union tag.
 *
 * schemas maps variantName -> list of schemas (one per union that defines it).
 * Lookup by variant name alone returns the first schema (for plain types and
 * unambiguous variants). Lookup by (variantName, unionName) is used when the
 * union context is known (construction, match arm resolution).
 */
export class TypeRegistry {
  // variant name -> one schema per union that defines that variant name
  private schemas = new Map<string, TypeSchema[]>();
  private unions   = new Map<string, Set<string>>();

  registerPlain(name: string, fields: string[], generic: boolean = false) {
    const existing = this.schemas.get(name) ?? [];
    existing.push({ fields, inferredTypes: null, unionName: null, generic });
    this.schemas.set(name, existing);
  }

  registerUnion(unionName: string, variants: { name: string; fields: string[] }[], globals?: Environment, generic: boolean = false) {
    const variantNames = new Set<string>();
    for (const v of variants) {
      const existing = this.schemas.get(v.name) ?? [];
      // Idempotent: a variant already registered to THIS union is a no-op
      // (re-import of same module). Only the global singleton below re-runs.
      if (!existing.some(s => s.unionName === unionName)) {
        existing.push({ fields: v.fields, inferredTypes: null, unionName, generic });
        this.schemas.set(v.name, existing);
      } else if (generic) {
        // Already registered — propagate generic flag if this registration says generic.
        const entry = existing.find(s => s.unionName === unionName);
        if (entry) entry.generic = true;
      }
      variantNames.add(v.name);
      if (v.fields.length === 0 && globals) {
        if (!globals.isDefined(v.name)) {
          globals.define(v.name, { __type: v.name, __union: unionName }, false);
        }
      }
    }
    this.unions.set(unionName, variantNames);
  }

  /**
   * Pre-seed the inferred field types for a schema from static type annotations.
   *
   * Called by evaluateRecord() using the inferredType annotation written by the
   * typechecker, so that the FIRST runtime construction of a type is checked
   * even if a prior lazy `let` binding of the same type was never forced.
   *
   * Rules (matching test expectations):
   *  - Skips generic schemas — they accept any field type.
   *  - Skips if inferredTypes is already set (runtime or prior seed wins).
   *  - Skips if any entry in `runtimeTypes` is null (partial info → don't seed).
   *  - Otherwise sets inferredTypes to the provided array.
   */
  seedTypes(name: string, runtimeTypes: (string | null)[], unionHint?: string): void {
    const schema = this.getSchema(name, unionHint ?? null);
    if (!schema) return;
    if (schema.generic) return;
    if (schema.inferredTypes !== null) return;            // already set — don't overwrite
    if (runtimeTypes.some(t => t === null)) return;      // partial info — skip
    schema.inferredTypes = runtimeTypes as string[];
  }

  /** Find the schema for (variantName, unionName). Falls back to first schema if unionName is null. */
  private getSchema(name: string, unionName: string | null): TypeSchema | undefined {
    const list = this.schemas.get(name);
    if (!list || list.length === 0) return undefined;
    if (unionName === null) return list[0];
    return list.find(s => s.unionName === unionName) ?? list[0];
  }

  /**
   * Construct a value of variant `name`. If the same variant name exists in
   * multiple unions, `unionHint` (the __union tag of the containing value or
   * the explicit union name) disambiguates which schema to use.
   */
  instantiate(name: string, orderedValues: any[], unionHint?: string): any {
    const schema = this.getSchema(name, unionHint ?? null);
    if (!schema) throw new Error(`Unknown type '${name}'.`);
    if (orderedValues.length !== schema.fields.length) {
      throw new Error(`'${name}' expects ${schema.fields.length} field(s), got ${orderedValues.length}.`);
    }
    const currentTypes = orderedValues.map(v => getValueType(v));
    if (!schema.generic) {
      if (schema.inferredTypes === null) {
        schema.inferredTypes = currentTypes;
      } else {
        for (let i = 0; i < schema.fields.length; i++) {
          const expected = schema.inferredTypes[i];
          const actual   = currentTypes[i];
          if (actual === 'list' && expected.startsWith('list')) continue;
          if (expected === 'list' && actual.startsWith('list')) {
            schema.inferredTypes[i] = actual;
            continue;
          }
          if (expected !== actual) {
            throw new Error(`Type mismatch in ${name}: field '${schema.fields[i]}' expected ${expected}, got ${actual}.`);
          }
        }
      }
    }
    const obj: any = { __type: name, __union: schema.unionName ?? undefined };
    schema.fields.forEach((f, i) => obj[f] = orderedValues[i]);
    return obj;
  }

  /**
   * Given a variant name and a union context (from a runtime value's __union),
   * return the union name. When a variant name is shared, the unionContext
   * disambiguates which union it belongs to for exhaustiveness checking.
   */
  unionOf(variantName: string, unionContext?: string): string | null {
    const schema = this.getSchema(variantName, unionContext ?? null);
    return schema?.unionName ?? null;
  }

  variantsOf(unionName: string): Set<string> | null {
    return this.unions.get(unionName) ?? null;
  }

  hasType(name: string): boolean { return this.schemas.has(name); }

  getFields(name: string, unionHint?: string): string[] {
    return this.getSchema(name, unionHint ?? null)?.fields ?? [];
  }
}

// ─── Stdin Buffer ─────────────────────────────────────────────────────────────

export class StdinBuffer {
  private buf: Buffer = Buffer.alloc(1);
  private eof: boolean = false;

  readByte(): number | null {
    if (this.eof) return null;
    try {
      const n = fs.readSync(0, this.buf, 0, 1, null);
      if (n === 0) { this.eof = true; return null; }
      return this.buf[0];
    } catch { this.eof = true; return null; }
  }

  readChar(): string | null {
    const b0 = this.readByte();
    if (b0 === null) return null;
    let bytes: number[];
    if (b0 < 0x80) { bytes = [b0]; }
    else if (b0 < 0xE0) { const b1 = this.readByte(); if (b1 === null) return String.fromCharCode(b0); bytes = [b0, b1]; }
    else if (b0 < 0xF0) { const b1 = this.readByte(); if (b1 === null) return String.fromCharCode(b0); const b2 = this.readByte(); if (b2 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2]; }
    else { const b1 = this.readByte(); if (b1 === null) return String.fromCharCode(b0); const b2 = this.readByte(); if (b2 === null) return String.fromCharCode(b0); const b3 = this.readByte(); if (b3 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2, b3]; }
    return Buffer.from(bytes).toString('utf8') || null;
  }

  readLine(): string | null {
    let line = '';
    let gotAny = false;
    while (true) {
      const c = this.readChar();
      if (c === null) return gotAny ? line : null;
      gotAny = true;
      if (c === '\n') return line;
      if (c !== '\r') line += c;
    }
  }
}

// ─── Module Loader ────────────────────────────────────────────────────────────

/**
 * Resolve an import path to an absolute file path (or a `__builtin__:name`
 * sentinel for a built-in module). Pulled out as a free function — rather
 * than kept only as ModuleLoader.resolve — so the static whole-program
 * checker (wholeProgramCheck.ts) can share the exact same resolution logic
 * without needing a full ModuleLoader/Interpreter instance, per
 * wholeProgramCheck.ts's design ("Component 1 — ModuleResolver": reuse, not
 * duplicate). ModuleLoader.resolve below is now a thin wrapper over this.
 *
 * @param importPath   The raw string from an ImportStmt's `path` field.
 * @param fromDir      The importing module's own directory (for `./`/`../`
 *                      relative imports).
 * @param libDir       Directory for bare-name imports (e.g. "math" →
 *                      libDir/math.pf).
 * @param isBuiltin    True if importPath names a registered built-in
 *                      module (e.g. 'io').
 */
/**
 * Expand a leading `$PFUN_HOME/` token in an import path to the value of
 * the PFUN_HOME environment variable, enabling app files installed outside
 * the Pfun project tree to refer to the standard libraries portably:
 *
 *   import * from "$PFUN_HOME/lib/htmllib";   // works from any directory
 *
 * If PFUN_HOME is not set, the token is left unexpanded and path resolution
 * will fail with a normal "module not found" error, which is the right
 * diagnostic — the environment is misconfigured.
 *
 * Only a leading `$PFUN_HOME/` is expanded (not mid-path occurrences),
 * matching how shell variable expansion works for path prefixes.
 */
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

export function expandPfunHome(importPath: string): string {
  if (importPath.startsWith('$PFUN_HOME/')) {
    const pfunHome = process.env.PFUN_HOME;
    if (!pfunHome) return importPath;

    return pfunHome + importPath.slice('$PFUN_HOME'.length);
  }

  return expandPfunNamespace(importPath);
}

export function resolveModulePath(
  importPath: string,
  fromDir: string,
  libDir: string,
  isBuiltin: boolean,
): string {
  if (isBuiltin) return `__builtin__:${importPath}`;
  const expanded = expandPfunHome(importPath);
  const base = (expanded.startsWith('./') || expanded.startsWith('../') || path.isAbsolute(expanded))
    ? path.resolve(fromDir, expanded)
    : path.resolve(libDir, expanded);
  return base.endsWith('.pf') ? base : base + '.pf';
}

export class ModuleLoader {
  private cache   = new Map<string, Map<string, any>>();
  private loading = new Set<string>();
  private builtins = new Map<string, { fns: RegistryFunction[]; types: RegistryType[] }>();

  /**
   * Set by main.ts's runFile, AFTER checkProgram() has already run
   * successfully over this loader's entire import graph (see
   * wholeProgramCheck.ts) — never set by the REPL paths, which never call
   * checkProgram at all (out of scope for whole-program checking; see
   * wholeProgramCheck.ts's design notes). When true, load() below skips
   * its own per-module checkPurity/checkTypes calls for modules
   * loaded through this loader, since checkProgram already proved the
   * WHOLE graph — same-module violations within a dependency included,
   * not just cross-module misuse by importers — is error-free before any
   * execution began; re-checking here would just repeat exactly the same
   * work checkProgram already did, on the exact same parsed files. Stays
   * false (the default) for the REPL's own ModuleLoader instance, where
   * load()'s per-module checks remain the ONLY static checking a
   * dynamically `import`ed file ever receives.
   */
  /**
   * Set by main.ts's runFile to checkProgram()'s returned `checkedAsts`
   * map, AFTER checkProgram() has already run successfully. Stage 3's
   * "remove the double-parse" piece: when a resolved path has an entry
   * here, load() below uses that already-parsed, already-checked,
   * already-INFERREDTYPE-ANNOTATED AST directly instead of re-reading the
   * file and re-parsing it. A NON-EMPTY map also doubles as "this
   * loader's entire import graph was already statically checked upfront"
   * — load()'s fallback branch (for any path NOT in this map) relies on
   * that to decide whether to run its own checkPurity/checkTypes
   * calls. This is sound because the only caller that ever populates
   * this map (runFile) does so for checkProgram's WHOLE graph and exits
   * the process before any load() call happens if checkProgram found an
   * error — so by the time load() ever runs for that loader, this map is
   * guaranteed complete for every module reachable in this run; an empty
   * map at that point would only mean "this is the REPL's loader, which
   * never calls checkProgram at all" (out of scope for whole-program
   * checking — see wholeProgramCheck.ts's design notes), never "checking
   * is incomplete." Stays empty (the default) for the REPL's own loader,
   * where every load() still parses AND checks fresh, exactly as before
   * this stage.
   */
  checkedAsts = new Map<string, Stmt[]>();

  /**
   * @param libDir   Directory for bare-name imports (e.g. "math" → libDir/math.pf)
   * @param setup    Called on each sub-interpreter after construction, before
   *                 running the module. Use this to register the stdlib.
   */
  constructor(
    private libDir: string,
    private setup: (interp: Interpreter) => void = () => {}
  ) {}

  /** Register a built-in module by name (e.g. 'io', 'file'). */
  registerBuiltin(name: string, fns: RegistryFunction[], types: RegistryType[] = []): void {
    this.builtins.set(name, { fns, types });
  }

  /** True if `name` was registered via registerBuiltin (e.g. 'io', 'math'). */
  isBuiltin(name: string): boolean {
    return this.builtins.has(name);
  }

  /**
   * The names exported by a built-in module (function names and type
   * names together) — used by the static whole-program checker
   * (wholeProgramCheck.ts) to seed a builtin import's names into scope
   * without needing to parse anything. Returns null if `name` was never
   * registered.
   *
   * Every built-in export is unconditionally kind-'other' / type-Unknown
   * from the static checker's perspective: RegistryFunction (see its type
   * above) has no kind field at all, so no native stdlib function is ever
   * proc-typed — their effects are gated at the call site by
   * inPureContext, not by the natives themselves. See
   * wholeProgramCheck.ts's design notes for the full reasoning.
   */
  builtinExportNames(name: string): string[] | null {
    const entry = this.builtins.get(name);
    if (!entry) return null;
    return [...entry.fns.map(f => f.name), ...entry.types.map(t => t.name)];
  }

  /**
   * The union-shaped RegistryTypes a built-in module registers (e.g.
   * filelib's Result/ReadResult/FileHandle/FileMode/BufferMode) — used by
   * the static whole-program checker (wholeProgramCheck.ts) to seed real
   * exhaustiveness data for a builtin import, the same way it already
   * does for a user module's parsed UnionTypeStmts. Plain (non-union)
   * RegistryTypes (e.g. dblib's QueryResult) are intentionally excluded —
   * they have no variants for exhaustiveness checking to ever need.
   * Returns null if `name` was never registered (mirrors
   * builtinExportNames's contract exactly).
   */
  builtinUnionTypes(name: string): { name: string; variants: { name: string; fields: string[] }[] }[] | null {
    const entry = this.builtins.get(name);
    if (!entry) return null;
    return entry.types
      .filter((t): t is RegistryType & { kind: 'union' } => t.kind === 'union')
      .map(t => ({ name: t.name, variants: t.variants }));
  }

  resolve(importPath: string, fromDir: string): string {
    return resolveModulePath(importPath, fromDir, this.libDir, this.builtins.has(importPath));
  }

  load(resolvedPath: string): Map<string, any> {
    if (this.cache.has(resolvedPath)) return this.cache.get(resolvedPath)!;
    // Built-in module
    if (resolvedPath.startsWith('__builtin__:')) {
      const name    = resolvedPath.slice('__builtin__:'.length);
      const builtin = this.builtins.get(name)!;
      const exports = new Map<string, any>();
      for (const fn   of builtin.fns)   exports.set(fn.name,   { __builtinFn: fn });
      for (const type of builtin.types) exports.set(type.name, { __registryType: type });
      this.cache.set(resolvedPath, exports);
      return exports;
    }
    if (this.loading.has(resolvedPath)) throw new Error(`Circular import detected: ${resolvedPath}`);
    if (!fs.existsSync(resolvedPath)) throw new Error(`Module not found: ${resolvedPath}`);
    this.loading.add(resolvedPath);
    try {
      // Stage 3: reuse checkProgram's already-parsed, already-checked,
      // already-inferredType-ANNOTATED AST when available (runFile path
      // — see checkedAsts's docblock above) instead of re-reading the
      // file and re-parsing it from scratch. This is not merely cheaper:
      // the reused AST carries real type annotations a fresh parse never
      // would, which the interpreter's record-schema seeding can use
      // (see evaluateRecord()'s seedTypes/seedFromExpr path) — so this is
      // strictly better, not just faster. checkPurity/checkTypes
      // are skipped entirely in this branch (not merely
      // wholeProgramChecked-gated) because reusing an entry from
      // checkedAsts means checkProgram has ALREADY run both checks
      // against this exact AST object — re-checking would mutate
      // already-mutated shared state a second time, which the Stage 3
      // design notes explicitly warn against (see "no post-handoff AST
      // mutation" in the design doc).
      const cachedAst = this.checkedAsts.get(resolvedPath);
      let ast: Stmt[];
      if (cachedAst) {
        ast = cachedAst;
      } else {
        const source = fs.readFileSync(resolvedPath, 'utf-8');
        ast = new Parser(new Lexer(source).lex()).parse();
        if (this.checkedAsts.size === 0) {
          // Skipped when checkProgram already validated this loader's
          // ENTIRE import graph upfront (runFile path, signaled by a
          // non-empty checkedAsts — see its docblock above) AND this
          // particular path just happened to have no entry there for
          // some other reason. In practice that combination shouldn't
          // arise for the runFile path (see the docblock); this branch's
          // real-world audience is the REPL's own loader, where
          // checkedAsts stays empty and this is the only static checking
          // a dynamically `import`ed file ever gets.
          checkPurity(ast);
          const typeErrors = checkTypes(ast, source);
          if (typeErrors.length > 0) throw typeErrors[0];
        }
      }
      const interp = new Interpreter(path.dirname(resolvedPath), this);
      this.setup(interp);
      interp.interpret(ast);
      const exports = interp.getExports();
      this.cache.set(resolvedPath, exports);
      return exports;
    } finally {
      // Always clear the in-progress marker, regardless of how the load
      // ended — on success AND on any error (lex/parse error,
      // checkPurity, checkTypes, or interpretation itself throwing).
      // Without this, any failed load would leave resolvedPath stuck in
      // `loading` forever, so a SECOND attempt to load the same (now
      // perhaps-fixed, in a REPL session, or simply retried) path would
      // incorrectly report "Circular import detected" instead of
      // re-attempting the load and surfacing the real error again.
      this.loading.delete(resolvedPath);
    }
  }
}

// ─── Interpreter ──────────────────────────────────────────────────────────────

export class Interpreter {
  private globals  = new Environment();
  public  types    = new TypeRegistry();
  public  inPureContext: boolean = false;
  public  inTailPosition: boolean = false;
  // ── Async/await (phase 5) ──────────────────────────────────────────────
  // Mirrors inPureContext: true while executing top-level code or the body
  // of an `async function`/`async proc`; false inside a non-async
  // function/proc body. AwaitExpr evaluation checks this and throws if
  // false — the runtime enforcement of "await only inside async
  // functions/procs" (the async-contagion rule), exactly parallel to how
  // inPureContext enforces "var/procedure-calls only outside pure
  // functions" as a RUNTIME check rather than a static one, consistent with
  // this codebase's existing purity-checking style.
  //
  // Defaults to true: top-level statements (driven by interpret/
  // interpretAsync) may use `await` directly, matching top-level await in
  // ES modules. executeGen sets this to `currentFn.async` for the duration
  // of a function/procedure body, restoring the previous value afterward —
  // same save/restore pattern as inPureContext/inTailPosition. Concurrent
  // tasks (step 6) are isolated from each other's mutations of this field
  // by Scheduler.spawn, which snapshots/restores inPureContext/
  // inTailPosition/inAsyncContext around each task's execution slice — see
  // the Scheduler class below for details.
  public  inAsyncContext: boolean = true;

  // ── Async/await (phase 6) ────────────────────────────────────────────────
  // Lazily-created Scheduler for this interpreter. Native functions that
  // need to run Pfun code concurrently (e.g. httpserver.listen, which spawns
  // a task per incoming HTTP request) call `interp.scheduler.spawn(...)`.
  // Most programs (no httpserver involved) never touch this.
  private _scheduler?: Scheduler;
  get scheduler(): Scheduler {
    if (!this._scheduler) this._scheduler = new Scheduler(this);
    return this._scheduler;
  }

  /**
   * Invoke a Pfun function/proc as an isolated task in response to an
   * external (non-Pfun-driven) event — an incoming HTTP request, a future
   * JS event-emitter callback, a timer, etc. This is the generic form of
   * what httpListen's per-request dispatch has always done by hand:
   *   1. Build the function's executeGen() generator from the given args.
   *   2. Spawn it via the Scheduler, so it interleaves with other in-flight
   *      tasks at `await` points rather than blocking the caller.
   *   3. If the task throws/rejects without completing, route the error to
   *      `onError` instead of letting it escape into whatever external JS
   *      code triggered the callback (which likely has no idea what a
   *      PfunError is and may crash, hang, or silently swallow it
   *      depending on the calling convention).
   *
   * `callback` must be a PfunFunction (function or procedure) — native
   * modules should validate this themselves before calling, so the error
   * message can reference the specific native function name (see
   * httplib.ts's `instanceof PfunFunction` check on `handler` for the
   * existing pattern this replaces).
   *
   * Returns nothing — like Scheduler.spawn, this returns immediately; the
   * task runs concurrently. Native code that needs to react to the
   * callback's *result* (rather than just firing it and moving on) should
   * pass an onError that also captures success via a side channel (closure
   * over a `responded` flag, a promise resolve, etc.) — exactly how
   * httpListen's send()/responded guard works today. A future iteration of
   * this method could accept an onResult callback as well, once a second
   * caller actually needs one.
   */
  spawnPfunCallback(callback: PfunFunction, args: any[], onError: TaskErrorHandler): void {
    this.scheduler.spawn(callback.executeGen(args, this), onError);
  }

  // ── Async/await (phase 6) ────────────────────────────────────────────────
  // Generic cleanup registry: long-lived resources created by native
  // functions (currently: http.Server instances from httpListen) register a
  // close()-like callback here. Normal Pfun programs never call this — the
  // process exits naturally when the script ends or the server keeps it
  // alive. Tests use this to close servers between test cases. Typed `any`
  // to avoid this module depending on 'http'.
  public _resources: { close: () => void }[] = [];

  private exports  = new Map<string, any>();
  private baseDir:      string;
  private moduleLoader: ModuleLoader;

  // ─── Script arguments ───────────────────────────────────────────────────
  // Command-line arguments passed to the running .pf script (i.e. everything
  // after the script path: `pfun script.pf foo bar` -> ["foo", "bar"]).
  // Set by main.ts after construction; defaults to [] (e.g. for tests or
  // any embedding that doesn't set it explicitly). iolib's scriptArgs()
  // exposes this to Pfun code as a List<Str>.
  public scriptArgs: string[] = [];

  // ─── Error reporting context ──────────────────────────────────────────────
  // Tracks the source text and current position for error reporting.
  // The interpreter pushes/pops positions as it evaluates AST nodes so that
  // the innermost position is always available when an error is thrown.
  public  sourceText: string = '';
  private _currentPos: SourcePos | undefined = undefined;
  private _currentNode: Expr | Stmt | null = null;
  private _currentEnv: Environment | null = null;

  constructor(baseDir: string = process.cwd(), moduleLoader?: ModuleLoader) {
    this.baseDir      = baseDir;
    this.moduleLoader = moduleLoader ?? new ModuleLoader(path.join(baseDir, 'lib'));
  }

  /** Update the "currently executing" position for error reporting.
   * Only tracks nodes that carry meaningful context — statements, calls,
   * binary/assign expressions. Skips simple literals and identifiers so
   * that sub-expression evaluation doesn't clobber a parent node's position.
   */
  private trackPos(node: Expr | Stmt, env: Environment): void {
    if (!node.pos) return;
    const t = node.type;
    // Always track statements
    const isStmt = t === 'LetStmt' || t === 'VarStmt' || t === 'ExprStmt' ||
                   t === 'EvalStmt' || t === 'IfStmt' || t === 'ReturnStmt' ||
                   t === 'BlockStmt' || t === 'FunctionStmt' || t === 'ProcedureStmt' ||
                   t === 'ImportStmt' || t === 'ExportStmt' || t === 'TypeStmt' ||
                   t === 'UnionTypeStmt';
    // Track compound expressions but NOT simple terminals
    const isCompoundExpr = t === 'CallExpr' || t === 'BinaryExpr' || t === 'AssignExpr' ||
                           t === 'IndexAssignExpr' || t === 'UnaryExpr' || t === 'TernaryExpr' ||
                           t === 'MatchExpr' || t === 'ComprehensionExpr' || t === 'GetExpr' ||
                           t === 'IndexExpr' || t === 'BlockExpr';
    // Skip: IntExpr, BoolExpr, StrExpr, CharExpr, IdentExpr, LiteralExpr, ListExpr,
    //        RecordExpr, DictExpr, LambdaExpr, GroupExpr
    if (isStmt || isCompoundExpr) {
      this._currentPos  = node.pos;
      this._currentNode = node;
      this._currentEnv  = env;
    }
  }

  /**
   * Wrap a raw Error into a PfunError with source context.
   * If the error is already a PfunError, re-throw it unchanged so the innermost
   * (most specific) location is preserved.
   */
  wrapError(err: unknown): PfunError {
    if (err instanceof PfunError) return err;
    const raw = err instanceof Error ? err : new Error(String(err));
    const envLookup = (name: string) => {
      try {
        const v = this._currentEnv ? this._currentEnv.get(name) : undefined;
        return v !== undefined ? this.force(v) : undefined;
      }
      catch { return undefined; }
    };
    return buildPfunError(raw, this.sourceText, this._currentPos, this._currentNode, envLookup, this);
  }

  getExports(): Map<string, any> { return this.exports; }

  /**
   * Check that `name` can be defined in `env` under the current rules:
   * - Never shadow a NativeFunction (anywhere in the chain, any scope).
   * - At global scope: never redefine an existing user name (let/var/function/proc).
   *   Exception: the REPL sets `allowGlobalRedef = true` to permit iteration.
   * - At local scope (inside a function/proc): shadowing user names is fine.
   */
  public allowGlobalRedef = false;

  private checkNameAvailable(name: string, env: Environment, kind: string): void {
    // Rule 1: never shadow a native function, anywhere
    if (env.isNative(name)) {
      throw new Error(
        `[Name] '${name}' is a built-in function and cannot be redefined. ` +
        `If you imported a module that defines '${name}', use a namespace import instead: ` +
        `import * as ModuleName from "module".`
      );
    }
    // Rule 2: at global scope, no redefinition of user names (unless REPL mode)
    if (env === this.globals && !this.allowGlobalRedef) {
      if (env.isDefinedLocally(name)) {
        throw new Error(`[Name] '${name}' is already defined in this scope and cannot be redefined.`);
      }
    }
  }

  // ─── Public Registry API ────────────────────────────────────────────────────

  /** Register a single native function by name. */
  registerFunction(entry: RegistryFunction): void {
    this.globals.define(entry.name, new NativeFunction(entry.fn, entry.arity ?? 0), false);
  }

  /** Register a plain record type or discriminated union type. */
  registerType(entry: RegistryType): void {
    if (entry.kind === 'plain') {
      this.types.registerPlain(entry.name, entry.fields, entry.generic ?? false);
    } else {
      this.types.registerUnion(entry.name, entry.variants, this.globals, entry.generic ?? false);
    }
  }

  /** Register a full library — all functions and types in one call. */
  registerLibrary(fns: RegistryFunction[], types: RegistryType[]): void {
    for (const t of types) this.registerType(t);
    for (const f of fns)   this.registerFunction(f);
  }

  // ─── Public Interpreter API ─────────────────────────────────────────────────

  interpret(statements: Stmt[], sourceText?: string) {
    if (sourceText !== undefined) this.sourceText = sourceText;
    for (const stmt of statements) {
      try {
        this.force(this.evaluateStmt(stmt, this.globals));
      } catch (e) {
        throw this.wrapError(e);
      }
    }
  }

  // ── Async/await (phase 4) ────────────────────────────────────────────────
  // interpretAsync() is the `await`-aware counterpart to interpret(): each
  // top-level statement is driven via runAsync, so a top-level `await`
  // (e.g. `eval await fetchUsers();`, or top-level `let`/`var` initializers
  // containing `await`) performs a real JS await rather than throwing
  // runSync's "yielded an Effect" error.
  //
  // interpret() (sync) remains for callers that know their program contains
  // no `await` — e.g. existing tests, and any embedding that wants a
  // synchronous result. Both share the same evaluateStmtGen/forceGen core;
  // the only difference is the driver (runSync vs runAsync).
  async interpretAsync(statements: Stmt[], sourceText?: string): Promise<void> {
    if (sourceText !== undefined) this.sourceText = sourceText;
    for (const stmt of statements) {
      try {
        await runAsync(this.evalAndForceGen(stmt, this.globals));
      } catch (e) {
        throw this.wrapError(e);
      }
    }
  }

  /**
   * Small helper generator: evaluateStmtGen then forceGen the result, as a
   * single Generator<Effect, ...> — used by interpretAsync so each top-level
   * statement is one runAsync() call (mirrors `this.force(this.evaluateStmt(...))`
   * in the sync interpret()).
   */
  private *evalAndForceGen(stmt: Stmt, env: Environment): Generator<Effect, any, any> {
    return yield* this.forceGen(yield* this.evaluateStmtGen(stmt, env));
  }

  getGlobal(name: string): any { return this.force(this.globals.get(name)); }

  /** Public accessor for the global environment — used by the REPL to evaluate
   *  top-level statements in the same scope across multiple inputs. */
  getGlobalsEnv(): Environment { return this.globals; }

  // ─── Statement Evaluation ───────────────────────────────────────────────────

  // ── Async/await (phase 2) ────────────────────────────────────────────────
  // evaluateStmt() is now a sync wrapper around evaluateStmtGen(). Same
  // signature/return as before — see runSync.
  evaluateStmt(stmt: Stmt, env: Environment): any {
    return runSync(this.evaluateStmtGen(stmt, env));
  }

  /**
   * Generator-core implementation of evaluateStmt(). Identical logic to the
   * original evaluateStmt(), with every recursive evaluator call (evaluateExpr,
   * evaluateStmt, force) delegated via `yield*` to its *Gen counterpart.
   */
  *evaluateStmtGen(stmt: Stmt, env: Environment): Generator<Effect, any, any> {
    this.trackPos(stmt, env);
    switch (stmt.type) {
      case 'LetStmt': {
        if (stmt.initializer.type === 'DictExpr') {
          throw new Error(`Dictionaries must be declared with 'var', not 'let'. Use: var ${stmt.name} = dict { ... }`);
        }
        if (stmt.initializer.type === 'ArrayExpr') {
          throw new Error(`Arrays must be declared with 'var', not 'let'. Use: var ${stmt.name} = array { ... }`);
        }
        // Guard mutable constructor calls (toDict, listToDict, makeBuffer, makeStringBuffer, etc.)
        // Unwrap a single layer of grouping parens before inspecting the call.
        const initExpr = stmt.initializer.type === 'GroupExpr'
          ? (stmt.initializer as any).expression
          : stmt.initializer;
        if (initExpr.type === 'CallExpr') {
          const callee = (initExpr as any).callee;
          const fnName = callee?.type === 'IdentExpr' ? callee.name : null;
          const DICT_CTORS   = new Set(['toDict','listToDict']);
          const BUFFER_CTORS = new Set(['makeBuffer','makeStringBuffer']);
          if (DICT_CTORS.has(fnName)) {
            throw new Error(`Dictionaries must be declared with 'var', not 'let'. Use: var ${stmt.name} = ${fnName}(...)`);
          }
          if (BUFFER_CTORS.has(fnName)) {
            throw new Error(`Buffers must be declared with 'var', not 'let'. Use: var ${stmt.name} = ${fnName}(...)`);
          }
        }
        this.checkNameAvailable(stmt.name, env, 'let');
        // Seed TypeRegistry from static type annotations on RecordExpr initializers
        // before wrapping in a Thunk — so a lazy binding doesn't bypass type checking
        // for a subsequent construction of the same type.
        this.seedFromExpr(stmt.initializer);
        // ── Async/await (phase 4): see containsAwait — `await`-containing
        // initializers must be evaluated eagerly, at the `let` statement,
        // since deferring to a later force() may happen from a sync context
        // that cannot suspend.
        if (this.containsAwait(stmt.initializer, env)) {
          const val = yield* this.forceGen(yield* this.evaluateExprGen(stmt.initializer, env));
          env.define(stmt.name, val, false);
          return;
        }
        env.define(stmt.name, new Thunk(stmt.initializer, env), false);
        return;
      }
      case 'VarStmt': {
        if (this.inPureContext) throw new Error("Functions cannot use 'var': side-effectful mutation is not allowed in pure functions. Use 'let' or convert to a procedure.");
        this.checkNameAvailable(stmt.name, env, 'var');
        const val = yield* this.forceGen(yield* this.evaluateExprGen(stmt.initializer, env));
        env.define(stmt.name, val, true);
        return;
      }
      case 'TypeStmt':
        this.types.registerPlain(stmt.name, stmt.fields, stmt.generic ?? false);
        return;
      case 'UnionTypeStmt':
        this.types.registerUnion(stmt.name, stmt.variants, this.globals, stmt.generic ?? false);
        return;
      case 'ExprStmt': return yield* this.evaluateExprGen(stmt.expression, env);
      case 'EvalStmt': return yield* this.forceGen(yield* this.evaluateExprGen(stmt.expression, env));
      case 'ExportStmt': {
        yield* this.evaluateStmtGen(stmt.declaration, env);
        const decl = stmt.declaration;
        if (decl.type === 'LetStmt') {
          // A let binding never changes after its own declaration, so a
          // snapshotted value is semantically identical to a live
          // reference — no Cell sharing needed.
          try { this.exports.set(decl.name, env.get(decl.name)); } catch {}
        } else if (decl.type === 'VarStmt') {
          // Export the var's ACTUAL Cell, not a snapshotted value — so a
          // later mutation to this var (from this module's own code, or
          // from another importer that also received this same Cell) is
          // visible to every holder of the reference, not just frozen at
          // the moment this export statement happened to run. See
          // Cell's docblock for the full rationale; see ImportStmt's
          // handling below for how an importer re-shares this Cell
          // rather than copying its value.
          try {
            const cell = env.getCell(decl.name);
            if (cell) this.exports.set(decl.name, { __varCell: cell });
          } catch {}
        } else if (decl.type === 'FunctionStmt' || decl.type === 'ProcedureStmt') {
          try { this.exports.set(decl.name, env.get(decl.name)); } catch {}
        } else if (decl.type === 'TypeStmt') {
          // Export as a RegistryType descriptor so the importer can re-register it
          const descriptor: RegistryType = { kind: 'plain', name: decl.name, fields: decl.fields, generic: decl.generic ?? false };
          this.exports.set(decl.name, { __registryType: descriptor });
        } else if (decl.type === 'UnionTypeStmt') {
          const descriptor: RegistryType = { kind: 'union', name: decl.name, variants: decl.variants, generic: decl.generic ?? false };
          this.exports.set(decl.name, { __registryType: descriptor });
          // Also export zero-field variant singletons (e.g. None)
          for (const v of decl.variants) {
            if (v.fields.length === 0) {
              try { this.exports.set(v.name, env.get(v.name)); } catch {}
            } else {
              this.exports.set(v.name, { __registryType: { kind: 'plain', name: v.name, fields: v.fields } });
            }
          }
        }
        return;
      }
      case 'ImportStmt': {
        const resolved = this.moduleLoader.resolve(stmt.path, this.baseDir);
        const moduleExports = this.moduleLoader.load(resolved);

        // Helper: bind one export entry into an environment
        const bindExport = (name: string, val: any, targetEnv: Environment, alias?: string) => {
          const bindName = alias ?? name;
          if (val && val.__builtinFn) {
            // Re-registering an already-registered native is idempotent (e.g. import * from "io"
            // after iolibFunctions were already registered directly). Only error if a *different*
            // native or user value occupies the name.
            if (targetEnv.isNative(bindName)) {
              // Already a native with this name — skip silently (idempotent re-import)
            } else if (targetEnv.isDefined(bindName)) {
              throw new Error(
                `[Name] '${bindName}' is already defined. ` +
                `Use a namespace import to avoid collisions: import * as ModuleName from "${stmt.path}".`
              );
            } else {
              this.registerFunction(val.__builtinFn);
            }
          } else if (val && val.__registryType) {
            this.registerType(val.__registryType);
          } else if (val && val.__varCell) {
            // Share the SAME Cell the exporting module's own `var`
            // actually uses — so a later mutation, from either side (the
            // exporter's own code, or any importer that also holds this
            // Cell), is visible to everyone, not frozen at export time.
            // See Cell's docblock in the Environment section above.
            this.checkNameAvailable(bindName, targetEnv, 'import');
            targetEnv.defineCell(bindName, val.__varCell, true);
          } else {
            // For zero-field union variant records (e.g. PgText, CmdNone), re-importing
            // the same value under the same name is idempotent — skip rather than throw.
            // This happens when module A defines a union, and modules B and C both import
            // A; when a program imports both B and C the variant names are seen twice.
            const isZeroFieldVariant = (
              val && typeof val === 'object' && val.__type && val.__union &&
              Object.keys(val).filter(k => k !== '__type' && k !== '__union').length === 0
            );
            if (isZeroFieldVariant && targetEnv.isDefinedLocally(bindName)) {
              // idempotent — already defined with the same zero-field variant
            } else {
              this.checkNameAvailable(bindName, targetEnv, 'import');
              targetEnv.define(bindName, val, false);
            }
          }
        };

        if (stmt.kind === 'star') {
          // import * from 'path' — all exports directly into current scope
          for (const [name, val] of moduleExports) bindExport(name, val, env);
        } else if (stmt.kind === 'namespace') {
          // import * as X from 'path' — all exports under alias object.
          // For a __varCell export, install a GETTER (and, since
          // namespace-qualified assignment like `X.counter = 5` is
          // already rejected elsewhere — see AssignExpr's "Invalid
          // assignment target" — no setter is needed) so `X.counter`
          // always reads the Cell's CURRENT value through GetExpr's
          // ordinary `obj[expr.name]` property read (interpreter.ts's
          // GetExpr case), rather than freezing whatever the value
          // happened to be at the moment this import ran.
          const ns: any = {};
          for (const [name, val] of moduleExports) {
            if (val && val.__builtinFn) ns[name] = val.__builtinFn.fn;
            else if (val && val.__registryType) { this.registerType(val.__registryType); }
            else if (val && val.__varCell) {
              const cell: Cell = val.__varCell;
              Object.defineProperty(ns, name, { enumerable: true, get: () => cell.value });
            }
            else ns[name] = val;
          }
          env.define(stmt.alias, ns, false);
        } else {
          // import { a, b as c } from 'path'
          for (const { name, alias } of stmt.names) {
            if (!moduleExports.has(name)) throw new Error(`Module '${stmt.path}' does not export '${name}'.`);
            bindExport(name, moduleExports.get(name), env, alias);
          }
        }
        return;
      }
      case 'BlockStmt': {
        const blockEnv = new Environment(env);
        let blockResult: any = undefined;
        const stmts = stmt.statements;
        for (let i = 0; i < stmts.length; i++) {
          if (i < stmts.length - 1) this.inTailPosition = false;
          blockResult = yield* this.evaluateStmtGen(stmts[i], blockEnv);
        }
        return blockResult;
      }
      case 'IfStmt': {
        const prevTail = this.inTailPosition;
        this.inTailPosition = false;
        const cond = yield* this.forceGen(yield* this.evaluateExprGen(stmt.condition, env));
        this.inTailPosition = prevTail;
        if (this.isTruthy(cond)) return yield* this.evaluateStmtGen(stmt.thenBranch, env);
        else if (stmt.elseBranch) return yield* this.evaluateStmtGen(stmt.elseBranch, env);
        return;
      }
      case 'WhileStmt': {
        if (this.inPureContext) throw new Error("'while' loops are not allowed in pure functions. Move the loop to a procedure.");
        this.inTailPosition = false;
        while (true) {
          const cond = yield* this.forceGen(yield* this.evaluateExprGen(stmt.condition, env));
          if (!this.isTruthy(cond)) break;
          const loopEnv = new Environment(env);
          for (const s of stmt.body) yield* this.evaluateStmtGen(s, loopEnv);
        }
        return;
      }
      case 'FunctionStmt':
        this.checkNameAvailable(stmt.name, env, 'function');
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'function', stmt.memo, stmt.async ?? false), false);
        return;
      case 'ProcedureStmt':
        this.checkNameAvailable(stmt.name, env, 'proc');
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'procedure', false, stmt.async ?? false), false);
        return;
      case 'ReturnStmt':
        throw new ReturnValue(stmt.value ? yield* this.evaluateExprGen(stmt.value, env) : undefined);
    }
  }

  // ─── Expression Evaluation ──────────────────────────────────────────────────

  // ── Async/await (phase 2) ────────────────────────────────────────────────
  // evaluateExpr() is now a sync wrapper around evaluateExprGen(). Same
  // signature/return as before — see runSync.
  evaluateExpr(expr: Expr, env: Environment): any {
    return runSync(this.evaluateExprGen(expr, env));
  }

  /**
   * Generator-core implementation of evaluateExpr(). Identical logic to the
   * original evaluateExpr(), with every recursive evaluator call (evaluateExpr,
   * evaluateStmt, evaluateBinary, evaluateMatch, evaluateRecord, force)
   * delegated via `yield*` to its *Gen counterpart.
   *
   * NOTE: AwaitExpr (added to the AST in phase 1) does not have a case here
   * yet — that's step 4. Evaluating an AwaitExpr-containing program will hit
   * the switch's implicit fallthrough (returns undefined) until then.
   */
  *evaluateExprGen(expr: Expr, env: Environment): Generator<Effect, any, any> {
    this.trackPos(expr, env);
    switch (expr.type) {
      case 'IntExpr':   return expr.value;
      case 'FloatExpr': return expr.value;
      case 'BoolExpr':  return expr.value;
      case 'StrExpr':   return expr.value;
      case 'CharExpr':  return new PfunChar(expr.value);
      case 'ByteExpr':  return new PfunByte(expr.value);
      case 'IdentExpr': return env.get(expr.name);
      case 'GroupExpr': return yield* this.evaluateExprGen(expr.expression, env);
      case 'UnaryExpr': {
        this.inTailPosition = false;
        const val = yield* this.forceGen(yield* this.evaluateExprGen(expr.right, env));
        if (expr.operator === 'BooleanNot') return !val;
        if (expr.operator === 'MinusToken') return -val;
        throw new Error(`Unknown unary operator ${expr.operator}`);
      }
      case 'BinaryExpr': { this.inTailPosition = false; return yield* this.evaluateBinaryGen(expr, env); }
      case 'TernaryExpr': {
        const prevTailTern = this.inTailPosition;
        this.inTailPosition = false;
        const cond = yield* this.forceGen(yield* this.evaluateExprGen(expr.condition, env));
        this.inTailPosition = prevTailTern;
        return this.isTruthy(cond)
          ? yield* this.evaluateExprGen(expr.thenBranch, env)
          : yield* this.evaluateExprGen(expr.elseBranch, env);
      }
      case 'AssignExpr': {
        this.inTailPosition = false;
        if (this.inPureContext) throw new Error("Functions cannot mutate 'var' bindings: side-effectful mutation is not allowed in pure functions. Use a procedure instead.");
        const val = yield* this.forceGen(yield* this.evaluateExprGen(expr.value, env));
        env.assign(expr.name, val);
        return val;
      }
      case 'LambdaExpr': {
        this.inTailPosition = false;
        const kind = (expr as any).isProc ? 'procedure' : 'function';
        return new PfunFunction(null, expr.params, expr.body, env, kind);
      }
      case 'ListExpr': {
        this.inTailPosition = false;
        const elements: any[] = [];
        for (const e of expr.elements) elements.push(yield* this.forceGen(yield* this.evaluateExprGen(e, env)));
        this.enforceListType(elements);
        return elements;
      }
      case 'ComprehensionExpr': {
        // The original implementation used a synchronous recursive closure
        // (evalGenerators) over nested `for` loops. Converted to an
        // equivalent generator-core recursive *generator* function so that
        // any `yield*` inside guard/source/body expressions propagates.
        const results: any[] = [];
        const evalGenerators = (genIndex: number, scopeEnv: Environment): Generator<Effect, void, any> => {
          const self = this;
          return (function* () {
            if (genIndex === expr.generators.length) {
              if (expr.guard) {
                const guardVal = yield* self.forceGen(yield* self.evaluateExprGen(expr.guard, scopeEnv));
                if (!self.isTruthy(guardVal)) return;
              }
              results.push(yield* self.forceGen(yield* self.evaluateExprGen(expr.body, scopeEnv)));
              return;
            }
            const gen = expr.generators[genIndex];
            const source = yield* self.forceGen(yield* self.evaluateExprGen(gen.source, scopeEnv));
            let items: any[];
            if (typeof source === 'string') {
              items = source.split('').map(c => new PfunChar(c));
            } else if (Array.isArray(source)) {
              items = source;
            } else if (source instanceof LazyList) {
              throw new Error(`Comprehension source must be a finite list. Use take() to make a lazy list finite.`);
            } else {
              throw new Error(`Comprehension source must be a list, got ${typeof source}.`);
            }
            for (const item of items) {
              const innerEnv = new Environment(scopeEnv);
              innerEnv.define(gen.variable, item, false);
              yield* evalGenerators(genIndex + 1, innerEnv);
            }
          })();
        };
        yield* evalGenerators(0, env);
        if (results.length > 0 && results.every((c: any) => c instanceof PfunChar)) {
          return results.map((c: PfunChar) => c.value).join('');
        }
        this.enforceListType(results);
        return results;
      }
      case 'RecordExpr':      return yield* this.evaluateRecordGen(expr, env);
      case 'DictExpr': {
        const map = new Map<string, any>();
        for (const entry of expr.entries) {
          const k = yield* this.forceGen(yield* this.evaluateExprGen(entry.key, env));
          const v = yield* this.forceGen(yield* this.evaluateExprGen(entry.value, env));
          map.set(PfunDict.keyOf(k), v);
        }
        return new PfunDict(map);
      }
      case 'ArrayExpr': {
        const elements: any[] = [];
        for (const e of expr.elements as any[]) elements.push(yield* this.forceGen(yield* this.evaluateExprGen(e, env)));
        const arr = new PfunArray(elements);
        if (elements.length > 0) {
          const firstType = getValueType(elements[0]);
          for (let i = 1; i < elements.length; i++) {
            const t = getValueType(elements[i]);
            if (t !== firstType) throw new Error(`Type mismatch in array: expected ${firstType}, got ${t}.`);
          }
          arr.elementType = firstType;
        }
        return arr;
      }
      case 'IndexExpr': {
        const obj = yield* this.forceGen(yield* this.evaluateExprGen(expr.object, env));
        const idx = yield* this.forceGen(yield* this.evaluateExprGen(expr.index, env));
        if (obj instanceof PfunDict) {
          const key = PfunDict.keyOf(idx);
          if (!obj.entries.has(key)) throw new Error(`Key not found in dict: ${this.stringify(idx)}`);
          return obj.entries.get(key);
        }
        if (obj instanceof PfunArray) {
          if (typeof idx !== 'bigint') throw new Error("Array index must be an integer.");
          const i = Number(idx);
          if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of bounds (length ${obj.elements.length}).`);
          return obj.elements[i];
        }
        if (Array.isArray(obj)) {
          if (typeof idx !== 'bigint') throw new Error("List index must be an integer.");
          const i = Number(idx);
          if (i < 0 || i >= obj.length) throw new Error(`List index ${i} out of bounds (length ${obj.length}).`);
          return obj[i];
        }
        throw new Error("Index operator requires a dict, array, or list.");
      }
      case 'IndexAssignExpr': {
        if (this.inPureContext) throw new Error("Functions cannot mutate arrays or dicts: side-effectful mutation is not allowed in pure functions. Use a procedure instead.");
        const obj = yield* this.forceGen(yield* this.evaluateExprGen(expr.object, env));
        if (obj instanceof PfunArray) {
          const idx = yield* this.forceGen(yield* this.evaluateExprGen(expr.index, env));
          if (typeof idx !== 'bigint') throw new Error("Array index must be an integer.");
          const i = Number(idx);
          if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of bounds (length ${obj.elements.length}).`);
          const val = yield* this.forceGen(yield* this.evaluateExprGen(expr.value, env));
          this.enforceArrayType(obj, val);
          obj.elements[i] = val;
          return val;
        }
        if (!(obj instanceof PfunDict)) throw new Error("Index assignment is only supported on dicts and arrays.");
        const idx = yield* this.forceGen(yield* this.evaluateExprGen(expr.index, env));
        const val = yield* this.forceGen(yield* this.evaluateExprGen(expr.value, env));
        obj.entries.set(PfunDict.keyOf(idx), val);
        return val;
      }
      case 'GetExpr': {
        const obj = yield* this.forceGen(yield* this.evaluateExprGen(expr.object, env));
        if (obj && typeof obj === 'object' && expr.name in obj) return obj[expr.name];
        throw new Error(`Property '${expr.name}' not found.`);
      }
      case 'CallExpr': {
        const callee = yield* this.forceGen(yield* this.evaluateExprGen(expr.callee, env));
        if (!(callee instanceof PfunFunction) && !(callee instanceof NativeFunction)) {
          throw new Error("Can only call functions.");
        }
        if (this.inPureContext && callee instanceof PfunFunction && callee.kind === 'procedure') {
          const name = callee.name ? `'${callee.name}'` : 'anonymous';
          throw new Error(`Functions cannot call procedures: ${name} is a procedure. Move the call to a procedure, or convert ${name} to a function.`);
        }

        // ── Currying: fewer args than expected → return a partial closure ──────
        if (callee instanceof PfunFunction) {
          const suppliedCount = expr.args.length;
          const expectedCount = callee.params.length;
          if (suppliedCount < expectedCount) {
            // Bind supplied args, return a new function expecting the rest
            const suppliedArgs: any[] = [];
            for (const arg of expr.args) suppliedArgs.push(yield* this.forceGen(yield* this.evaluateExprGen(arg, env)));
            const remainingParams = callee.params.slice(suppliedCount);
            const capturedParams  = callee.params.slice(0, suppliedCount);
            const partialEnv = new Environment(callee.closure);
            capturedParams.forEach((p, i) => partialEnv.define(p, suppliedArgs[i], false));
            return new PfunFunction(callee.name, remainingParams, callee.body, partialEnv, callee.kind, callee.memo, callee.async);
          }
        }

        if (callee instanceof NativeFunction && callee.arity > 0) {
          const suppliedCount = expr.args.length;
          if (suppliedCount < callee.arity) {
            // Wrap native in a PfunFunction closure carrying the supplied args
            const suppliedArgs: any[] = [];
            for (const arg of expr.args) suppliedArgs.push(yield* this.forceGen(yield* this.evaluateExprGen(arg, env)));
            const nativeFn = callee;
            const remainingParams = Array.from({ length: callee.arity - suppliedCount }, (_, i) => `__a${i}`);
            // Build a NativeFunction that prepends captured args before calling original
            const partialNative = new NativeFunction((newArgs, interp) => {
              return nativeFn.execute([...suppliedArgs, ...newArgs], interp);
            }, callee.arity - suppliedCount);
            return partialNative;
          }
        }

        // ── Async/await (phase 4) ────────────────────────────────────────
        // Any argument expression containing `await` must be evaluated
        // eagerly here (yield*), not wrapped in a Thunk — the same reasoning
        // as LetStmt (see containsAwait): a Thunk might later be forced via
        // the SYNC force()/runSync wrapper (e.g. inside a NativeFunction's
        // plain JS body, like println's `interp.force(args[0])`), which
        // cannot suspend. Eagerly-evaluated values are passed through
        // directly — force() on a non-Thunk/TailCall value is a no-op, so
        // natives' `interp.force(args[i])` calls work unchanged.
        const args: any[] = [];
        for (const arg of expr.args) {
          if (this.containsAwait(arg, env)) {
            args.push(yield* this.forceGen(yield* this.evaluateExprGen(arg, env)));
          } else {
            args.push(new Thunk(arg, env));
          }
        }
        if (callee instanceof NativeFunction) return callee.execute(args, this);

        if (callee.kind === 'function') {
          // Only use TailCall (iterative TCO) when this call is in tail position
          if (this.inPureContext && this.inTailPosition) {
            this.inTailPosition = false;
            const forcedArgsTail: any[] = [];
            for (const a of args) forcedArgsTail.push(yield* this.forceGen(a));
            return new TailCall(callee, forcedArgsTail);
          }
          const prevPure = this.inPureContext;
          const prevTail = this.inTailPosition;
          this.inTailPosition = false;
          const forcedArgs: any[] = [];
          for (const a of args) forcedArgs.push(yield* this.forceGen(a));
          if (callee.memo) {
            const cacheKey = this.getCacheKey(callee, forcedArgs);
            if (callee.cache.has(cacheKey)) { this.inTailPosition = prevTail; return callee.cache.get(cacheKey); }
            this.inPureContext = true;
            try {
              const result = yield* this.forceGen(yield* callee.executeGen(forcedArgs, this));
              callee.cache.set(cacheKey, result);
              return result;
            } finally {
              this.inPureContext = prevPure;
              this.inTailPosition = prevTail;
            }
          } else {
            this.inPureContext = true;
            try {
              return yield* this.forceGen(yield* callee.executeGen(forcedArgs, this));
            } finally {
              this.inPureContext = prevPure;
              this.inTailPosition = prevTail;
            }
          }
        }
        this.inTailPosition = false;
        return yield* callee.executeGen(args, this);
      }
      case 'MatchExpr': return yield* this.evaluateMatchGen(expr, env);
      case 'BlockExpr': {
        const blockEnv = new Environment(env);
        let result: any = undefined;
        const stmts = expr.statements;
        for (let i = 0; i < stmts.length; i++) {
          if (i < stmts.length - 1) this.inTailPosition = false;
          result = yield* this.evaluateStmtGen(stmts[i], blockEnv);
        }
        return result;
      }
      // ── Async/await (phase 4) ────────────────────────────────────────────
      // `await <value>`: force the operand. If it's a thenable (a real JS
      // Promise — the shape native async functions return, see step 6's
      // httplib/asynclib), yield {kind:'await', promise} and suspend. The
      // top-level driver (runAsync, below) does a real `await` on that
      // promise and resumes this generator with the resolved value via
      // `.next(resolvedValue)` — which becomes the result of this whole
      // `yield` expression, i.e. the value of the AwaitExpr.
      //
      // If the operand rejects, the driver resumes via `.throw(err)` instead
      // of `.next(...)`, so the rejection surfaces as a normal JS exception
      // at this `yield` — propagating through Pfun's existing error-handling
      // (wrapError/PfunError) exactly like a synchronous throw would.
      //
      // Non-promise values: `await 5` returns `5` immediately, no
      // suspension — matching JS's `await` semantics for non-thenables. This
      // also means `await` on a value from a SYNC driver (runSync) is fine
      // as long as the value is never actually a thenable; per the
      // typechecker's async-contagion rule (step 5), `await` only typechecks
      // inside an `async` function/proc, and an `async` function/proc must
      // be invoked through the async driver (runAsync) — so runSync should
      // never actually observe an AwaitExpr whose operand is a real promise.
      case 'AwaitExpr': {
        // ── Async/await (phase 5): async-contagion check ───────────────────
        // Mirrors the inPureContext checks on 'var'/procedure-calls/array
        // mutation: a RUNTIME error, thrown at the point `await` is
        // evaluated, if we're not inside an `async` function/proc (or at
        // top level). This is what makes `async` "contagious" — calling an
        // async function from a non-async one without `await`ing it would
        // itself be flagged via containsAwait's eager-evaluation path
        // (step 4) reaching this same check inside the callee's body.
        if (!this.inAsyncContext) {
          throw new Error("'await' can only be used inside an 'async function' or 'async proc'.");
        }
        this.inTailPosition = false;
        const awaited = yield* this.forceGen(yield* this.evaluateExprGen(expr.value, env));
        if (awaited && typeof awaited === 'object' && typeof (awaited as any).then === 'function') {
          const promise = Promise.resolve(awaited);
          // Mark the promise as "handled" immediately so Node doesn't report
          // an unhandledRejection between now (when we first see the
          // promise) and the moment runAsync's `await eff.promise` actually
          // observes a rejection. The no-op catch doesn't change what value
          // flows to runAsync — `promise` itself (still rejecting) is what
          // gets yielded and awaited there.
          promise.catch(() => {});
          return yield { kind: 'await', promise };
        }
        return awaited;
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Walk an expression and, for any RecordExpr nodes whose fields already carry
   * inferredType annotations (written by the typechecker), pre-seed the
   * TypeRegistry schema so that subsequent constructions of the same type are
   * type-checked even if this expression is never forced (lazy let binding).
   *
   * Only recurses into positions where a RecordExpr can plausibly appear at the
   * top level: grouping, ternary branches, and block last-expressions.
   */
  private seedFromExpr(expr: Expr): void {
    switch (expr.type) {
      case 'RecordExpr': {
        const namedType = expr.inferredType as PfunType | undefined;
        if (namedType && namedType.kind === 'Named') {
          const fieldTypes = expr.fields.map((f: any) => {
            const ft: PfunType | undefined = f.value?.inferredType;
            return ft ? pfunTypeToRuntimeType(ft) : null;
          });
          this.types.seedTypes(expr.name, fieldTypes, namedType.unionName);
        }
        break;
      }
      case 'GroupExpr':   this.seedFromExpr(expr.expression); break;
      case 'TernaryExpr': this.seedFromExpr(expr.thenBranch); this.seedFromExpr(expr.elseBranch); break;
      case 'BlockExpr': {
        const stmts = expr.statements;
        if (stmts.length > 0) {
          const last = stmts[stmts.length - 1];
          if (last.type === 'ExprStmt') this.seedFromExpr(last.expression);
        }
        break;
      }
      default: break;
    }
  }

  // ── Async/await (phase 4) ────────────────────────────────────────────────
  //
  // Laziness/await interaction: `let x = <expr>` normally wraps <expr> in a
  // Thunk, deferring evaluation until something forces `x`. But forcing can
  // happen from an arbitrary later context — including a native function's
  // synchronous JS body (e.g. println's `interp.force(args[0])`), which goes
  // through the SYNC `force()`/runSync wrapper and CANNOT suspend on
  // `await`.
  //
  // If <expr> contains `await` anywhere, the suspension must happen at the
  // `let` statement itself (where we're already inside the async generator
  // chain driven by runAsync), not deferred to whatever later, possibly-sync
  // context forces the binding. So: `let` initializers containing `await`
  // are evaluated EAGERLY (yield*, like `var`) rather than thunked.
  //
  // This mirrors how `await` works in every mainstream async/await
  // language — `let x = await foo()` is never lazy; the suspension point is
  // fixed at the binding. The typechecker's async-contagion rule (step 5)
  // additionally ensures `await` only appears inside `async` functions/procs,
  // which themselves can only be invoked through the async driver — so this
  // eager-evaluation path is always reached via runAsync, never runSync.
  //
  // Recurses into the same "top-level-ish" positions as seedFromExpr
  // (grouping, ternary branches, block last-expression) plus binary/unary/
  // call-argument positions, since `await` can appear in ordinary
  // sub-expression position (`1 + await f()`, `g(await f())`).
  //
  // ENV-AWARE: a `CallExpr` whose callee resolves (in `env`) to a
  // PfunFunction with `.async === true` is ALSO treated as "containing
  // await" — calling such a function inlines its body via yield*
  // delegation (see executeGen), and that body may itself `yield`
  // {kind:'await'}. `f()` therefore needs the same eager-evaluation
  // treatment as `await f()` when `f` is async: e.g. `println(f())` must
  // evaluate `f()` eagerly rather than thunk it, or println's sync
  // `interp.force(thunk)` would hit runSync's "yielded an Effect" error.
  // Lookup is best-effort: only a simple `IdentExpr` callee bound to a
  // PfunFunction is checked; failures (undefined name, non-function value,
  // etc.) are swallowed and treated as "not async" — those cases either
  // aren't callable at all (will error elsewhere) or are NativeFunctions
  // (never async in phase 4; see step 6 for async natives, which return
  // real Promises and are handled via the `awaited.then` check in
  // AwaitExpr/are simply not thunked-and-forced-by-natives in a way that
  // breaks, since natives returning Promises are values, not suspensions).
  private containsAwait(expr: Expr, env?: Environment): boolean {
    switch (expr.type) {
      case 'AwaitExpr': return true;
      case 'GroupExpr': return this.containsAwait(expr.expression, env);
      case 'TernaryExpr':
        return this.containsAwait(expr.condition, env) || this.containsAwait(expr.thenBranch, env) || this.containsAwait(expr.elseBranch, env);
      case 'BinaryExpr':
        return this.containsAwait(expr.left, env) || this.containsAwait(expr.right, env);
      case 'UnaryExpr': return this.containsAwait(expr.right, env);
      case 'AssignExpr': return this.containsAwait(expr.value, env);
      case 'CallExpr': {
        if (this.containsAwait(expr.callee, env) || expr.args.some(a => this.containsAwait(a, env))) return true;
        if (env && expr.callee.type === 'IdentExpr') {
          try {
            const callee = env.get(expr.callee.name);
            if (callee instanceof PfunFunction && callee.async) return true;
          } catch { /* undefined name — not our concern here */ }
        }
        return false;
      }
      case 'IndexExpr':
        return this.containsAwait(expr.object, env) || this.containsAwait(expr.index, env);
      case 'GetExpr': return this.containsAwait(expr.object, env);
      case 'ListExpr': return expr.elements.some(e => this.containsAwait(e, env));
      case 'BlockExpr': {
        const stmts = expr.statements;
        if (stmts.length === 0) return false;
        const last = stmts[stmts.length - 1];
        return last.type === 'ExprStmt' && this.containsAwait(last.expression, env);
      }
      // Lambdas/records/dicts/arrays/match/comprehensions: `await` inside a
      // lambda body belongs to whenever the lambda is *called*, not to this
      // binding — don't recurse into LambdaExpr. RecordExpr/DictExpr/
      // ArrayExpr/MatchExpr/ComprehensionExpr fields/arms could in principle
      // contain `await`, but those are richer constructs where lazy
      // construction is more central to Pfun's model; treating `await`
      // inside them as "doesn't force eager evaluation of the whole let" is
      // conservative in the wrong direction for correctness. For phase 4,
      // these are out of scope (no test programs use them) — the
      // typechecker (step 5) is the right place to either restrict `await`
      // from appearing in these positions or to extend this check.
      default: return false;
    }
  }

  // ── Async/await (phase 2): sync wrapper, see runSync ─────────────────────
  private evaluateRecord(expr: any, env: Environment): any {
    return runSync(this.evaluateRecordGen(expr, env));
  }

  private *evaluateRecordGen(expr: any, env: Environment): Generator<Effect, any, any> {
    // If the typechecker annotated this RecordExpr with field types, seed the
    // TypeRegistry before the first instantiate() so that lazy `let` bindings
    // of an earlier construction don't bypass type checking for this one.
    if (expr.inferredType) {
      const namedType = expr.inferredType as PfunType;
      if (namedType.kind === 'Named') {
        // The fields on the Named type don't carry field-level types; we need
        // the field annotations from the expr itself if present, or we fall back
        // to seeding from the RecordExpr's fields' own inferredTypes.
        const fieldTypes = expr.fields.map((f: any) => {
          const ft: PfunType | undefined = f.value?.inferredType;
          return ft ? pfunTypeToRuntimeType(ft) : null;
        });
        this.types.seedTypes(expr.name, fieldTypes, namedType.unionName);
      }
    }

    if (expr.fields.length > 0 && expr.fields[0].key !== null) {
      const schema = this.types.getFields(expr.name);
      if (schema.length === 0) throw new Error(`Unknown type '${expr.name}'.`);
      const byKey: any = {};
      for (const f of expr.fields) byKey[f.key] = yield* this.forceGen(yield* this.evaluateExprGen(f.value, env));
      const ordered = schema.map(f => {
        if (!(f in byKey)) throw new Error(`Missing field '${f}' in ${expr.name}.`);
        return byKey[f];
      });
      return this.types.instantiate(expr.name, ordered);
    }
    if (this.types.hasType(expr.name)) {
      const orderedValues: any[] = [];
      for (const f of expr.fields as any[]) orderedValues.push(yield* this.forceGen(yield* this.evaluateExprGen(f.value, env)));
      return this.types.instantiate(expr.name, orderedValues);
    }
    throw new Error(`Unknown type '${expr.name}'.`);
  }

  // ── Async/await (phase 2): sync wrapper, see runSync ─────────────────────
  private evaluateMatch(expr: any, env: Environment): any {
    return runSync(this.evaluateMatchGen(expr, env));
  }

  private *evaluateMatchGen(expr: any, env: Environment): Generator<Effect, any, any> {
    const prevTail     = this.inTailPosition;
    this.inTailPosition = false;
    const subject     = yield* this.forceGen(yield* this.evaluateExprGen(expr.subject, env));
    const subjectType = subject?.__type ?? null;
    const subjectUnion = subject?.__union ?? null;
    // Use the subject's __union to disambiguate when variant names are shared
    const unionName   = subjectType ? this.types.unionOf(subjectType, subjectUnion) : null;
    const hasWildcard = expr.arms.some((a: any) => a.variant === null);

    if (!hasWildcard && unionName) {
      const variants    = this.types.variantsOf(unionName)!;
      const covered     = new Set(expr.arms.map((a: any) => a.variant).filter(Boolean));
      const missing     = [...variants].filter(v => !covered.has(v));
      if (missing.length > 0) throw new Error(`Non-exhaustive match on '${unionName}': missing arm(s) for ${missing.map(v => `'${v}'`).join(', ')}.`);
    }

    for (const arm of expr.arms) {
      if (arm.variant !== null && arm.variant !== subjectType) continue;
      const armEnv = new Environment(env);
      if (arm.binding !== null) armEnv.define(arm.binding, subject, false);
      if (arm.guard) {
        this.inTailPosition = false;
        const guardVal = yield* this.forceGen(yield* this.evaluateExprGen(arm.guard, armEnv));
        if (!this.isTruthy(guardVal)) continue;
      }
      this.inTailPosition = prevTail;
      return yield* this.evaluateExprGen(arm.body, armEnv);
    }
    throw new Error(`Non-exhaustive match: no arm matched value of type '${subjectType ?? 'unknown'}'.`);
  }

  // ── Async/await (phase 2): sync wrapper, see runSync ─────────────────────
  private evaluateBinary(expr: any, env: Environment): any {
    return runSync(this.evaluateBinaryGen(expr, env));
  }

  private *evaluateBinaryGen(expr: any, env: Environment): Generator<Effect, any, any> {
    if (expr.operator === 'BooleanAnd') {
      const left = yield* this.forceGen(yield* this.evaluateExprGen(expr.left, env));
      if (!this.isTruthy(left)) return false;
      return this.isTruthy(yield* this.forceGen(yield* this.evaluateExprGen(expr.right, env)));
    }
    if (expr.operator === 'BooleanOr') {
      const left = yield* this.forceGen(yield* this.evaluateExprGen(expr.left, env));
      if (this.isTruthy(left)) return true;
      return this.isTruthy(yield* this.forceGen(yield* this.evaluateExprGen(expr.right, env)));
    }
    const left  = yield* this.forceGen(yield* this.evaluateExprGen(expr.left, env));
    const right = yield* this.forceGen(yield* this.evaluateExprGen(expr.right, env));

    // ── Byte arithmetic ───────────────────────────────────────────────────────
    // Byte+Byte arithmetic produces a Byte (range-checked, errors on overflow).
    if (left instanceof PfunByte && right instanceof PfunByte) {
      const checkByte = (n: number, op: string): PfunByte => {
        if (n < 0 || n > 255) throw new Error(`Byte overflow: ${op} produced ${n}, which is out of range (0–255).`);
        return new PfunByte(n);
      };
      switch (expr.operator) {
        case 'PlusToken':    return checkByte(left.value + right.value, '+');
        case 'MinusToken':   return checkByte(left.value - right.value, '-');
        case 'StarToken':    return checkByte(left.value * right.value, '*');
        case 'SlashToken':
          if (right.value === 0) throw new Error('Divide by zero.');
          return checkByte(Math.trunc(left.value / right.value), '/');
        case 'PercentToken':
          if (right.value === 0) throw new Error('Divide by zero (modulo by zero).');
          return checkByte(left.value % right.value, '%');
        case 'EqualToken':        return left.value === right.value;
        case 'NotEqualToken':     return left.value !== right.value;
        case 'GreaterToken':      return left.value >  right.value;
        case 'LessToken':         return left.value <  right.value;
        case 'GreaterEqualToken': return left.value >= right.value;
        case 'LessEqualToken':    return left.value <= right.value;
      }
    }

    // ── List concatenation via + ──────────────────────────────────────────────
    if (expr.operator === 'PlusToken') {
      if (Array.isArray(left) && Array.isArray(right)) {
        const lCL = left.length  > 0 && left.every((c: any)  => c instanceof PfunChar);
        const rCL = right.length > 0 && right.every((c: any) => c instanceof PfunChar);
        // Both char lists → string concat; both non-char lists → list concat;
        // mixed or either empty → defer to string path only if either is a
        // non-empty char list, otherwise list concat.
        if (lCL && rCL) return this.stringify(left) + this.stringify(right);
        if (lCL)        return this.stringify(left) + this.stringify(right);
        if (rCL)        return this.stringify(left) + this.stringify(right);
        return [...left, ...right];
      }
    }

    // ── String / char concatenation via + ────────────────────────────────────
    if (expr.operator === 'PlusToken') {
      const lStr = typeof left === 'string', rStr = typeof right === 'string';
      const lChar = left instanceof PfunChar, rChar = right instanceof PfunChar;
      const lCL = Array.isArray(left)  && left.length > 0 && left.every((c: any)  => c instanceof PfunChar);
      const rCL = Array.isArray(right) && right.length > 0 && right.every((c: any) => c instanceof PfunChar);
      if (lStr || lChar || lCL || rStr || rChar || rCL) return this.stringify(left) + this.stringify(right);
    }

    // ── Numeric helpers ───────────────────────────────────────────────────────
    const lIsFloat = typeof left  === 'number';
    const rIsFloat = typeof right === 'number';
    const mixed    = lIsFloat || rIsFloat;

    // Promote both sides to number for mixed or float-only arithmetic
    const ln = mixed ? (typeof left  === 'bigint' ? Number(left)  : left  as number) : left;
    const rn = mixed ? (typeof right === 'bigint' ? Number(right) : right as number) : right;

    // Helper: check float result is finite (no NaN / Infinity)
    const checkFloat = (result: number, op: string): number => {
      if (!isFinite(result) || isNaN(result))
        throw new Error(`Float domain error: ${op} produced ${isNaN(result) ? 'NaN' : 'Infinity'}.`);
      return result;
    };

    switch (expr.operator) {
      case 'PlusToken':
        return mixed
          ? checkFloat((ln as number) + (rn as number), '+')
          : (left as bigint) + (right as bigint);

      case 'MinusToken':
        return mixed
          ? checkFloat((ln as number) - (rn as number), '-')
          : (left as bigint) - (right as bigint);

      case 'StarToken':
        return mixed
          ? checkFloat((ln as number) * (rn as number), '*')
          : (left as bigint) * (right as bigint);

      case 'SlashToken':
        if (mixed) return checkFloat((ln as number) / (rn as number), '/');
        if ((right as bigint) === 0n) throw new Error('Divide by zero.');
        return (left as bigint) / (right as bigint);

      case 'PercentToken':
        if (lIsFloat || rIsFloat)
          throw new Error('% requires integer operands. Use floats with fmod() from mathlib.');
        if ((right as bigint) === 0n) throw new Error('Divide by zero (modulo by zero).');
        return (left as bigint) % (right as bigint);

      case 'EqualToken': {
        if (left instanceof PfunChar && right instanceof PfunChar) return left.value === right.value;
        if (left instanceof PfunChar || right instanceof PfunChar) return false;
        // Allow cross-type numeric equality: 1 == 1.0 is true
        if (mixed) return (ln as number) === (rn as number);
        return left === right;
      }
      case 'NotEqualToken': {
        if (left instanceof PfunChar && right instanceof PfunChar) return left.value !== right.value;
        if (left instanceof PfunChar || right instanceof PfunChar) return true;
        if (mixed) return (ln as number) !== (rn as number);
        return left !== right;
      }

      // Comparisons: promote bigint to number when mixed
      case 'GreaterToken':      return mixed ? (ln as number) >  (rn as number) : left >  right;
      case 'LessToken':         return mixed ? (ln as number) <  (rn as number) : left <  right;
      case 'GreaterEqualToken': return mixed ? (ln as number) >= (rn as number) : left >= right;
      case 'LessEqualToken':    return mixed ? (ln as number) <= (rn as number) : left <= right;

      // ── Bitwise operators ──────────────────────────────────────────────────
      // Byte operands: results masked to 0–255; shifts mask shift amount to 7.
      // Int operands: full bigint bitwise semantics, no masking.
      // Mixed Byte+Int: not permitted — types must match.
      case 'BitAndToken': {
        if (left instanceof PfunByte && right instanceof PfunByte)
          return new PfunByte((left.value & right.value) & 0xFF);
        if (typeof left === 'bigint' && typeof right === 'bigint')
          return left & right;
        throw new Error(`Operator & requires both operands to be Byte or both to be Int, got ${getValueType(left)} and ${getValueType(right)}.`);
      }
      case 'BitOrToken': {
        if (left instanceof PfunByte && right instanceof PfunByte)
          return new PfunByte((left.value | right.value) & 0xFF);
        if (typeof left === 'bigint' && typeof right === 'bigint')
          return left | right;
        throw new Error(`Operator | requires both operands to be Byte or both to be Int, got ${getValueType(left)} and ${getValueType(right)}.`);
      }
      case 'ShiftLeftToken': {
        if (left instanceof PfunByte) {
          const shift = typeof right === 'bigint' ? Number(right) : (right instanceof PfunByte ? right.value : -1);
          if (shift < 0) throw new Error(`<< shift amount must be a non-negative Int or Byte.`);
          return new PfunByte((left.value << (shift & 7)) & 0xFF);
        }
        if (typeof left === 'bigint') {
          const shift = typeof right === 'bigint' ? right : (right instanceof PfunByte ? BigInt(right.value) : null);
          if (shift === null || shift < 0n) throw new Error(`<< shift amount must be a non-negative Int or Byte.`);
          return left << shift;
        }
        throw new Error(`Operator << requires a Byte or Int left operand, got ${getValueType(left)}.`);
      }
      case 'ShiftRightToken': {
        if (left instanceof PfunByte) {
          const shift = typeof right === 'bigint' ? Number(right) : (right instanceof PfunByte ? right.value : -1);
          if (shift < 0) throw new Error(`>> shift amount must be a non-negative Int or Byte.`);
          return new PfunByte((left.value >>> (shift & 7)) & 0xFF);
        }
        if (typeof left === 'bigint') {
          const shift = typeof right === 'bigint' ? right : (right instanceof PfunByte ? BigInt(right.value) : null);
          if (shift === null || shift < 0n) throw new Error(`>> shift amount must be a non-negative Int or Byte.`);
          return left >> shift;
        }
        throw new Error(`Operator >> requires a Byte or Int left operand, got ${getValueType(left)}.`);
      }

      default: throw new Error(`Unknown binary operator ${expr.operator}`);
    }
  }

  // ── Async/await (phase 2) ────────────────────────────────────────────────
  // force() is now a sync wrapper around forceGen(). Same signature/return
  // as before — see runSync. This is the most heavily-used sync wrapper:
  // ~111 call sites across library.ts/mathlib.ts/iolib.ts/jsonlib.ts/
  // filelib.ts/mutStructures.ts call interp.force(...) unchanged.
  force(value: any): any {
    return runSync(this.forceGen(value));
  }

  /**
   * Generator-core implementation of force(). Identical logic to the
   * original force(), with the recursive evaluateExpr/trampoline calls
   * delegated via `yield*`.
   */
  *forceGen(value: any): Generator<Effect, any, any> {
    let current = value;
    while (true) {
      if (current instanceof Thunk) {
        // Save and restore position tracking around thunk evaluation so that
        // lazily forcing a 'let' binding doesn't clobber the position of
        // the expression that triggered the force.
        const savedPos  = this._currentPos;
        const savedNode = this._currentNode;
        const savedEnv  = this._currentEnv;
        current = yield* this.evaluateExprGen(current.expr, current.env);
        this._currentPos  = savedPos;
        this._currentNode = savedNode;
        this._currentEnv  = savedEnv;
      }
      else if (current instanceof TailCall) current = yield* this.trampolineGen(current.fn, current.args);
      else return current;
    }
  }

  // ── Async/await (phase 2): sync wrapper, see runSync ─────────────────────
  private trampoline(fn: PfunFunction, args: any[]): any {
    return runSync(this.trampolineGen(fn, args));
  }

  private *trampolineGen(fn: PfunFunction, args: any[]): Generator<Effect, any, any> {
    let currentFn   = fn;
    let currentArgs: any[] = [];
    for (const a of args) currentArgs.push(yield* this.forceGen(a));
    const callStack: { fn: PfunFunction; args: any[]; key: string }[] = [];
    const prevPure  = this.inPureContext;
    if (currentFn.kind === 'function') this.inPureContext = true;
    try {
      while (true) {
        if (currentFn.memo) {
          const cacheKey = this.getCacheKey(currentFn, currentArgs);
          if (currentFn.cache.has(cacheKey)) {
            const result = currentFn.cache.get(cacheKey);
            while (callStack.length > 0) { const p = callStack.pop()!; if (p.fn.memo) p.fn.cache.set(p.key, result); }
            return result;
          }
          callStack.push({ fn: currentFn, args: currentArgs, key: cacheKey });
        }
        const result = yield* currentFn.executeGen(currentArgs, this);
        if (result instanceof TailCall) {
          this.inPureContext = result.fn.kind === 'function';
          currentFn   = result.fn;
          const nextArgs: any[] = [];
          for (const a of result.args) nextArgs.push(yield* this.forceGen(a));
          currentArgs = nextArgs;
          continue;
        }
        const finalResult = yield* this.forceGen(result);
        while (callStack.length > 0) { const p = callStack.pop()!; if (p.fn.memo) p.fn.cache.set(p.key, finalResult); }
        return finalResult;
      }
    } finally { this.inPureContext = prevPure; }
  }

  // ── Async/await (phase 3): unified Effect protocol ───────────────────────
  // makeGenerator now yields `Effect` values rather than raw lazy-list
  // elements:
  //   - {kind: 'emit', value}  — "here is the next lazy-list element"
  //     (the step-2-era meaning of a bare `yield element`)
  //   - {kind: 'await', promise} — (step 4+) a map/filter/iterate callback
  //     hit an `await`; must bubble all the way to the top-level driver.
  //
  // 'emit' effects are consumed locally by whichever loop is iterating a
  // sub-generator (the `cycle`/`map`/`filter`/`drop`/`cons` cases below, and
  // takeFrom itself); 'await' effects are forwarded untouched via `yield`
  // (this function is itself a generator, so an un-handled yielded value
  // propagates to ITS caller the same way `yield*` would for a delegated
  // generator — see the `forwardAwait` helper).
  //
  // takeFrom() is the sync wrapper (see runSync): correct as long as no
  // 'await' effect is ever produced from a sync calling context, per the
  // typechecker's async-contagion rule (step 5). A future async-aware
  // consumer (e.g. an async lazy-list fold) would drive takeFromGen()
  // directly and handle 'await' effects via the real top-level driver.
  takeFrom(list: LazyList, n: number): any[] {
    return runSync(this.takeFromGen(list, n));
  }

  *takeFromGen(list: LazyList, n: number): Generator<Effect, any[], any> {
    const results: any[] = [];
    const gen = this.makeGeneratorGen(list.descriptor);
    let step = gen.next();
    while (results.length < n && !step.done) {
      const eff = step.value;
      if (eff.kind === 'emit') {
        results.push(eff.value);
        step = gen.next();
      } else {
        // eff.kind === 'await': forward to our caller; resume gen with
        // whatever value comes back, then re-check the new step.
        const resumed = yield eff;
        step = gen.next(resumed);
      }
    }
    return results;
  }

  /**
   * Generator-core lazy-list element producer. Yields `Effect` values (see
   * above): {kind:'emit', value} for each lazy-list element, {kind:'await',
   * promise} if a map/filter/iterate callback suspends.
   *
   * Helper note: `forward()` drives an inner makeGeneratorGen, yielding any
   * 'await' effects upward (via plain `yield`, with the resumed value sent
   * back into the inner generator) and returning the inner generator's next
   * 'emit' value (or undefined if the inner generator is done).
   */
  private *makeGeneratorGen(desc: LazyListDescriptor): Generator<Effect, void, any> {
    // Drive `inner` to its next 'emit', forwarding any 'await' effects to
    // our own caller. Returns {value, done}.
    function* nextEmit(inner: Generator<Effect, void, any>): Generator<Effect, { value: any; done: boolean }, any> {
      let step = inner.next();
      while (!step.done) {
        const eff = step.value;
        if (eff.kind === 'emit') return { value: eff.value, done: false };
        // eff.kind === 'await': forward to our caller, resume inner with
        // whatever value comes back.
        const resumed = yield eff;
        step = inner.next(resumed);
      }
      return { value: undefined, done: true };
    }

    switch (desc.kind) {
      case 'iterate': {
        let cur = desc.seed;
        while (true) {
          yield { kind: 'emit', value: cur };
          const callResult = yield* this.forceGen(yield* desc.f.executeGen([cur], this));
          cur = callResult;
        }
      }
      case 'repeat':  { while (true) yield { kind: 'emit', value: desc.value }; }
      case 'cycle': {
        const src = desc.source;
        if (Array.isArray(src)) {
          if (src.length === 0) return;
          let i = 0; while (true) { yield { kind: 'emit', value: src[i % src.length] }; i++; }
        } else if (src instanceof LazyList) {
          // NOTE: every LazyList reachable from Pfun source (iterate/repeat/
          // cycle/map/filter/drop/cons, recursively) is either infinite or
          // an immediately-empty cycle — there is no way to construct a
          // finite-but-nonempty LazyList via the public API. This buffering
          // loop therefore cannot terminate for any real LazyList and is
          // effectively unreachable; preserved as-is from the original
          // (which had the identical non-terminating behavior) rather than
          // removed, in case a future LazyListDescriptor variant produces a
          // genuinely finite LazyList.
          const buf: any[] = [];
          const inner = this.makeGeneratorGen(src.descriptor);
          while (true) {
            const { value, done } = yield* nextEmit(inner);
            if (done) break;
            buf.push(value);
            yield { kind: 'emit', value };
          }
          if (buf.length === 0) return;
          let i = 0; while (true) { yield { kind: 'emit', value: buf[i % buf.length] }; i++; }
        }
        break;
      }
      case 'map': {
        const inner = this.makeGeneratorGen(desc.source.descriptor);
        while (true) {
          const { value, done } = yield* nextEmit(inner);
          if (done) break;
          const mapped = yield* this.forceGen(yield* desc.f.executeGen([value], this));
          yield { kind: 'emit', value: mapped };
        }
        break;
      }
      case 'filter': {
        const inner = this.makeGeneratorGen(desc.source.descriptor);
        while (true) {
          const { value, done } = yield* nextEmit(inner);
          if (done) break;
          const keep = yield* this.forceGen(yield* desc.f.executeGen([value], this));
          if (this.isTruthy(keep)) yield { kind: 'emit', value };
        }
        break;
      }
      case 'cons': {
        yield { kind: 'emit', value: desc.head };
        const t = desc.tail;
        if (t instanceof LazyList) yield* this.makeGeneratorGen(t.descriptor);
        else if (Array.isArray(t)) { for (const v of t) yield { kind: 'emit', value: v }; }
        break;
      }
      case 'drop': {
        const inner = this.makeGeneratorGen(desc.source.descriptor);
        let skipped = 0;
        while (skipped < desc.n) {
          const { done } = yield* nextEmit(inner);
          if (done) return;
          skipped++;
        }
        while (true) {
          const { value, done } = yield* nextEmit(inner);
          if (done) break;
          yield { kind: 'emit', value };
        }
        break;
      }
    }
  }

  private getCacheKey(fn: PfunFunction, args: any[]): string {
    return JSON.stringify(args, (_, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (typeof v === 'number') return 'f:' + v.toString();
      return v;
    });
  }

  isTruthy(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number')  return value !== 0;
    if (typeof value === 'bigint')  return value !== 0n;
    if (typeof value === 'string')  return value !== '';
    if (value instanceof PfunByte)  return value.value !== 0;
    return true;
  }

  stringify(value: any): string {
    if (value === null || value === undefined) return 'nil';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint')  return value.toString();
    if (typeof value === 'number') {
      // Always include a decimal point so floats are visually distinct from ints
      if (Number.isInteger(value)) return value.toFixed(1);
      return value.toString();
    }
    if (value instanceof PfunChar)  return value.value;
    if (value instanceof PfunByte)  return value.value.toString();
    if (value instanceof LazyList)  return '<lazylist>';
    if (value instanceof PfunDict) {
      const entries = [...value.entries.entries()].map(([k, v]) => `${k.slice(2)} -> ${this.stringify(v)}`);
      return `dict { ${entries.join(', ')} }`;
    }
    if (value instanceof PfunArray) {
      return `array { ${value.elements.map((v: any) => this.stringify(v)).join(', ')} }`;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every((c: any) => c instanceof PfunChar)) return value.map((c: PfunChar) => c.value).join('');
      return `[${value.map((v: any) => this.stringify(v)).join(', ')}]`;
    }
    if (value && value.__type) {
      const fields = Object.keys(value).filter(k => k !== '__type' && k !== '__union');
      if (fields.length === 0) return value.__type;
      return `${value.__type} { ${fields.map(f => this.stringify(value[f])).join(', ')} }`;
    }
    return String(value);
  }

  enforceArrayType(arr: PfunArray, value: any): void {
    const t = getValueType(value);
    if (arr.elementType === null) {
      arr.elementType = t;
    } else if (t !== arr.elementType) {
      throw new Error(`Type mismatch in array: expected ${arr.elementType}, got ${t}.`);
    }
  }

  enforceListType(elements: any[]): void {
    const schemas = (this as any).types?.schemas as Map<string, any[]> | undefined;
    if (elements.length > 0) {
      const firstType = getValueType(elements[0], schemas);
      for (let i = 1; i < elements.length; i++) {
        const currentType = getValueType(elements[i], schemas);
        if (currentType === firstType) continue;
        // An empty list [] is compatible with any list<T>
        if (currentType === 'list' && firstType.startsWith('list')) continue;
        if (firstType === 'list' && currentType.startsWith('list')) continue;
        throw new Error(`Type mismatch in list: expected ${firstType}, got ${currentType}.`);
      }
    }
  }

  toArray(value: any): any[] {
    if (typeof value === 'string') return value.split('').map(c => new PfunChar(c));
    if (Array.isArray(value)) return value;
    if (value instanceof PfunArray) return value.elements;
    if (value instanceof LazyList) throw new Error("find/findSlice cannot search an infinite list. Use take() first.");
    throw new Error(`find/findSlice requires a list, array, or string, got ${typeof value}.`);
  }

  valEqual(a: any, b: any): boolean {
    a = this.force(a); b = this.force(b);
    if (a instanceof PfunByte && b instanceof PfunByte) return a.value === b.value;
    if (a instanceof PfunByte || b instanceof PfunByte) return false;
    if (a instanceof PfunChar && b instanceof PfunChar) return a.value === b.value;
    if (a instanceof PfunChar || b instanceof PfunChar) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.valEqual(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && a.__type && b.__type) {
      if (a.__type !== b.__type) return false;
      const keys = Object.keys(a).filter(k => k !== '__type' && k !== '__union');
      return keys.every(k => this.valEqual(a[k], b[k]));
    }
    return a === b;
  }
}

// ── Async/await (phase 6): Scheduler ────────────────────────────────────────
//
// A Scheduler runs multiple "tasks" — each task is a Generator<Effect, T, any>
// (typically produced by interpreter.evalAndForceGenPublic or a request
// handler's executeGen) — concurrently on ONE shared Interpreter instance.
//
// Concurrency model: cooperative, single-threaded. At any instant only one
// task's JS code is actually running; tasks interleave only at `await`
// points (yielded {kind:'await'} Effects). This is the same model as JS
// async/await itself — Scheduler is just making that explicit for Pfun's
// generator-core.
//
// Per-task context isolation (the "step 6 per-frame fix"):
// inPureContext/inTailPosition/inAsyncContext remain instance fields on
// Interpreter (read directly by native functions like println via
// `interp.inPureContext` — see mutStructures/iolib/filelib). Within a
// SINGLE task's yield* chain, mutations to these fields by one frame and
// restoration by an enclosing frame are already correctly ordered (proven
// in step 4). The risk step 6 introduces is a DIFFERENT task's code running
// — via a `.then()` callback — while this task is parked at a `yield`, which
// would mutate these shared fields out from under the parked task.
//
// Fix: the Scheduler snapshots these three fields into a per-task
// `TaskContext` immediately before resuming that task (gen.next/gen.throw),
// and snapshots them back from the Interpreter immediately after that
// resumption returns (whether by yielding again or completing) — i.e. each
// task's slice of wall-clock execution runs with ITS OWN values installed on
// the Interpreter, and the Interpreter's fields are saved/restored around
// that slice exactly as if each task had its own Interpreter. No changes to
// any *Gen method are needed — they continue reading/writing
// this.inPureContext etc. as before; the Scheduler just swaps the values
// in and out between tasks.
export interface TaskContext {
  inPureContext:  boolean;
  inTailPosition: boolean;
  inAsyncContext: boolean;
}

export type TaskErrorHandler = (err: unknown) => void;

export class Scheduler {
  private pending = 0;
  private resolveRun?: () => void;
  private defaultOnError?: TaskErrorHandler;

  constructor(private interp: Interpreter) {}

  /** Set a default error handler for tasks spawned without their own. */
  setDefaultErrorHandler(handler: TaskErrorHandler): void {
    this.defaultOnError = handler;
  }

  /**
   * Start running `gen` as a new task. Returns immediately — the task runs
   * (and interleaves with other tasks) as `await` points are reached.
   *
   * If the task throws/rejects without completing (an uncaught error), it
   * is reported via `onError` (or the scheduler's default handler, if set)
   * rather than rejecting `run()` — one failing task (e.g. one HTTP request
   * handler) does not take down the scheduler or other in-flight tasks.
   */
  spawn<T>(gen: Generator<Effect, T, any>, onError?: TaskErrorHandler): void {
    this.pending++;
    const ctx: TaskContext = {
      inPureContext:  this.interp.inPureContext,
      inTailPosition: this.interp.inTailPosition,
      inAsyncContext: this.interp.inAsyncContext,
    };

    const installContext = () => {
      this.interp.inPureContext  = ctx.inPureContext;
      this.interp.inTailPosition = ctx.inTailPosition;
      this.interp.inAsyncContext = ctx.inAsyncContext;
    };
    const saveContext = () => {
      ctx.inPureContext  = this.interp.inPureContext;
      ctx.inTailPosition = this.interp.inTailPosition;
      ctx.inAsyncContext = this.interp.inAsyncContext;
    };

    const step = (input?: any, isThrow?: boolean) => {
      installContext();
      let result: IteratorResult<Effect, T>;
      try {
        result = isThrow ? gen.throw(input) : gen.next(input);
      } catch (err) {
        this.taskDone();
        (onError ?? this.defaultOnError)?.(err);
        return;
      }
      saveContext();

      if (result.done) { this.taskDone(); return; }

      const eff = result.value;
      if (eff.kind !== 'await') {
        this.taskDone();
        (onError ?? this.defaultOnError)?.(new Error(
          `Internal error: Scheduler task received an unexpected Effect ` +
          `(kind: '${(eff as any).kind}'). 'emit' effects must be consumed ` +
          `internally by takeFromGen/makeGeneratorGen.`
        ));
        return;
      }
      eff.promise.then(
        (v: any) => step(v, false),
        (e: any) => step(e, true),
      );
    };

    step();
  }

  private taskDone(): void {
    this.pending--;
    if (this.pending === 0 && this.resolveRun) {
      const resolve = this.resolveRun;
      this.resolveRun = undefined;
      resolve();
    }
  }

  /**
   * Resolves once every task spawned so far (and any tasks THEY spawn,
   * transitively) has completed. If new tasks are spawned after run()'s
   * returned promise has already resolved once, call run() again to wait
   * for those too — each call only waits for pending === 0 at least once.
   *
   * For a long-running server (httpserver.listen spawns a task per
   * request, indefinitely), run() is not the right tool — the process
   * stays alive because of the open server socket (Node-level), not
   * because of this scheduler. run() is for "run this batch of tasks to
   * completion", e.g. a script's top-level tasks in a test harness.
   */
  run(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise(resolve => { this.resolveRun = resolve; });
  }

  /** Number of tasks currently in flight (spawned but not yet completed). */
  get taskCount(): number { return this.pending; }
}
