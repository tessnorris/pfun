// src/interpreter.ts
import { Expr, Stmt } from './ast';

/**
 * Utility function to determine the runtime type of a value.
 * Recursively checks nested lists to ensure deep type consistency (e.g., list<bigint>).
 */
function getValueType(v: any): string {
  if (v === null || v === undefined) return 'nil';
  if (v instanceof LazyList) return 'lazylist';
  if (v instanceof PfunDict) return 'dict';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'list';
    return `list<${getValueType(v[0])}>`;
  }
  if (v instanceof PfunFunction || v instanceof NativeFunction) return 'function';
  if (v && v.__type) return v.__union ?? v.__type;
  return typeof v;
}

/**
 * Lexical Environment.
 * Implements a scope chain using parent pointers to resolve variables.
 * Tracks variable values and their mutability status (let vs var).
 */
export class Environment {
  private values = new Map<string, { value: any, mutable: boolean }>();
  constructor(public parent?: Environment) {}

  define(name: string, value: any, mutable: boolean = false) {
    this.values.set(name, { value, mutable });
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

/**
 * THUNK (Lazy Evaluation)
 */
export class Thunk {
  constructor(public expr: Expr, public env: Environment) {}
}

/**
 * TAIL CALL (Trampolining)
 */
export class TailCall {
  constructor(public fn: PfunFunction, public args: any[]) {}
}

/**
 * DICTIONARY
 * A mutable, key-value store. Keys must be primitives (string, bigint, boolean).
 * Dictionaries must always be declared with `var`.
 */
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
 * LAZY LIST (Infinite List Descriptor)
 *
 * Represents an infinite (or lazily-evaluated) list as a descriptor object.
 * Values are never computed until take() materializes them into a finite array.
 * Operations like map/filter/cons produce new descriptors wrapping the old one.
 *
 * Kinds:
 *   iterate  - [seed, f(seed), f(f(seed)), ...]
 *   repeat   - [x, x, x, ...]
 *   cycle    - [a,b,c, a,b,c, ...] from a finite array or another LazyList
 *   map      - applies f to each element of source at take-time
 *   filter   - keeps elements of source passing predicate at take-time
 *   cons     - prepends a single value to a source list
 */
export class LazyList {
  constructor(public descriptor: LazyListDescriptor) {}
}

type LazyListDescriptor =
  | { kind: 'iterate'; f: any; seed: any }
  | { kind: 'repeat';  value: any }
  | { kind: 'cycle';   source: any }
  | { kind: 'map';     f: any; source: any }
  | { kind: 'filter';  f: any; source: any }
  | { kind: 'cons';    head: any; tail: any }
  | { kind: 'drop';    n: number; source: LazyList };

export class NativeFunction {
  constructor(public fn: (args: any[], interpreter: Interpreter) => any) {}
  execute(args: any[], interpreter: Interpreter) { return this.fn(args, interpreter); }
}

export class PfunFunction {
  public cache = new Map<string, any>();
  constructor(
    public name: string | null,
    public params: string[],
    public body: Stmt[] | Expr,
    public closure: Environment,
    public kind: 'function' | 'procedure' = 'function'
  ) {}

  execute(args: any[], interpreter: Interpreter): any {
    const env = new Environment(this.closure);
    for (let i = 0; i < this.params.length; i++) {
      env.define(this.params[i], args[i], false);
    }

    if (Array.isArray(this.body)) {
      try {
        let result: any = undefined;
        for (const stmt of this.body) result = interpreter.evaluateStmt(stmt, env);
        return result;
      } catch (e) {
        if (e instanceof ReturnValue) return e.value;
        throw e;
      }
    } else {
      // Lambda body is always a pure expression
      return interpreter.evaluateExpr(this.body, env);
    }
  }
}

class ReturnValue { constructor(public value: any) {} }

// ─── Type Registry ────────────────────────────────────────────────────────────

/**
 * Schema entry for a single type (plain record or union variant).
 */
interface TypeSchema {
  fields: string[];
  inferredTypes: string[] | null; // null = not yet inferred
  unionName: string | null;       // set for union variants; null for plain records
}

/**
 * Unified Type Registry for both plain records and discriminated union types.
 *
 * Plain record:   registerPlain(name, fields)
 * Union type:     registerUnion(unionName, variants)
 *   - Registers each variant independently so it can be constructed by name.
 *   - Tracks which union a variant belongs to for exhaustiveness checking.
 */
class TypeRegistry {
  private schemas = new Map<string, TypeSchema>();
  // unionName → Set of variant names
  private unions = new Map<string, Set<string>>();

  /** Register a plain record type (TypeStmt). */
  registerPlain(name: string, fields: string[]) {
    this.schemas.set(name, { fields, inferredTypes: null, unionName: null });
  }

  /** Register a discriminated union and all its variants (UnionTypeStmt). */
  registerUnion(unionName: string, variants: { name: string; fields: string[] }[], globals?: Environment) {
    const variantNames = new Set<string>();
    for (const v of variants) {
      if (this.schemas.has(v.name)) {
        throw new Error(`Variant '${v.name}' is already defined.`);
      }
      this.schemas.set(v.name, { fields: v.fields, inferredTypes: null, unionName });
      variantNames.add(v.name);
      // Zero-field variants are singletons - seed them into the environment
      // so bare identifiers like `None` resolve without needing braces.
      if (v.fields.length === 0 && globals) {
        globals.define(v.name, { __type: v.name, __union: unionName }, false);
      }
    }
    this.unions.set(unionName, variantNames);
  }

  /**
   * Construct a record/variant value.
   * Infers field types on first use and enforces them on subsequent uses.
   */
  instantiate(name: string, orderedValues: any[]): any {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`Unknown type '${name}'.`);
    if (orderedValues.length !== schema.fields.length) {
      throw new Error(`'${name}' expects ${schema.fields.length} field(s), got ${orderedValues.length}.`);
    }

    const currentTypes = orderedValues.map(v => getValueType(v));

    if (schema.inferredTypes === null) {
      schema.inferredTypes = currentTypes;
    } else {
      for (let i = 0; i < schema.fields.length; i++) {
        if (schema.inferredTypes[i] !== currentTypes[i]) {
          throw new Error(
            `Type mismatch in ${name}: field '${schema.fields[i]}' expected ${schema.inferredTypes[i]}, got ${currentTypes[i]}.`
          );
        }
      }
    }

    const obj: any = { __type: name, __union: schema.unionName ?? undefined };
    schema.fields.forEach((f, i) => obj[f] = orderedValues[i]);
    return obj;
  }

  /** Returns the union name for a variant, or null if it's a plain record. */
  unionOf(variantName: string): string | null {
    return this.schemas.get(variantName)?.unionName ?? null;
  }

  /** Returns all variant names for a union, or null if not a known union. */
  variantsOf(unionName: string): Set<string> | null {
    return this.unions.get(unionName) ?? null;
  }

  hasType(name: string): boolean {
    return this.schemas.has(name);
  }

  getFields(name: string): string[] {
    return this.schemas.get(name)?.fields ?? [];
  }
}

// ─── Interpreter ──────────────────────────────────────────────────────────────

export class Interpreter {
  private globals = new Environment();
  private types = new TypeRegistry();
  public inPureContext: boolean = false;

