// src/interpreter.ts
import { Expr, Stmt } from './ast';
import { SourcePos } from './lexer';
import { buildPfunError, PfunError } from './errors';
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';

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
  | { kind: 'plain'; name: string; fields: string[] }
  | { kind: 'union'; name: string; variants: { name: string; fields: string[] }[] };

// ─── Value Types ──────────────────────────────────────────────────────────────

function getValueType(v: any): string {
  if (v === null || v === undefined) return 'nil';
  if (v instanceof LazyList) return 'lazylist';
  if (v instanceof PfunDict) return 'dict';
  if (v instanceof PfunArray) return v.elementType ? `array<${v.elementType}>` : 'array';
  if (v instanceof PfunChar) return 'char';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'list';
    return `list<${getValueType(v[0])}>`;
  }
  if (v instanceof PfunFunction || v instanceof NativeFunction) return 'function';
  if (v && v.__type) return v.__union ?? v.__type;
  return typeof v;
}

export class Environment {
  private values = new Map<string, { value: any, mutable: boolean }>();
  constructor(public parent?: Environment) {}

  define(name: string, value: any, mutable: boolean = false) {
    this.values.set(name, { value, mutable });
  }

  isDefined(name: string): boolean {
    if (this.values.has(name)) return true;
    return this.parent ? this.parent.isDefined(name) : false;
  }

  get(name: string): any {
    if (this.values.has(name)) return this.values.get(name)!.value;
    if (this.parent) return this.parent.get(name);
    throw new Error(`Undefined variable '${name}'.`);
  }

  assign(name: string, value: any) {
    if (this.values.has(name)) {
      const binding = this.values.get(name)!;
      if (!binding.mutable) throw new Error(`Cannot assign to immutable variable '${name}'.`);
      binding.value = value;
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
    public memo: boolean = false
  ) {}

  execute(args: any[], interpreter: Interpreter): any {
    let currentArgs = args;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let currentFn: PfunFunction = this;
    while (true) {
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
            result = interpreter.evaluateStmt(stmts[i], env);
          }
          interpreter.inTailPosition = false;
        } catch (e) {
          interpreter.inTailPosition = false;
          if (e instanceof ReturnValue) result = e.value;
          else throw e;
        }
      } else {
        interpreter.inTailPosition = true;
        result = interpreter.evaluateExpr(currentFn.body, env);
        interpreter.inTailPosition = false;
      }
      if (result instanceof TailCall) {
        currentFn   = result.fn;
        currentArgs = result.args;
        continue;
      }
      return result;
    }
  }
}

export class ReturnValue { constructor(public value: any) {} }

// ─── Type Registry ────────────────────────────────────────────────────────────

interface TypeSchema {
  fields: string[];
  inferredTypes: string[] | null;
  unionName: string | null;
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

  registerPlain(name: string, fields: string[]) {
    const existing = this.schemas.get(name) ?? [];
    existing.push({ fields, inferredTypes: null, unionName: null });
    this.schemas.set(name, existing);
  }