  constructor() {
    this.registerBuiltins();
    this.registerBuiltinTypes();
  }

  private registerBuiltinTypes() {
    // Option is a built-in union type: Some { value } | None
    this.types.registerUnion('Option', [
      { name: 'Some', fields: ['value'] },
      { name: 'None', fields: [] },
    ], this.globals);
  }

  private registerBuiltins() {
    this.globals.define('head', new NativeFunction((args, interpreter) => {
      const list = interpreter.force(args[0]);
      if (list instanceof LazyList) {
        const taken = interpreter.takeFrom(list, 1);
        if (taken.length === 0) throw new Error("head requires a non-empty list.");
        return taken[0];
      }
      if (!Array.isArray(list) || list.length === 0) throw new Error("head requires a non-empty list.");
      return list[0];
    }), false);

    this.globals.define('tail', new NativeFunction((args, interpreter) => {
      const list = interpreter.force(args[0]);
      if (list instanceof LazyList) return new LazyList({ kind: 'drop', n: 1, source: list });
      if (!Array.isArray(list)) throw new Error("tail requires a list.");
      return list.slice(1);
    }), false);

    this.globals.define('cons', new NativeFunction((args, interpreter) => {
      const head = interpreter.force(args[0]);
      const tail = interpreter.force(args[1]);
      // cons onto a lazy list produces a new lazy list descriptor
      if (tail instanceof LazyList) return new LazyList({ kind: 'cons', head, tail });
      if (!Array.isArray(tail)) throw new Error("cons requires a list as second argument.");
      const newList = [head, ...tail];
      this.enforceListType(newList);
      return newList;
    }), false);

    this.globals.define('map', new NativeFunction((args, interpreter) => {
      const fn = interpreter.force(args[0]);
      const list = interpreter.force(args[1]);
      // map over a lazy list produces a new lazy descriptor - no values computed yet
      if (list instanceof LazyList) return new LazyList({ kind: 'map', f: fn, source: list });
      const mapped = list.map((item: any) => interpreter.force(fn.execute([item], interpreter)));
      this.enforceListType(mapped);
      return mapped;
    }), false);

    this.globals.define('filter', new NativeFunction((args, interpreter) => {
      const fn = interpreter.force(args[0]);
      const list = interpreter.force(args[1]);
      // filter over a lazy list produces a new lazy descriptor
      if (list instanceof LazyList) return new LazyList({ kind: 'filter', f: fn, source: list });
      return list.filter((item: any) => this.isTruthy(interpreter.force(fn.execute([item], interpreter))));
    }), false);

    this.globals.define('reduce', new NativeFunction((args, interpreter) => {
      const fn = interpreter.force(args[0]);
      let acc = interpreter.force(args[1]);
      const list = interpreter.force(args[2]);
      if (list instanceof LazyList) throw new Error("reduce cannot be used on an infinite list. Use take() first to get a finite list.");
      for (const item of list) acc = interpreter.force(fn.execute([acc, item], interpreter));
      return acc;
    }), false);

    // ─── Infinite List Constructors ───────────────────────────────────────────

    this.globals.define('iterate', new NativeFunction((args, interpreter) => {
      const f    = interpreter.force(args[0]);
      const seed = interpreter.force(args[1]);
      return new LazyList({ kind: 'iterate', f, seed });
    }), false);

    this.globals.define('repeat', new NativeFunction((args, interpreter) => {
      const value = interpreter.force(args[0]);
      return new LazyList({ kind: 'repeat', value });
    }), false);

    this.globals.define('cycle', new NativeFunction((args, interpreter) => {
      const source = interpreter.force(args[0]);
      return new LazyList({ kind: 'cycle', source });
    }), false);

    // ─── Materialization ──────────────────────────────────────────────────────

    this.globals.define('take', new NativeFunction((args, interpreter) => {
      const n    = interpreter.force(args[0]);
      const list = interpreter.force(args[1]);
      if (typeof n !== 'bigint') throw new Error("take requires an integer as first argument.");
      const count = Number(n);
      if (Array.isArray(list)) {
        const result = list.slice(0, count);
        this.enforceListType(result);
        return result;
      }
      if (list instanceof LazyList) {
        const result = interpreter.takeFrom(list, count);
        this.enforceListType(result);
        return result;
      }
      throw new Error("take requires a list as second argument.");
    }), false);

    // ─── Dictionary Operations ────────────────────────────────────────────────

    this.globals.define('has', new NativeFunction((args, interpreter) => {
      const dict = interpreter.force(args[0]);
      const key  = interpreter.force(args[1]);
      if (!(dict instanceof PfunDict)) throw new Error("has() requires a dict as first argument.");
      return dict.entries.has(PfunDict.keyOf(key));
    }), false);

    this.globals.define('remove', new NativeFunction((args, interpreter) => {
      const dict = interpreter.force(args[0]);
      const key  = interpreter.force(args[1]);
      if (!(dict instanceof PfunDict)) throw new Error("remove() requires a dict as first argument.");
      dict.entries.delete(PfunDict.keyOf(key));
      return dict;
    }), false);

    this.globals.define('keys', new NativeFunction((args, interpreter) => {
      const dict = interpreter.force(args[0]);
      if (!(dict instanceof PfunDict)) throw new Error("keys() requires a dict as first argument.");
      return [...dict.entries.keys()].map(k => {
        const prefix = k.slice(0, 2);
        const raw = k.slice(2);
        if (prefix === 's:') return raw;
        if (prefix === 'i:') return BigInt(raw);
        if (prefix === 'b:') return raw === 'true';
        return raw;
      });
    }), false);

    this.globals.define('values', new NativeFunction((args, interpreter) => {
      const dict = interpreter.force(args[0]);
      if (!(dict instanceof PfunDict)) throw new Error("values() requires a dict as first argument.");
      return [...dict.entries.values()];
    }), false);
  }

  private enforceListType(elements: any[]): void {
    if (elements.length > 0) {
      const firstType = getValueType(elements[0]);
      for (let i = 1; i < elements.length; i++) {
        const currentType = getValueType(elements[i]);
        if (currentType !== firstType) {
          throw new Error(`Type mismatch in list: expected ${firstType}, got ${currentType}.`);
        }
      }
    }
  }

  interpret(statements: Stmt[]) {
    for (const stmt of statements) this.force(this.evaluateStmt(stmt, this.globals));
  }

  getGlobal(name: string): any { return this.force(this.globals.get(name)); }

  evaluateStmt(stmt: Stmt, env: Environment): any {
    switch (stmt.type) {
      case 'LetStmt': {
        // Eagerly check: if the initializer is a dict literal, disallow let
        // (we must force to find out, so we peek at the AST node type)
        if (stmt.initializer.type === 'DictExpr') {
          throw new Error(`Dictionaries must be declared with 'var', not 'let'. Use: var ${stmt.name} = dict { ... }`);
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
      case 'PrintStmt': {
        if (this.inPureContext) throw new Error("Functions cannot use 'print': side effects are not allowed in pure functions. Use a procedure instead.");
        const printVal = this.force(this.evaluateExpr(stmt.expression, env));
        console.log(this.stringify(printVal));
        return printVal;
      }
      case 'EvalStmt': return this.force(this.evaluateExpr(stmt.expression, env));
      case 'BlockStmt': {
        const blockEnv = new Environment(env);
        let blockResult: any = undefined;
        for (const s of stmt.statements) blockResult = this.evaluateStmt(s, blockEnv);
        return blockResult;
      }
      case 'IfStmt': {
        const cond = this.force(this.evaluateExpr(stmt.condition, env));
        if (this.isTruthy(cond)) return this.evaluateStmt(stmt.thenBranch, env);
        else if (stmt.elseBranch) return this.evaluateStmt(stmt.elseBranch, env);
        return;
      }
      case 'FunctionStmt':
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'function'), false);
        return;
      case 'ProcedureStmt':
        env.define(stmt.name, new PfunFunction(stmt.name, stmt.params, stmt.body, env, 'procedure'), false);
        return;
      case 'ReturnStmt':
        throw new ReturnValue(stmt.value ? this.evaluateExpr(stmt.value, env) : undefined);
    }
  }