  registerUnion(unionName: string, variants: { name: string; fields: string[] }[], globals?: Environment) {
    const variantNames = new Set<string>();
    for (const v of variants) {
      const existing = this.schemas.get(v.name) ?? [];
      // Allow shared variant names across different unions — only reject
      // redefinition within the same union.
      if (existing.some(s => s.unionName === unionName)) {
        throw new Error(`Variant '${v.name}' is already defined in union '${unionName}'.`);
      }
      existing.push({ fields: v.fields, inferredTypes: null, unionName });
      this.schemas.set(v.name, existing);
      variantNames.add(v.name);
      if (v.fields.length === 0 && globals) {
        // Zero-field variants that share a name across unions should only be
        // registered as globals once — first registration wins. Callers that
        // need a specific union's zero-field variant should construct explicitly.
        if (!globals.isDefined(v.name)) {
          globals.define(v.name, { __type: v.name, __union: unionName }, false);
        }
      }
    }
    this.unions.set(unionName, variantNames);
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

export class ModuleLoader {
  private cache   = new Map<string, Map<string, any>>();
  private loading = new Set<string>();
  private builtins = new Map<string, { fns: RegistryFunction[]; types: RegistryType[] }>();

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

  resolve(importPath: string, fromDir: string): string {
    // Built-in module — use a special sentinel prefix
    if (this.builtins.has(importPath)) return `__builtin__:${importPath}`;
    const base = (importPath.startsWith('./') || importPath.startsWith('../'))
      ? path.resolve(fromDir, importPath)
      : path.resolve(this.libDir, importPath);
    return base.endsWith('.pf') ? base : base + '.pf';
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
    const source = fs.readFileSync(resolvedPath, 'utf-8');
    const ast    = new Parser(new Lexer(source).lex()).parse();
    const interp = new Interpreter(path.dirname(resolvedPath), this);
    this.setup(interp);
    interp.interpret(ast);
    const exports = interp.getExports();
    this.cache.set(resolvedPath, exports);
    this.loading.delete(resolvedPath);
    return exports;
  }
}

// ─── Interpreter ──────────────────────────────────────────────────────────────

export class Interpreter {
  private globals  = new Environment();
  public  types    = new TypeRegistry();
  public  inPureContext: boolean = false;
  public  inTailPosition: boolean = false;
  private exports  = new Map<string, any>();
  private baseDir:      string;
  private moduleLoader: ModuleLoader;

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

  // ─── Public Registry API ────────────────────────────────────────────────────

  /** Register a single native function by name. */
  registerFunction(entry: RegistryFunction): void {
    this.globals.define(entry.name, new NativeFunction(entry.fn, entry.arity ?? 0), false);
  }

  /** Register a plain record type or discriminated union type. */
  registerType(entry: RegistryType): void {
    if (entry.kind === 'plain') {
      this.types.registerPlain(entry.name, entry.fields);
    } else {
      this.types.registerUnion(entry.name, entry.variants, this.globals);
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

  getGlobal(name: string): any { return this.force(this.globals.get(name)); }

  // ─── Statement Evaluation ───────────────────────────────────────────────────

  evaluateStmt(stmt: Stmt, env: Environment): any {
    this.trackPos(stmt, env);
    switch (stmt.type) {
      case 'LetStmt': {
        if (stmt.initializer.type === 'DictExpr') {
          throw new Error(`Dictionaries must be declared with 'var', not 'let'. Use: var ${stmt.name} = dict { ... }`);
        }
        if (stmt.initializer.type === 'ArrayExpr') {
          throw new Error(`Arrays must be declared with 'var', not 'let'. Use: var ${stmt.name} = array { ... }`);
        }
        env.define(stmt.name, new Thunk(stmt.initializer, env), false);
        return;
      }
      case 'VarStmt': {
        if (this.inPureContext) throw new Error("Functions cannot use 'var': side-effectful mutation is not allowed in pure functions. Use 'let' or convert to a procedure.");
        const val = this.force(this.evaluateExpr(stmt.initializer, env));
        env.define(stmt.name, val, true);
        return;
      }
      case 'TypeStmt':
        this.types.registerPlain(stmt.name, stmt.fields);
        return;
      case 'UnionTypeStmt':
        this.types.registerUnion(stmt.name, stmt.variants, this.globals);
        return;
      case 'ExprStmt': return this.evaluateExpr(stmt.expression, env);
      case 'EvalStmt': return this.force(this.evaluateExpr(stmt.expression, env));
      case 'ExportStmt': {
        this.evaluateStmt(stmt.declaration, env);
        const decl = stmt.declaration;
        if (decl.type === 'LetStmt' || decl.type === 'VarStmt') {
          try { this.exports.set(decl.name, env.get(decl.name)); } catch {}
        } else if (decl.type === 'FunctionStmt' || decl.type === 'ProcedureStmt') {
          try { this.exports.set(decl.name, env.get(decl.name)); } catch {}
        } else if (decl.type === 'TypeStmt') {
          // Export as a RegistryType descriptor so the importer can re-register it
          const descriptor: RegistryType = { kind: 'plain', name: decl.name, fields: decl.fields };
          this.exports.set(decl.name, { __registryType: descriptor });
        } else if (decl.type === 'UnionTypeStmt') {
          const descriptor: RegistryType = { kind: 'union', name: decl.name, variants: decl.variants };
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
          if (val && val.__builtinFn) {
            this.registerFunction(val.__builtinFn);
          } else if (val && val.__registryType) {
            this.registerType(val.__registryType);
          } else {
            targetEnv.define(alias ?? name, val, false);
          }
        };

        if (stmt.kind === 'star') {
          // import * from 'path' — all exports directly into current scope
          for (const [name, val] of moduleExports) bindExport(name, val, env);
        } else if (stmt.kind === 'namespace') {
          // import * as X from 'path' — all exports under alias object
          const ns: any = {};
          for (const [name, val] of moduleExports) {
            if (val && val.__builtinFn) ns[name] = val.__builtinFn.fn;
            else if (val && val.__registryType) { this.registerType(val.__registryType); }
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
          blockResult = this.evaluateStmt(stmts[i], blockEnv);
        }
        return blockResult;
      }
      case 'IfStmt': {
        const prevTail = this.inTailPosition;
        this.inTailPosition = false;
        const cond = this.force(this.evaluateExpr(stmt.condition, env));
        this.inTailPosition = prevTail;
        if (this.isTruthy(cond)) return this.evaluateStmt(stmt.thenBranch, env);
        else if (stmt.elseBranch) return this.evaluateStmt(stmt.elseBranch, env);
        return;
      }
      case 'FunctionStmt':
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'function', stmt.memo), false);
        return;
      case 'ProcedureStmt':
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'procedure'), false);
        return;
      case 'ReturnStmt':
        throw new ReturnValue(stmt.value ? this.evaluateExpr(stmt.value, env) : undefined);
    }
  }

  // ─── Expression Evaluation ──────────────────────────────────────────────────

  evaluateExpr(expr: Expr, env: Environment): any {
    this.trackPos(expr, env);
    switch (expr.type) {
      case 'IntExpr':   return expr.value;
      case 'BoolExpr':  return expr.value;
      case 'StrExpr':   return expr.value;
      case 'CharExpr':  return new PfunChar(expr.value);
      case 'IdentExpr': return env.get(expr.name);
      case 'GroupExpr': return this.evaluateExpr(expr.expression, env);
      case 'UnaryExpr': {
        this.inTailPosition = false;
        const val = this.force(this.evaluateExpr(expr.right, env));
        if (expr.operator === 'BooleanNot') return !val;
        if (expr.operator === 'MinusToken') return -val;
        throw new Error(`Unknown unary operator ${expr.operator}`);
      }
      case 'BinaryExpr': { this.inTailPosition = false; return this.evaluateBinary(expr, env); }
      case 'TernaryExpr': {
        const prevTailTern = this.inTailPosition;
        this.inTailPosition = false;
        const cond = this.force(this.evaluateExpr(expr.condition, env));
        this.inTailPosition = prevTailTern;
        return this.isTruthy(cond)
          ? this.evaluateExpr(expr.thenBranch, env)
          : this.evaluateExpr(expr.elseBranch, env);
      }
      case 'AssignExpr': {
        this.inTailPosition = false;
        const val = this.force(this.evaluateExpr(expr.value, env));
        env.assign(expr.name, val);
        return val;
      }
      case 'LambdaExpr': { this.inTailPosition = false; return new PfunFunction(null, expr.params, expr.body, env, 'function'); }
      case 'ListExpr': {
        this.inTailPosition = false;
        const elements = expr.elements.map(e => this.force(this.evaluateExpr(e, env)));
        this.enforceListType(elements);
        return elements;
      }
      case 'ComprehensionExpr': {
        const results: any[] = [];
        const evalGenerators = (genIndex: number, scopeEnv: Environment) => {
          if (genIndex === expr.generators.length) {
            if (expr.guard) {
              const guardVal = this.force(this.evaluateExpr(expr.guard, scopeEnv));
              if (!this.isTruthy(guardVal)) return;
            }
            results.push(this.force(this.evaluateExpr(expr.body, scopeEnv)));
            return;
          }
          const gen = expr.generators[genIndex];
          const source = this.force(this.evaluateExpr(gen.source, scopeEnv));
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
            evalGenerators(genIndex + 1, innerEnv);
          }
        };
        evalGenerators(0, env);
        if (results.length > 0 && results.every((c: any) => c instanceof PfunChar)) {
          return results.map((c: PfunChar) => c.value).join('');
        }
        this.enforceListType(results);
        return results;
      }
      case 'RecordExpr':      return this.evaluateRecord(expr, env);
      case 'DictExpr': {
        const map = new Map<string, any>();
        for (const entry of expr.entries) {
          const k = this.force(this.evaluateExpr(entry.key, env));
          const v = this.force(this.evaluateExpr(entry.value, env));
          map.set(PfunDict.keyOf(k), v);
        }
        return new PfunDict(map);
      }
      case 'ArrayExpr': {
        const elements = expr.elements.map((e: any) => this.force(this.evaluateExpr(e, env)));
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
        const obj = this.force(this.evaluateExpr(expr.object, env));
        const idx = this.force(this.evaluateExpr(expr.index, env));
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
        const obj = this.force(this.evaluateExpr(expr.object, env));
        if (obj instanceof PfunArray) {
          const idx = this.force(this.evaluateExpr(expr.index, env));
          if (typeof idx !== 'bigint') throw new Error("Array index must be an integer.");
          const i = Number(idx);
          if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of bounds (length ${obj.elements.length}).`);
          const val = this.force(this.evaluateExpr(expr.value, env));
          this.enforceArrayType(obj, val);
          obj.elements[i] = val;
          return val;
        }
        if (!(obj instanceof PfunDict)) throw new Error("Index assignment is only supported on dicts and arrays.");
        const idx = this.force(this.evaluateExpr(expr.index, env));
        const val = this.force(this.evaluateExpr(expr.value, env));
        obj.entries.set(PfunDict.keyOf(idx), val);
        return val;
      }
      case 'GetExpr': {
        const obj = this.force(this.evaluateExpr(expr.object, env));
        if (obj && typeof obj === 'object' && expr.name in obj) return obj[expr.name];
        throw new Error(`Property '${expr.name}' not found.`);
      }
      case 'CallExpr': {
        const callee = this.force(this.evaluateExpr(expr.callee, env));
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
            const suppliedArgs = expr.args.map(arg => this.force(this.evaluateExpr(arg, env)));
            const remainingParams = callee.params.slice(suppliedCount);
            const capturedParams  = callee.params.slice(0, suppliedCount);
            const partialEnv = new Environment(callee.closure);
            capturedParams.forEach((p, i) => partialEnv.define(p, suppliedArgs[i], false));
            return new PfunFunction(callee.name, remainingParams, callee.body, partialEnv, callee.kind, callee.memo);
          }
        }

        if (callee instanceof NativeFunction && callee.arity > 0) {
          const suppliedCount = expr.args.length;
          if (suppliedCount < callee.arity) {
            // Wrap native in a PfunFunction closure carrying the supplied args
            const suppliedArgs = expr.args.map(arg => this.force(this.evaluateExpr(arg, env)));
            const nativeFn = callee;
            const remainingParams = Array.from({ length: callee.arity - suppliedCount }, (_, i) => `__a${i}`);
            // Build a NativeFunction that prepends captured args before calling original
            const partialNative = new NativeFunction((newArgs, interp) => {
              return nativeFn.execute([...suppliedArgs, ...newArgs], interp);
            }, callee.arity - suppliedCount);
            return partialNative;
          }
        }

        const args = expr.args.map(arg => new Thunk(arg, env));
        if (callee instanceof NativeFunction) return callee.execute(args, this);

        if (callee.kind === 'function') {
          // Only use TailCall (iterative TCO) when this call is in tail position
          if (this.inPureContext && this.inTailPosition) {
            this.inTailPosition = false;
            return new TailCall(callee, args.map(a => this.force(a)));
          }
          const prevPure = this.inPureContext;
          const prevTail = this.inTailPosition;
          this.inTailPosition = false;
          const forcedArgs = args.map(a => this.force(a));
          if (callee.memo) {
            const cacheKey = this.getCacheKey(callee, forcedArgs);
            if (callee.cache.has(cacheKey)) { this.inTailPosition = prevTail; return callee.cache.get(cacheKey); }
            this.inPureContext = true;
            try {
              const result = this.force(callee.execute(forcedArgs, this));
              callee.cache.set(cacheKey, result);
              return result;
            } finally {
              this.inPureContext = prevPure;
              this.inTailPosition = prevTail;
            }
          } else {
            this.inPureContext = true;
            try {
              return this.force(callee.execute(forcedArgs, this));
            } finally {
              this.inPureContext = prevPure;
              this.inTailPosition = prevTail;
            }
          }
        }
        this.inTailPosition = false;
        return callee.execute(args, this);
      }
      case 'MatchExpr': return this.evaluateMatch(expr, env);
      case 'BlockExpr': {
        const blockEnv = new Environment(env);
        let result: any = undefined;
        const stmts = expr.statements;
        for (let i = 0; i < stmts.length; i++) {
          if (i < stmts.length - 1) this.inTailPosition = false;
          result = this.evaluateStmt(stmts[i], blockEnv);
        }
        return result;
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private evaluateRecord(expr: any, env: Environment): any {
    if (expr.fields.length > 0 && expr.fields[0].key !== null) {
      const schema = this.types.getFields(expr.name);
      if (schema.length === 0) throw new Error(`Unknown type '${expr.name}'.`);
      const byKey: any = {};
      for (const f of expr.fields) byKey[f.key] = this.force(this.evaluateExpr(f.value, env));
      const ordered = schema.map(f => {
        if (!(f in byKey)) throw new Error(`Missing field '${f}' in ${expr.name}.`);
        return byKey[f];
      });
      return this.types.instantiate(expr.name, ordered);
    }
    if (this.types.hasType(expr.name)) {
      const orderedValues = expr.fields.map((f: any) => this.force(this.evaluateExpr(f.value, env)));
      return this.types.instantiate(expr.name, orderedValues);
    }
    throw new Error(`Unknown type '${expr.name}'.`);
  }

  private evaluateMatch(expr: any, env: Environment): any {
    const prevTail     = this.inTailPosition;
    this.inTailPosition = false;
    const subject     = this.force(this.evaluateExpr(expr.subject, env));
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
        const guardVal = this.force(this.evaluateExpr(arm.guard, armEnv));
        if (!this.isTruthy(guardVal)) continue;
      }
      this.inTailPosition = prevTail;
      return this.evaluateExpr(arm.body, armEnv);
    }
    throw new Error(`Non-exhaustive match: no arm matched value of type '${subjectType ?? 'unknown'}'.`);
  }

  private evaluateBinary(expr: any, env: Environment): any {
    if (expr.operator === 'BooleanAnd') {
      const left = this.force(this.evaluateExpr(expr.left, env));
      if (!this.isTruthy(left)) return false;
      return this.isTruthy(this.force(this.evaluateExpr(expr.right, env)));
    }
    if (expr.operator === 'BooleanOr') {
      const left = this.force(this.evaluateExpr(expr.left, env));
      if (this.isTruthy(left)) return true;
      return this.isTruthy(this.force(this.evaluateExpr(expr.right, env)));
    }
    const left  = this.force(this.evaluateExpr(expr.left, env));
    const right = this.force(this.evaluateExpr(expr.right, env));

    if (expr.operator === 'PlusToken') {
      const lStr = typeof left === 'string', rStr = typeof right === 'string';
      const lChar = left instanceof PfunChar, rChar = right instanceof PfunChar;
      const lCL = Array.isArray(left)  && left.every((c: any)  => c instanceof PfunChar);
      const rCL = Array.isArray(right) && right.every((c: any) => c instanceof PfunChar);
      if (lStr || lChar || lCL || rStr || rChar || rCL) return this.stringify(left) + this.stringify(right);
      return left + right;
    }

    switch (expr.operator) {
      case 'MinusToken':        return left - right;
      case 'StarToken':         return left * right;
      case 'SlashToken':
        if (typeof right === 'bigint' && right === 0n) throw new Error('Divide by zero.');
        return left / right;
      case 'PercentToken':
        if (typeof right === 'bigint' && right === 0n) throw new Error('Divide by zero (modulo by zero).');
        return left % right;
      case 'EqualToken': {
        if (left instanceof PfunChar && right instanceof PfunChar) return left.value === right.value;
        if (left instanceof PfunChar || right instanceof PfunChar) return false;
        return left === right;
      }
      case 'NotEqualToken': {
        if (left instanceof PfunChar && right instanceof PfunChar) return left.value !== right.value;
        if (left instanceof PfunChar || right instanceof PfunChar) return true;
        return left !== right;
      }
      case 'GreaterToken':      return left > right;
      case 'LessToken':         return left < right;
      case 'GreaterEqualToken': return left >= right;
      case 'LessEqualToken':    return left <= right;
      default: throw new Error(`Unknown binary operator ${expr.operator}`);
    }
  }

  force(value: any): any {
    let current = value;
    while (true) {
      if (current instanceof Thunk) {
        // Save and restore position tracking around thunk evaluation so that
        // lazily forcing a 'let' binding doesn't clobber the position of
        // the expression that triggered the force.
        const savedPos  = this._currentPos;
        const savedNode = this._currentNode;
        const savedEnv  = this._currentEnv;
        current = this.evaluateExpr(current.expr, current.env);
        this._currentPos  = savedPos;
        this._currentNode = savedNode;
        this._currentEnv  = savedEnv;
      }
      else if (current instanceof TailCall) current = this.trampoline(current.fn, current.args);
      else return current;
    }
  }

  private trampoline(fn: PfunFunction, args: any[]): any {
    let currentFn   = fn;
    let currentArgs = args.map(a => this.force(a));
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
        const result = currentFn.execute(currentArgs, this);
        if (result instanceof TailCall) {
          this.inPureContext = result.fn.kind === 'function';
          currentFn   = result.fn;
          currentArgs = result.args.map(a => this.force(a));
          continue;
        }
        const finalResult = this.force(result);
        while (callStack.length > 0) { const p = callStack.pop()!; if (p.fn.memo) p.fn.cache.set(p.key, finalResult); }
        return finalResult;
      }
    } finally { this.inPureContext = prevPure; }
  }

  takeFrom(list: LazyList, n: number): any[] {
    const results: any[] = [];
    const gen = this.makeGenerator(list.descriptor);
    while (results.length < n) {
      const { value, done } = gen.next();
      if (done) break;
      results.push(value);
    }
    return results;
  }

  private *makeGenerator(desc: LazyListDescriptor): Generator<any> {
    switch (desc.kind) {
      case 'iterate': { let cur = desc.seed; while (true) { yield cur; cur = this.force(desc.f.execute([cur], this)); } }
      case 'repeat':  { while (true) yield desc.value; }
      case 'cycle': {
        const src = desc.source;
        if (Array.isArray(src)) {
          if (src.length === 0) return;
          let i = 0; while (true) { yield src[i % src.length]; i++; }
        } else if (src instanceof LazyList) {
          const buf: any[] = [];
          const inner = this.makeGenerator(src.descriptor);
          while (true) { const { value, done } = inner.next(); if (done) break; buf.push(value); yield value; }
          if (buf.length === 0) return;
          let i = 0; while (true) { yield buf[i % buf.length]; i++; }
        }
        break;
      }
      case 'map': {
        const inner = this.makeGenerator(desc.source.descriptor);
        while (true) { const { value, done } = inner.next(); if (done) break; yield this.force(desc.f.execute([value], this)); }
        break;
      }
      case 'filter': {
        const inner = this.makeGenerator(desc.source.descriptor);
        while (true) { const { value, done } = inner.next(); if (done) break; if (this.isTruthy(this.force(desc.f.execute([value], this)))) yield value; }
        break;
      }
      case 'cons': {
        yield desc.head;
        const t = desc.tail;
        if (t instanceof LazyList) yield* this.makeGenerator(t.descriptor);
        else if (Array.isArray(t)) yield* t;
        break;
      }
      case 'drop': {
        const inner = this.makeGenerator(desc.source.descriptor);
        let skipped = 0;
        while (skipped < desc.n) { const { done } = inner.next(); if (done) return; skipped++; }
        while (true) { const { value, done } = inner.next(); if (done) break; yield value; }
        break;
      }
    }
  }

  private getCacheKey(fn: PfunFunction, args: any[]): string {
    return JSON.stringify(args, (_, v) => typeof v === 'bigint' ? v.toString() + 'n' : v);
  }

  isTruthy(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number')  return value !== 0;
    if (typeof value === 'bigint')  return value !== 0n;
    if (typeof value === 'string')  return value !== '';
    return true;
  }

  stringify(value: any): string {
    if (value === null || value === undefined) return 'nil';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint')  return value.toString();
    if (value instanceof PfunChar)  return value.value;
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
    if (elements.length > 0) {
      const firstType = getValueType(elements[0]);
      for (let i = 1; i < elements.length; i++) {
        const currentType = getValueType(elements[i]);
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