  evaluateExpr(expr: Expr, env: Environment): any {
    switch (expr.type) {
      case 'IntExpr': return expr.value;
      case 'BoolExpr': return expr.value;
      case 'StrExpr': return expr.value;
      case 'IdentExpr': return env.get(expr.name);
      case 'GroupExpr': return this.evaluateExpr(expr.expression, env);
      case 'AssignExpr': {
        const assignVal = this.force(this.evaluateExpr(expr.value, env));
        env.assign(expr.name, assignVal);
        return assignVal;
      }
      case 'UnaryExpr': {
        const right = this.force(this.evaluateExpr(expr.right, env));
        if (expr.operator === 'MinusToken') return -right;
        if (expr.operator === 'BooleanNot') return !this.isTruthy(right);
        throw new Error(`Unknown unary operator ${expr.operator}`);
      }
      case 'BinaryExpr': return this.evaluateBinary(expr, env);
      case 'TernaryExpr': {
        const ternaryCond = this.force(this.evaluateExpr(expr.condition, env));
        if (this.isTruthy(ternaryCond)) return this.evaluateExpr(expr.thenBranch, env);
        return this.evaluateExpr(expr.elseBranch, env);
      }
      case 'ListExpr': {
        const elements = expr.elements.map(e => this.force(this.evaluateExpr(e, env)));
        this.enforceListType(elements);
        return elements;
      }
      case 'ComprehensionExpr': {
        const results: any[] = [];
        const evalGenerators = (genIndex: number, scopeEnv: Environment) => {
          if (genIndex === expr.generators.length) {
            // All generators exhausted - check guard then collect body
            if (expr.guard) {
              const guardVal = this.force(this.evaluateExpr(expr.guard, scopeEnv));
              if (!this.isTruthy(guardVal)) return;
            }
            results.push(this.force(this.evaluateExpr(expr.body, scopeEnv)));
            return;
          }
          const gen = expr.generators[genIndex];
          const source = this.force(this.evaluateExpr(gen.source, scopeEnv));
          if (!Array.isArray(source)) throw new Error(`Comprehension source must be a list, got ${typeof source}.`);
          for (const item of source) {
            const innerEnv = new Environment(scopeEnv);
            innerEnv.define(gen.variable, item, false);
            evalGenerators(genIndex + 1, innerEnv);
          }
        };
        evalGenerators(0, env);
        this.enforceListType(results);
        return results;
      }
      case 'RecordExpr': return this.evaluateRecord(expr, env);
      case 'DictExpr': {
        const map = new Map<string, any>();
        for (const entry of expr.entries) {
          const k = this.force(this.evaluateExpr(entry.key, env));
          const v = this.force(this.evaluateExpr(entry.value, env));
          map.set(PfunDict.keyOf(k), v);
        }
        return new PfunDict(map);
      }
      case 'IndexExpr': {
        const obj = this.force(this.evaluateExpr(expr.object, env));
        const idx = this.force(this.evaluateExpr(expr.index, env));
        if (obj instanceof PfunDict) {
          const key = PfunDict.keyOf(idx);
          if (!obj.entries.has(key)) throw new Error(`Key not found in dict: ${this.stringify(idx)}`);
          return obj.entries.get(key);
        }
        if (Array.isArray(obj)) {
          if (typeof idx !== 'bigint') throw new Error("List index must be an integer.");
          const i = Number(idx);
          if (i < 0 || i >= obj.length) throw new Error(`List index ${i} out of bounds (length ${obj.length}).`);
          return obj[i];
        }
        throw new Error("Index operator requires a dict or list.");
      }
      case 'IndexAssignExpr': {
        if (this.inPureContext) throw new Error("Functions cannot mutate dicts: side-effectful mutation is not allowed in pure functions. Use a procedure instead.");
        const obj = this.force(this.evaluateExpr(expr.object, env));
        if (!(obj instanceof PfunDict)) throw new Error("Index assignment is only supported on dicts.");
        const idx = this.force(this.evaluateExpr(expr.index, env));
        const val = this.force(this.evaluateExpr(expr.value, env));
        obj.entries.set(PfunDict.keyOf(idx), val);
        return val;
      }
      case 'GetExpr': {
        const obj = this.force(this.evaluateExpr(expr.object, env));
        if (!(expr.name in obj)) throw new Error(`Undefined property '${expr.name}'.`);
        return obj[expr.name];
      }
      case 'LambdaExpr': return new PfunFunction(null, expr.params, expr.body, env);
      case 'CallExpr': {
        const callee = this.force(this.evaluateExpr(expr.callee, env));
        if (!(callee instanceof PfunFunction) && !(callee instanceof NativeFunction)) {
          throw new Error("Can only call functions.");
        }
        // Procedures cannot be called from inside a pure function
        if (this.inPureContext && callee instanceof PfunFunction && callee.kind === 'procedure') {
          const name = callee.name ? `'${callee.name}'` : 'anonymous';
          throw new Error(`Functions cannot call procedures: ${name} is a procedure. Move the call to a procedure, or convert ${name} to a function.`);
        }
        const args = expr.args.map(arg => new Thunk(arg, env));
        if (callee instanceof NativeFunction) return callee.execute(args, this);
        // Procedures use strict evaluation: force all args immediately, skip memoization
        if (callee.kind === 'procedure') {
          const forcedArgs = args.map(a => this.force(a));
          return callee.execute(forcedArgs, this);
        }
        return new TailCall(callee, args);
      }
      case 'MatchExpr': return this.evaluateMatch(expr, env);
    }
  }

  // ─── Record Construction ─────────────────────────────────────────────────

  private evaluateRecord(expr: Extract<Expr, { type: 'RecordExpr' }>, env: Environment): any {
    if (!this.types.hasType(expr.name)) throw new Error(`Unknown type '${expr.name}'.`);
    const fields = this.types.getFields(expr.name);

    let orderedValues: any[];
    const isNamed = expr.fields.length > 0 && expr.fields[0].key !== null;

    if (isNamed) {
      // Named: Square { side = 10 } or Square(side = 10)
      orderedValues = fields.map(f => {
        const field = expr.fields.find(ef => ef.key === f);
        if (!field) throw new Error(`Missing field '${f}' in ${expr.name}.`);
        return this.force(this.evaluateExpr(field.value, env));
      });
    } else {
      // Positional: Square { 10 }
      orderedValues = expr.fields.map(f => this.force(this.evaluateExpr(f.value, env)));
    }

    return this.types.instantiate(expr.name, orderedValues);
  }

  // ─── Match Expression ─────────────────────────────────────────────────────

  /**
   * Evaluates a match expression against a value.
   *
   * Algorithm:
   *   1. Force the subject to a concrete value.
   *   2. Determine the union the subject's type belongs to (for exhaustiveness).
   *   3. Walk arms in order:
   *      a. Wildcard arm (variant === null): always matches.
   *      b. Variant arm: matches if subject.__type === arm.variant.
   *         - If the arm has a binding, define it in a new scope.
   *         - If the arm has a guard, evaluate it; skip arm if falsy.
   *      c. First matching arm's body expression is returned.
   *   4. If no arm matched, check exhaustiveness and throw accordingly.
   */
  private evaluateMatch(expr: Extract<Expr, { type: 'MatchExpr' }>, env: Environment): any {
    const subject = this.force(this.evaluateExpr(expr.subject, env));
    const subjectVariant: string = subject?.__type ?? null;

    // Determine the union this value belongs to, for exhaustiveness checking.
    const unionName = subjectVariant ? this.types.unionOf(subjectVariant) : null;
    const hasWildcard = expr.arms.some(a => a.variant === null);

    // Exhaustiveness check: if no wildcard, every variant of the union must be covered.
    if (!hasWildcard && unionName !== null) {
      const allVariants = this.types.variantsOf(unionName)!;
      const coveredVariants = new Set(expr.arms.map(a => a.variant).filter(Boolean));
      const missing = [...allVariants].filter(v => !coveredVariants.has(v));
      if (missing.length > 0) {
        throw new Error(
          `Non-exhaustive match on '${unionName}': missing arm(s) for ${missing.map(v => `'${v}'`).join(', ')}.`
        );
      }
    }

    for (const arm of expr.arms) {
      // Wildcard arm always matches
      if (arm.variant === null) {
        return this.evaluateExpr(arm.body, env);
      }

      // Variant arm: check type tag
      if (subjectVariant !== arm.variant) continue;

      // Build arm scope with optional binding
      const armEnv = new Environment(env);
      if (arm.binding !== null) {
        armEnv.define(arm.binding, subject, false);
      }

      // Evaluate optional guard in arm scope
      if (arm.guard !== undefined) {
        const guardVal = this.force(this.evaluateExpr(arm.guard, armEnv));
        if (!this.isTruthy(guardVal)) continue; // guard failed, try next arm
      }

      return this.evaluateExpr(arm.body, armEnv);
    }

    // No arm matched (possible when using guards without a wildcard fallback on the same variant)
    throw new Error(
      `Non-exhaustive match: no arm matched value of type '${subjectVariant ?? 'unknown'}'.`
    );
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

    const left = this.force(this.evaluateExpr(expr.left, env));
    const right = this.force(this.evaluateExpr(expr.right, env));

    switch (expr.operator) {
      case 'PlusToken': return left + right;
      case 'MinusToken': return left - right;
      case 'StarToken': return left * right;
      case 'SlashToken': return left / right;
      case 'PercentToken': return left % right;
      case 'EqualToken': return left === right;
      case 'GreaterToken': return left > right;
      case 'LessToken': return left < right;
      case 'GreaterEqualToken': return left >= right;
      case 'LessEqualToken': return left <= right;
      case 'NotEqualToken': return left !== right;
      default: throw new Error(`Unknown binary operator ${expr.operator}`);
    }
  }

  /**
   * THE FORCE ENGINE
   * Resolves delayed computations (Thunks and TailCalls).
   */
  force(value: any): any {
    let current = value;
    while (true) {
      if (current instanceof Thunk) {
        current = this.evaluateExpr(current.expr, current.env);
      } else if (current instanceof TailCall) {
        current = this.trampoline(current.fn, current.args);
      } else {
        return current;
      }
    }
  }

  /**
   * TRAMPOLINE & MEMOIZATION LOOP
   */
  private trampoline(fn: PfunFunction, args: any[]): any {
    let currentFn = fn;
    let currentArgs = args.map(a => this.force(a));
    const callStack: { fn: PfunFunction, args: any[], key: string }[] = [];
    const prevPure = this.inPureContext;
    if (currentFn.kind === 'function') this.inPureContext = true;

    try {
      while (true) {
        const cacheKey = this.getCacheKey(currentFn, currentArgs);

        if (currentFn.cache.has(cacheKey)) {
          let result = currentFn.cache.get(cacheKey);
          while (callStack.length > 0) {
            const prev = callStack.pop()!;
            prev.fn.cache.set(prev.key, result);
          }
          return result;
        }

        callStack.push({ fn: currentFn, args: currentArgs, key: cacheKey });
        let result = currentFn.execute(currentArgs, this);

        if (result instanceof TailCall) {
          this.inPureContext = result.fn.kind === 'function';
          currentFn = result.fn;
          currentArgs = result.args.map(a => this.force(a));
          continue;
        }

        let finalResult = this.force(result);
        while (callStack.length > 0) {
          const prev = callStack.pop()!;
          prev.fn.cache.set(prev.key, finalResult);
        }
        return finalResult;
      }
    } finally {
      this.inPureContext = prevPure;
    }
  }

  /**
   * MATERIALIZATION ENGINE
   *
   * Pulls up to `n` values from a LazyList descriptor chain,
   * returning a finite JavaScript array. For 'filter' descriptors,
   * more than n source values may be consumed to find n passing ones.
   *
   * Each descriptor kind has a generator-style implementation that
   * yields one value at a time without recursion.
   */
  takeFrom(list: LazyList, n: number): any[] {
    const results: any[] = [];
    // Use an explicit stack of iterators to avoid deep recursion on
    // chained descriptors (e.g. map(filter(iterate(...)))).
    // Each frame is a generator function over a descriptor.
    const gen = this.makeGenerator(list.descriptor);
    while (results.length < n) {
      const { value, done } = gen.next();
      if (done) break;
      results.push(value);
    }
    return results;
  }

  private *makeGenerator(desc: LazyList['descriptor']): Generator<any> {
    switch (desc.kind) {
      case 'iterate': {
        let current = desc.seed;
        while (true) {
          yield current;
          current = this.force(desc.f.execute([current], this));
        }
      }
      case 'repeat': {
        while (true) yield desc.value;
      }
      case 'cycle': {
        const source = desc.source;
        if (Array.isArray(source)) {
          if (source.length === 0) return;
          let i = 0;
          while (true) { yield source[i % source.length]; i++; }
        } else if (source instanceof LazyList) {
          // cycle of a lazy list: buffer values as we go, then cycle the buffer
          const buffer: any[] = [];
          const inner = this.makeGenerator(source.descriptor);
          while (true) {
            const { value, done } = inner.next();
            if (done) break;
            buffer.push(value);
            yield value;
          }
          if (buffer.length === 0) return;
          let i = 0;
          while (true) { yield buffer[i % buffer.length]; i++; }
        }
        break;
      }
      case 'map': {
        const inner = this.makeGenerator(desc.source.descriptor);
        while (true) {
          const { value, done } = inner.next();
          if (done) break;
          yield this.force(desc.f.execute([value], this));
        }
        break;
      }
      case 'filter': {
        const inner = this.makeGenerator(desc.source.descriptor);
        while (true) {
          const { value, done } = inner.next();
          if (done) break;
          if (this.isTruthy(this.force(desc.f.execute([value], this)))) yield value;
        }
        break;
      }
      case 'cons': {
        yield desc.head;
        const tailSrc = desc.tail;
        if (tailSrc instanceof LazyList) {
          yield* this.makeGenerator(tailSrc.descriptor);
        } else if (Array.isArray(tailSrc)) {
          yield* tailSrc;
        }
        break;
      }
      case 'drop': {
        const inner = this.makeGenerator(desc.source.descriptor);
        let skipped = 0;
        while (skipped < desc.n) {
          const { done } = inner.next();
          if (done) return;
          skipped++;
        }
        while (true) {
          const { value, done } = inner.next();
          if (done) break;
          yield value;
        }
        break;
      }
    }
  }

  private getCacheKey(fn: PfunFunction, args: any[]): string {
    return JSON.stringify(args, (key, value) =>
      typeof value === 'bigint' ? value.toString() + 'n' : value
    );
  }

  private isTruthy(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'bigint') return value !== 0n;
    if (typeof value === 'string') return value !== "";
    return true;
  }

  private stringify(value: any): string {
    if (value === null || value === undefined) return 'nil';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof LazyList) return '<lazylist>';
    if (value instanceof PfunDict) {
      const entries = [...value.entries.entries()]
        .map(([k, v]) => `${k.slice(2)} -> ${this.stringify(v)}`);
      return `dict { ${entries.join(', ')} }`;
    }
    if (Array.isArray(value)) return `[${value.map(v => this.stringify(v)).join(', ')}]`;
    if (value && value.__type) {
      const fields = Object.keys(value).filter(k => k !== '__type' && k !== '__union');
      if (fields.length === 0) return value.__type;
      return `${value.__type} { ${fields.map(f => this.stringify(value[f])).join(', ')} }`;
    }
    return String(value);
  }
}
