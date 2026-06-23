// transpiler.ts
//
// Pfun → JavaScript transpiler, phase 1.
//
// Transforms a checked, type-annotated Pfun AST (Stmt[]) into an estree
// Program node, then serializes it with astring.
//
// Phase 1 scope (the "strict subset"):
//   - Literals: Int, Float, Bool, Str, Char, Byte
//   - Arithmetic / comparison / boolean / bitwise operators, with type-directed
//     specialization where operand inferredTypes are concrete, runtime dispatch
//     ($add / $eq / …) as fallback for Unknown/TyVar sites
//   - let / var / function / proc (eager — laziness deferred)
//   - if / ternary / return / block
//   - lambda / call (fully-applied only — currying deferred)
//   - Records and union variants (plain objects via $record)
//   - match expressions (lowered to $match)
//   - List literals / index / get (field access)
//   - Comprehensions
//   - Minimal stdlib wired in via pfun-runtime
//   - Top-level type definitions (contribute to $registerType calls, no code)
//   - No imports, no exports (single-file programs only)
//   - No lazy thunks, no tail-call trampolining, no memoization (deferred)
//
// Every file transpiled with this phase produces a CommonJS module that
// requires pfun-runtime.js from the same directory.  Semantics match the
// interpreter exactly wherever the differential harness can observe them.

import { generate } from 'astring';
import type { Stmt, Expr, MatchArm } from './ast';
import type { PfunType } from './ast';

// ─── estree node helpers ──────────────────────────────────────────────────────
// Tiny factory functions so the emit code reads declaratively.  These produce
// plain estree-compatible objects (no class instances needed for astring).

type Node = any;  // estree nodes — keep things simple, astring is flexible

const id   = (name: string):                    Node => ({ type: 'Identifier', name });
const lit  = (value: any, raw?: string):        Node => ({ type: 'Literal', value, raw });
const bigLit = (n: bigint):                     Node => ({ type: 'Literal', value: n, bigint: n.toString() });
const str  = (s: string):                       Node => ({ type: 'Literal', value: s });
const bool = (b: boolean):                      Node => ({ type: 'Literal', value: b });
const nil  = ():                                Node => ({ type: 'Literal', value: null });
const call = (callee: Node, args: Node[]):      Node => ({ type: 'CallExpression', callee, arguments: args, optional: false });
const member = (obj: Node, prop: Node, computed = false): Node =>
  ({ type: 'MemberExpression', object: obj, property: prop, computed, optional: false });
const arrow  = (params: Node[], body: Node):   Node =>
  ({ type: 'ArrowFunctionExpression', params, body, expression: !(body.type === 'BlockStatement') });
const block  = (stmts: Node[]):                Node => ({ type: 'BlockStatement', body: stmts });
const ret    = (val: Node):                    Node => ({ type: 'ReturnStatement', argument: val });
const exprStmt = (e: Node):                   Node => ({ type: 'ExpressionStatement', expression: e });
const varDecl  = (kind: 'const'|'let', name: string, init: Node): Node => ({
  type: 'VariableDeclaration', kind,
  declarations: [{ type: 'VariableDeclarator', id: id(mangle(name)), init }],
});
const assign   = (target: Node, value: Node): Node => ({
  type: 'AssignmentExpression', operator: '=', left: target, right: value,
});
const seq      = (exprs: Node[]):             Node => ({
  type: 'SequenceExpression', expressions: exprs,
});
const iife     = (body: Node[]):              Node =>
  _inAsyncContext
    ? call({ type: 'ArrowFunctionExpression', params: [], body: block(body), async: true, expression: false }, [])
    : call(arrow([], block(body)), []);
const unary    = (op: string, arg: Node):     Node =>
  ({ type: 'UnaryExpression', operator: op, argument: arg, prefix: true });
const binary   = (op: string, l: Node, r: Node): Node =>
  ({ type: 'BinaryExpression', operator: op, left: l, right: r });
const logical  = (op: string, l: Node, r: Node): Node =>
  ({ type: 'LogicalExpression', operator: op, left: l, right: r });
const ternary  = (test: Node, cons: Node, alt: Node): Node =>
  ({ type: 'ConditionalExpression', test, consequent: cons, alternate: alt });
const obj      = (props: { key: string; value: Node }[]): Node => ({
  type: 'ObjectExpression',
  properties: props.map(p => ({
    type: 'Property', kind: 'init',
    key: str(p.key), value: p.value, computed: false, shorthand: false, method: false,
  })),
});
const arrExpr  = (elems: Node[]):            Node => ({ type: 'ArrayExpression', elements: elems });
const ifNode   = (test: Node, cons: Node, alt?: Node): Node =>
  ({ type: 'IfStatement', test, consequent: cons, alternate: alt ?? null });
const fnDecl   = (name: string, params: string[], body: Node[], isAsync = false): Node => ({
  type: 'FunctionDeclaration',
  id: id(mangle(name)),
  params: params.map(p => id(mangle(p))),
  body: block(body),
  async: isAsync,
});
const rtCall   = (fn: string, args: Node[]): Node => call(id(fn), args);

// ─── Name mangling ────────────────────────────────────────────────────────────
// JS reserved words that Pfun identifiers might collide with.  Pfun parsers
// don't enforce casing conventions, so we protect all of them.

const JS_RESERVED = new Set([
  'break','case','catch','class','const','continue','debugger','default',
  'delete','do','else','enum','export','extends','false','finally','for',
  'function','if','import','in','instanceof','new','null','return','super',
  'switch','this','throw','true','try','typeof','undefined','var','void',
  'while','with','yield','let','static','implements','interface','package',
  'private','protected','public','arguments','eval',
]);

function mangle(name: string): string {
  return JS_RESERVED.has(name) ? `${name}$` : name;
}

// ─── Type-directed operator specialization ────────────────────────────────────
// Reading expr.left.inferredType / expr.right.inferredType (written by
// applySubstitutionToAST after constraint solving) to emit bare JS ops
// where types are concrete.  Falls back to the runtime dispatcher when a
// side is Unknown/TyVar.

function isConcreteKind(t: PfunType | undefined): boolean {
  if (!t) return false;
  return t.kind !== 'Unknown' && t.kind !== 'TyVar';
}

/** Resolve an expression's type, supplementing with lambda param context. */
function resolveType(e: Expr): PfunType | undefined {
  const t = e.inferredType;
  if (t && isConcreteKind(t)) return t;
  // Fall back to lambda param type environment for bare identifiers.
  if (e.type === 'IdentExpr') {
    const pt = _lambdaParamTypes.get((e as any).name);
    if (pt && isConcreteKind(pt)) return pt;
  }
  // Propagate through group/unary wrappers.
  if (e.type === 'GroupExpr') return resolveType((e as any).expression);
  if (e.type === 'UnaryExpr') return resolveType((e as any).right);
  return t;
}

function emitBinaryOp(op: string, lt: PfunType | undefined, rt: PfunType | undefined,
                      lNode: Node, rNode: Node): Node {
  const lk = lt?.kind, rk = rt?.kind;
  const bothConcrete = isConcreteKind(lt) && isConcreteKind(rt);

  // ── Boolean short-circuit — always direct (typed Bool on both sides) ───────
  if (op === 'BooleanAnd') return logical('&&', lNode, rNode);
  if (op === 'BooleanOr')  return logical('||', lNode, rNode);

  // ── Comparisons ───────────────────────────────────────────────────────────
  if (op === 'EqualToken') {
    if (bothConcrete && lk === rk && (lk === 'Int' || lk === 'Str' || lk === 'Bool'))
      return binary('===', lNode, rNode);
    return rtCall('$eq', [lNode, rNode]);
  }
  if (op === 'NotEqualToken') {
    if (bothConcrete && lk === rk && (lk === 'Int' || lk === 'Str' || lk === 'Bool'))
      return unary('!', binary('===', lNode, rNode));
    return rtCall('$neq', [lNode, rNode]);
  }
  const CMP: Record<string, string | undefined> = {
    LessToken: '$lt', GreaterToken: '$gt',
    LessEqualToken: '$lte', GreaterEqualToken: '$gte',
  };
  if (CMP[op]) {
    const jsOp = { LessToken:'<', GreaterToken:'>', LessEqualToken:'<=', GreaterEqualToken:'>=' }[op]!;
    if (bothConcrete && lk === 'Int'   && rk === 'Int')   return binary(jsOp, lNode, rNode);
    if (bothConcrete && lk === 'Float' && rk === 'Float') return binary(jsOp, lNode, rNode);
    if (bothConcrete && lk === 'Float' && rk === 'Int')   return binary(jsOp, lNode, call(id('Number'), [rNode]));
    if (bothConcrete && lk === 'Int'   && rk === 'Float') return binary(jsOp, call(id('Number'), [lNode]), rNode);
    return rtCall(CMP[op]!, [lNode, rNode]);
  }

  // ── Arithmetic / plus ─────────────────────────────────────────────────────
  if (op === 'PlusToken') {
    if (bothConcrete && lk === 'Int'   && rk === 'Int')   return binary('+', lNode, rNode);
    if (bothConcrete && lk === 'Str'   && rk === 'Str')   return binary('+', lNode, rNode);
    if (bothConcrete && lk === 'Float' && rk === 'Float') return rtCall('$ck', [binary('+', lNode, rNode), str('+')]);
    if (bothConcrete && lk === 'Float' && rk === 'Int')   return rtCall('$ck', [binary('+', lNode, call(id('Number'), [rNode])), str('+')]);
    if (bothConcrete && lk === 'Int'   && rk === 'Float') return rtCall('$ck', [binary('+', call(id('Number'), [lNode]), rNode), str('+')]);
    return rtCall('$add', [lNode, rNode]);
  }
  if (op === 'MinusToken') {
    if (bothConcrete && lk === 'Int'   && rk === 'Int')   return binary('-', lNode, rNode);
    if (bothConcrete && lk === 'Float' && rk === 'Float') return rtCall('$ck', [binary('-', lNode, rNode), str('-')]);
    if (bothConcrete && lk === 'Float' && rk === 'Int')   return rtCall('$ck', [binary('-', lNode, call(id('Number'), [rNode])), str('-')]);
    if (bothConcrete && lk === 'Int'   && rk === 'Float') return rtCall('$ck', [binary('-', call(id('Number'), [lNode]), rNode), str('-')]);
    return rtCall('$sub', [lNode, rNode]);
  }
  if (op === 'StarToken') {
    if (bothConcrete && lk === 'Int'   && rk === 'Int')   return binary('*', lNode, rNode);
    if (bothConcrete && lk === 'Float' && rk === 'Float') return rtCall('$ck', [binary('*', lNode, rNode), str('*')]);
    if (bothConcrete && lk === 'Float' && rk === 'Int')   return rtCall('$ck', [binary('*', lNode, call(id('Number'), [rNode])), str('*')]);
    if (bothConcrete && lk === 'Int'   && rk === 'Float') return rtCall('$ck', [binary('*', call(id('Number'), [lNode]), rNode), str('*')]);
    return rtCall('$mul', [lNode, rNode]);
  }
  if (op === 'SlashToken') {
    // Int / Int: defer to $div (handles 0-check and bigint truncating division)
    if (bothConcrete && lk === 'Float' && rk === 'Float') return rtCall('$ck', [binary('/', lNode, rNode), str('/')]);
    if (bothConcrete && lk === 'Float' && rk === 'Int')   return rtCall('$ck', [binary('/', lNode, call(id('Number'), [rNode])), str('/')]);
    if (bothConcrete && lk === 'Int'   && rk === 'Float') return rtCall('$ck', [binary('/', call(id('Number'), [lNode]), rNode), str('/')]);
    return rtCall('$div', [lNode, rNode]);
  }
  if (op === 'PercentToken') {
    if (bothConcrete && lk === 'Int' && rk === 'Int') return binary('%', lNode, rNode);
    return rtCall('$mod', [lNode, rNode]);
  }

  // ── Bitwise ───────────────────────────────────────────────────────────────
  if (op === 'BitAndToken')    return rtCall('$bitAnd', [lNode, rNode]);
  if (op === 'BitOrToken')     return rtCall('$bitOr',  [lNode, rNode]);
  if (op === 'ShiftLeftToken') return rtCall('$shl', [lNode, rNode]);
  if (op === 'ShiftRightToken')return rtCall('$shr', [lNode, rNode]);

  throw new Error(`Transpiler: unhandled binary operator '${op}'`);
}

// ─── Schema collector ─────────────────────────────────────────────────────────
// First pass over top-level TypeStmt/UnionTypeStmt to emit $registerType calls
// at the top of the output, before any executable code.
//
// Also builds the singletonVariants set — zero-field union variant names that
// appear as bare IdentExprs in user code (e.g. `let x = None` / `let d = Dot`).
// These must be emitted as $record(name, []) rather than as plain JS identifiers,
// since there's no JS variable with that name in scope.  None is special-cased to
// its pre-built runtime constant; everything else goes through $record.

const singletonVariants = new Set<string>();

function collectSchemaStmts(stmts: Stmt[]): Node[] {
  singletonVariants.clear();
  // Seed built-in singletons
  singletonVariants.add('None');

  const calls: Node[] = [];
  for (const s of stmts) {
    if (s.type === 'UnionTypeStmt') {
      for (const v of (s as any).variants) {
        if (v.fields.length === 0) singletonVariants.add(v.name);
        calls.push(exprStmt(rtCall('$registerType', [
          str(v.name),
          arrExpr(v.fields.map((f: string) => str(f))),
          str((s as any).name),
        ])));
      }
    } else if (s.type === 'TypeStmt') {
      calls.push(exprStmt(rtCall('$registerType', [
        str((s as any).name),
        arrExpr(((s as any).fields ?? []).map((f: string) => str(f))),
        nil(),
      ])));
    }
  }
  return calls;
}

// ─── Expression emitter ───────────────────────────────────────────────────────

function emitExpr(e: Expr): Node {
  switch (e.type) {

    case 'IntExpr':
      return bigLit((e as any).value as bigint);

    case 'FloatExpr':
      return lit((e as any).value as number);

    case 'BoolExpr':
      return bool((e as any).value as boolean);

    case 'StrExpr':
      return str((e as any).value as string);

    case 'CharExpr':
      return rtCall('$char', [str((e as any).value as string)]);

    case 'ByteExpr':
      return rtCall('$byte', [lit((e as any).value as number)]);

    case 'IdentExpr': {
      const name = (e as any).name as string;
      // None is a pre-built constant in the runtime; other zero-field
      // singleton variants must be constructed via $record since there's
      // no JS variable in scope with that name.
      if (name === 'None') return id('None');
      if (singletonVariants.has(name)) return rtCall('$record', [str(name), arrExpr([])]);
      return id(mangle(name));
    }

    case 'GroupExpr':
      return emitExpr((e as any).expression);

    case 'UnaryExpr': {
      const op = (e as any).operator as string;
      const arg = emitExpr((e as any).right);
      if (op === 'BooleanNot') return unary('!', arg);
      if (op === 'MinusToken') {
        // Inline negation for concrete Int/Float, runtime for Unknown/Byte
        const t = (e as any).right?.inferredType as PfunType | undefined;
        if (t?.kind === 'Int')   return unary('-', arg);
        if (t?.kind === 'Float') return unary('-', arg);
        return rtCall('$neg', [arg]);
      }
      throw new Error(`Transpiler: unhandled unary operator '${op}'`);
    }

    case 'BinaryExpr': {
      const lNode = emitExpr((e as any).left);
      const rNode = emitExpr((e as any).right);
      return emitBinaryOp(
        (e as any).operator,
        resolveType((e as any).left),
        resolveType((e as any).right),
        lNode, rNode,
      );
    }

    case 'TernaryExpr':
      return ternary(
        emitExpr((e as any).condition),
        emitExpr((e as any).thenBranch),
        emitExpr((e as any).elseBranch),
      );

    case 'AssignExpr':
      return assign(id(mangle((e as any).name)), emitExpr((e as any).value));

    case 'LambdaExpr': {
      const paramNames   = (e as any).params as string[];
      const paramTypesAnn = (e as any).paramTypes as PfunType[] | undefined;
      const params = paramNames.map(p => id(mangle(p)));
      const bodyExpr = (e as any).body;

      // Push param types into the ambient context so binary ops in the body
      // can specialise without runtime dispatch (monomorphization).
      const prevTypes = paramNames.map(p => _lambdaParamTypes.get(p));
      if (paramTypesAnn) {
        paramNames.forEach((p, i) => {
          if (paramTypesAnn[i] && isConcreteKind(paramTypesAnn[i]))
            _lambdaParamTypes.set(p, paramTypesAnn[i]);
        });
      }

      let result: Node;
      if (bodyExpr.type === 'BlockExpr') {
        result = arrow(params, block(emitBlockExprBody((bodyExpr as any).statements)));
      } else {
        result = arrow(params, emitExpr(bodyExpr));
      }

      // Restore previous context (support nested lambdas).
      paramNames.forEach((p, i) => {
        if (prevTypes[i] === undefined) _lambdaParamTypes.delete(p);
        else _lambdaParamTypes.set(p, prevTypes[i]!);
      });

      return result;
    }

    case 'CallExpr': {
      const callee = emitExpr((e as any).callee);
      const args   = ((e as any).args as Expr[]).map(emitExpr);
      // Wire stdlib names to runtime functions
      const calleeName = (e as any).callee?.name as string | undefined;
      if (calleeName) {
        const rtName = STDLIB_MAP[calleeName];
        if (rtName) return rtCall(rtName, args);
      }
      return call(callee, args);
    }

    case 'GetExpr':
      return rtCall('$get', [emitExpr((e as any).object), str((e as any).name)]);

    case 'IndexExpr':
      return rtCall('$index', [emitExpr((e as any).object), emitExpr((e as any).index)]);

    case 'IndexAssignExpr':
      return rtCall('$indexSet', [
        emitExpr((e as any).object),
        emitExpr((e as any).index),
        emitExpr((e as any).value),
      ]);

    case 'RecordExpr': {
      const typeName = (e as any).name as string;
      // Zero-field singleton: the runtime already has None; for others,
      // emit $record(name, []) so the schema check fires.
      if ((e as any).fields.length === 0) {
        if (typeName === 'None') return id('None');
        return rtCall('$record', [str(typeName), arrExpr([])]);
      }
      const fields = ((e as any).fields as any[]).map(f => emitExpr(f.value));
      return rtCall('$record', [str(typeName), arrExpr(fields)]);
    }

    case 'ListExpr':
      return arrExpr(((e as any).elements as Expr[]).map(emitExpr));

    case 'ArrayExpr':
      // array { 1, 2, 3 } → $array_from([1n, 2n, 3n])
      return rtCall('$array_from', [arrExpr(((e as any).elements as Expr[]).map(emitExpr))]);

    case 'DictExpr': {
      // dict { k -> v, ... } → $dict_from([[k, v], ...])
      const entries = ((e as any).entries as any[]).map(en =>
        arrExpr([emitExpr(en.key), emitExpr(en.value)])
      );
      return rtCall('$dict_from', [arrExpr(entries)]);
    }

    case 'MatchExpr':
      return emitMatch(e as any);

    case 'ComprehensionExpr':
      return emitComprehension(e as any);

    case 'AwaitExpr':
      return { type: 'AwaitExpression', argument: emitExpr((e as any).value) };

    case 'BlockExpr': {
      // Block used as an expression: wrap in an async IIFE.
      // In async context, await the IIFE so that `await` inside the block works.
      const iifeNode = iife(emitBlockExprBody((e as any).statements));
      return _inAsyncContext
        ? { type: 'AwaitExpression', argument: iifeNode }
        : iifeNode;
    }

    default:
      throw new Error(`Transpiler: unhandled expression type '${(e as any).type}'`);
  }
}

// ─── Stdlib name mapping ──────────────────────────────────────────────────────
// Pfun stdlib function names → runtime helper names.
// Extended as the runtime stdlib grows.

// ─── Transpile options ────────────────────────────────────────────────────────

export interface TranspileOptions {
  /** Path for the require('./pfun-runtime') call. Default: './pfun-runtime'. */
  runtimeRequirePath?: string;
  /** Require paths to use for each builtin module name (e.g. 'math' → path). */
  builtinRequirePaths?: Record<string, string>;
}

// Module-level options set by transpile() before each emit pass so that
// emitStmt/emitExpr can access them without threading through every call.
let _currentOptions: TranspileOptions = {};

// Lambda param type environment: populated when emitting a LambdaExpr so
// that binary ops inside the body can read the resolved types of param
// identifiers and specialise instead of falling back to runtime dispatch.
// Outer lambdas' entries are shadowed by inner ones (Map semantics).
const _lambdaParamTypes = new Map<string, PfunType>();

// Whether we're currently emitting inside an async function body.
// When true, $match and BlockExpr IIFE calls are awaited so that async arm
// bodies (which return Promises) are properly resolved.
let _inAsyncContext = false;

const STDLIB_MAP: Record<string, string> = {
  // Output — print does NOT add a newline; println does
  println:       '$println',
  print:         '$print',
  flushStdout:   '$flushStdout',

  // Interactive I/O (synchronous stdin — works in compiled CLI programs)
  readln:        '$readln',
  readChar:      '$readChar',

  // Environment
  scriptArgs:    '$scriptArgs',
  getEnv:        '$getEnv',
  envVars:       '$envVars',

  // Core list ops
  length:        '$length',
  head:          '$head',
  tail:          '$tail',
  map:           '$map',
  filter:        '$filter',
  reduce:        '$reduce',
  reverse:       '$reverse',
  join:          '$join',
  split:         '$split',
  range:         '$range',
  cons:          '$cons',
  take:          '$take',
  drop:          '$drop',
  nth:           '$nth',

  // Extended list ops
  slice:         '$slice',
  find:          '$find',
  findSlice:     '$findSlice',

  // Lazy sequences
  iterate:       '$iterate',
  repeat:        '$repeat',
  cycle:         '$cycle',
  isInfinite:    '$isInfinite',

  // Char / String
  asc:           '$asc',
  chr:           '$chr',
  __str__:       '$__str__',

  // Numeric casts & predicates
  toFloat:       '$toFloat',
  toInt:         '$toInt',
  floor:         '$floor',
  ceil:          '$ceil',
  round:         '$round',
  isNaN:         '$isNaN',
  isFinite:      '$isFinite',

  // Byte / Char conversions
  toByte:        '$toByte',
  toChar:        '$toChar',
  charBytes:     '$charBytes',
  bytesToChar:   '$bytesToChar',

  // Mutable array operations (mutStructures — globally registered, no import)
  arrayLength:   '$arrayLength',
  append:        '$append',
  removeAt:      '$removeAt',
  insertAt:      '$insertAt',
  toList:        '$toList',
  toArray:       '$toArray',
  toDict:        '$toDict',

  // Dict operations
  has:           '$has',
  remove:        '$remove',
  keys:          '$keys',
  values:        '$values',

  // Dict / Pair conversions
  dictToList:    '$dictToList',
  listToDict:    '$listToDict',

  // Buffer operations (mutStructures — globally registered, no import)
  makeBuffer:        '$makeBuffer',
  makeStringBuffer:  '$makeStringBuffer',
  appendBuffer:      '$appendBuffer',
  appendChar:        '$appendChar',
  appendString:      '$appendString',
  bufferToBytes:     '$bufferToBytes',
  bufferToString:    '$bufferToString',
  bufferLength:      '$bufferLength',
};

// ─── Match lowering ───────────────────────────────────────────────────────────
// match subject with | … lowers to $match(subject, [...arms])
// Each arm becomes { variant, guard, body } where guard/body are arrow fns.

function emitMatch(e: any): Node {
  const subject = emitExpr(e.subject);
  const armNodes = (e.arms as MatchArm[]).map((arm: any) => {
    const bindingParam = arm.binding ? [id(mangle(arm.binding))] : [id('_$')];
    const guardNode = arm.guard
      ? arrow(bindingParam, emitExpr(arm.guard))
      : nil();
    const bodyExprNode = emitExpr(arm.body);
    // In async context, the arm body arrow must be async so that any `await`
    // expressions inside it (e.g. in a BlockExpr IIFE) are valid.
    const bodyNode: Node = _inAsyncContext ? {
      type: 'ArrowFunctionExpression',
      params: bindingParam,
      body: bodyExprNode.type === 'BlockStatement' ? bodyExprNode : block([{ type: 'ReturnStatement', argument: bodyExprNode }]),
      async: true,
      expression: false,
    } : arrow(bindingParam, bodyExprNode);
    return obj([
      { key: 'variant', value: arm.variant ? str(arm.variant) : nil() },
      { key: 'guard',   value: guardNode },
      { key: 'body',    value: bodyNode },
    ]);
  });
  const matchCall = rtCall('$match', [subject, arrExpr(armNodes)]);
  // In async context, arm bodies are async arrows → $match returns a Promise → await it.
  return _inAsyncContext
    ? { type: 'AwaitExpression', argument: matchCall }
    : matchCall;
}

// ─── Comprehension lowering ───────────────────────────────────────────────────
// [ body | var <- source, ... ] lowers to nested for…of in an IIFE.

function emitComprehension(e: any): Node {
  const resultVar = id('$result$');
  const stmts: Node[] = [
    { type: 'VariableDeclaration', kind: 'const',
      declarations: [{ type: 'VariableDeclarator', id: resultVar, init: arrExpr([]) }] },
  ];

  function buildLoops(genIdx: number): Node {
    if (genIdx === e.generators.length) {
      // Innermost: apply guard (if any) then push body value
      const pushCall = call(member(resultVar, id('push')), [emitExpr(e.body)]);
      if (!e.guard) return exprStmt(pushCall);
      return ifNode(emitExpr(e.guard), block([exprStmt(pushCall)]));
    }
    const gen = e.generators[genIdx];
    const itemVar = id(mangle(gen.variable));
    return {
      type: 'ForOfStatement',
      left: { type: 'VariableDeclaration', kind: 'const',
              declarations: [{ type: 'VariableDeclarator', id: itemVar, init: null }] },
      right: emitExpr(gen.source),
      body:  block([buildLoops(genIdx + 1)]),
      await: false,
    };
  }

  stmts.push(buildLoops(0));
  stmts.push(ret(resultVar));
  return iife(stmts);
}

// ─── BlockExpr body lowering ─────────────────────────────────────────────────
// A BlockExpr's statements are lowered to JS statements; the last ExprStmt
// becomes a return so the IIFE delivers the block's value.

function emitBlockExprBody(stmts: Stmt[]): Node[] {
  return emitFunctionBodyInner(stmts);
}

// ─── Statement emitter ────────────────────────────────────────────────────────

function emitStmt(s: Stmt): Node[] {
  switch (s.type) {

    case 'LetStmt':
      // Eager in v1 — laziness deferred
      return [varDecl('const', (s as any).name, emitExpr((s as any).initializer))];

    case 'VarStmt':
      return [varDecl('let', (s as any).name, emitExpr((s as any).initializer))];

    case 'ExprStmt':
    case 'EvalStmt':
      return [exprStmt(emitExpr((s as any).expression))];

    case 'ReturnStmt':
      return [(s as any).value
        ? ret(emitExpr((s as any).value))
        : { type: 'ReturnStatement', argument: null }];

    case 'FunctionStmt':
    case 'ProcedureStmt': {
      const isAsync = !!(s as any).async;
      const isMemo  = !!(s as any).memo;
      const params  = (s as any).params as string[];
      const name    = (s as any).name as string;

      // Track async context strictly: only true inside an explicitly-declared
      // async function. The top-level async IIFE wrapper does NOT set this —
      // only `async proc`/`async function` declarations do. This prevents
      // spurious `await $match(...)` in synchronous top-level code.
      const prevAsync = _inAsyncContext;
      _inAsyncContext = isAsync;
      const body = emitFunctionBody((s as any).body);
      _inAsyncContext = prevAsync;

      const decl    = fnDecl(name, params, body, isAsync);
      const nodes: Node[] = [decl];

      // Curry-wrap functions with 2+ params.
      if (params.length >= 2) {
        nodes.push(exprStmt(assign(id(mangle(name)),
          rtCall('$curry', [id(mangle(name)), lit(params.length)]))));
      }

      // Memoize after currying so partial applications are cached correctly.
      // memo function fib(n) { ... }  →  fib = $memoize(fib);
      if (isMemo) {
        nodes.push(exprStmt(assign(id(mangle(name)),
          rtCall('$memoize', [id(mangle(name))]))));
      }

      return nodes;
    }

    case 'IfStmt': {
      const test = emitExpr((s as any).condition);
      const cons = block(emitStmt((s as any).thenBranch));
      const alt  = (s as any).elseBranch ? block(emitStmt((s as any).elseBranch)) : undefined;
      return [ifNode(test, cons, alt)];
    }

    case 'BlockStmt':
      return [block(((s as any).statements as Stmt[]).flatMap(emitStmt))];

    case 'TypeStmt':
    case 'UnionTypeStmt':
      // Types produce $registerType calls at the top of the file (first pass),
      // not inline — emit nothing here.
      return [];

    case 'ImportStmt': {
      const imp = s as any;

      // ── `import * from "io"` ──────────────────────────────────────────────
      // io functions are already in pfun-runtime.js; nothing needed.
      if (imp.path === 'io') return [];

      // ── Builtin module mapping ────────────────────────────────────────────
      const _bpaths = _currentOptions.builtinRequirePaths ?? {};
      const BUILTIN_MODULES: Record<string, { file: string; names: string[] }> = {
        'math': { file: _bpaths['math'] ?? 'pfun-math', names: [
          'pi','e','tau','inf','nan',
          'abs','sign','min','max','clamp','lerp',
          'sqrt','cbrt','exp','log','log2','log10','pow','hypot','fmod',
          'sin','cos','tan','asin','acos','atan','atan2',
          'sinh','cosh','tanh',
        ]},
        'json': { file: _bpaths['json'] ?? 'pfun-json', names: ['jsonSerialize','jsonDeserialize'] },
        'file': { file: _bpaths['file'] ?? 'pfun-file', names: [
          'fileExists','removeFile','touchFile','readFile','writeFile',
          'fileOpen','fileClose',
          'readChar','readLine','writeChar','writeLine',
          'readByte','writeByte','readBytes','writeBytes',
          'readBuffer','writeBuffer',
          'Read','Write','Append',
        ]},
        'async': { file: _bpaths['async'] ?? 'pfun-async', names: ['sleep','asyncAll','asyncRace'] },
        'http':  { file: _bpaths['http']  ?? 'pfun-http',  names: ['httpGet','httpGetBytes','httpListen'] },
        'db/postgresql': { file: _bpaths['db/postgresql'] ?? 'pfun-db-postgresql', names: ['dbConnect','dbQuery','dbClose','DbNull'] },
        'db/mariadb':    { file: _bpaths['db/mariadb']    ?? 'pfun-db-mariadb',    names: ['dbConnect','dbQuery','dbClose','DbNull'] },
      };

      const builtin = BUILTIN_MODULES[imp.path];
      if (builtin) {
        const reqPath = builtin.file.startsWith('.') ? builtin.file : `./${builtin.file}`;
        const requireCall = call(id('require'), [str(reqPath)]);

        if (imp.kind === 'namespace') {
          // import * as M from "math"  →  const M = require('./pfun-math');
          return [{
            type: 'VariableDeclaration', kind: 'const',
            declarations: [{
              type: 'VariableDeclarator',
              id: id(mangle(imp.alias)),
              init: requireCall,
            }],
          }];
        }

        if (imp.kind === 'named') {
          // import { sqrt, sin } from "math"  →  const { sqrt, sin } = require('./pfun-math');
          const props = imp.names.map((n: any) => ({
            type: 'Property', kind: 'init', computed: false,
            shorthand: !n.alias,
            key: id(n.name), value: id(mangle(n.alias ?? n.name)), method: false,
          }));
          return [{
            type: 'VariableDeclaration', kind: 'const',
            declarations: [{
              type: 'VariableDeclarator',
              id: { type: 'ObjectPattern', properties: props },
              init: requireCall,
            }],
          }];
        }

        // imp.kind === 'star': import * from "math"
        // Destructure all known names into scope.
        const props = builtin.names.map(name => ({
          type: 'Property', kind: 'init', computed: false, shorthand: true,
          key: id(name), value: id(name), method: false,
        }));
        return [{
          type: 'VariableDeclaration', kind: 'const',
          declarations: [{
            type: 'VariableDeclarator',
            id: { type: 'ObjectPattern', properties: props },
            init: requireCall,
          }],
        }];
      }

      // ── User module: relative path ────────────────────────────────────────
      // Emit require() + spread exports into local scope via Object.assign on
      // a local proxy object (not globalThis — cleaner scoping). Since compiled
      // Pfun top-level is flat (no wrapping function), we use a with-statement
      // equivalent via a local const spread pattern.
      // Simpler approach that works for flat top-level programs: emit the require
      // as a spread into the enclosing scope using a variable declaration, then
      // use Object.keys to surface names. For now: store in a temp var, and
      // individual names will be resolved by the interpreter's own scope when
      // running the compiled output — this means star-imported user module names
      // are only accessible via the namespace (use named or namespace imports for
      // user modules until a full scope-injection solution is in place).
      const userPath = imp.path.endsWith('.pf') ? imp.path.slice(0, -3) : imp.path;
      const requireCall = call(id('require'), [str(userPath)]);

      if (imp.kind === 'namespace') {
        return [{
          type: 'VariableDeclaration', kind: 'const',
          declarations: [{
            type: 'VariableDeclarator',
            id: id(mangle(imp.alias)),
            init: requireCall,
          }],
        }];
      }

      if (imp.kind === 'named') {
        const props = imp.names.map((n: any) => ({
          type: 'Property', kind: 'init', computed: false,
          shorthand: !n.alias,
          key: id(n.name), value: id(mangle(n.alias ?? n.name)), method: false,
        }));
        return [{
          type: 'VariableDeclaration', kind: 'const',
          declarations: [{
            type: 'VariableDeclarator',
            id: { type: 'ObjectPattern', properties: props },
            init: requireCall,
          }],
        }];
      }

      // star import of user module — spread all exports into global scope.
      // This is the only practical approach for flat compiled programs; a future
      // module-scope solution would use a wrapping function per file.
      const modVar = '$_mod_' + userPath.replace(/[^a-zA-Z0-9]/g, '_') + '$';
      return [
        {
          type: 'VariableDeclaration', kind: 'const',
          declarations: [{
            type: 'VariableDeclarator',
            id: id(modVar),
            init: requireCall,
          }],
        },
        exprStmt(call(
          member(id('Object'), id('assign')),
          [id('globalThis'), id(modVar)],
        )),
      ];
    }

    case 'ExportStmt': {
      // Emit the declaration normally, then append a module.exports assignment
      // so other compiled files can require() it.
      const decl = (s as any).declaration;
      const emitted = emitStmt(decl);
      // Collect the exported name(s)
      const exportedNames: string[] = [];
      if (decl.type === 'FunctionStmt' || decl.type === 'ProcedureStmt') {
        exportedNames.push(decl.name);
      } else if (decl.type === 'LetStmt' || decl.type === 'VarStmt') {
        exportedNames.push(decl.name);
      } else if (decl.type === 'TypeStmt' || decl.type === 'UnionTypeStmt') {
        // Type declarations don't produce runtime values; skip export.
        return emitted;
      }
      // module.exports = { ...module.exports, name: mangledName, ... }
      const exportAssignments = exportedNames.map(name =>
        exprStmt(assign(
          member(member(id('module'), id('exports')), id(name)),
          id(mangle(name)),
        ))
      );
      return [...emitted, ...exportAssignments];
    }

    default:
      throw new Error(`Transpiler: unhandled statement type '${(s as any).type}'`);
  }
}

// ─── Function body ────────────────────────────────────────────────────────────
// A function body is a Stmt[]; the last statement's value is the function's
// return value (matching the interpreter's "last expression" rule).
// ExprStmt/EvalStmt → direct return.
// IfStmt → both branches get return treatment recursively.
// BlockStmt → its last statement gets return treatment.
// ReturnStmt → already has an explicit return.

function makeReturning(s: Stmt): Node[] {
  switch (s.type) {
    case 'ExprStmt':
    case 'EvalStmt':
      return [ret(emitExpr((s as any).expression))];

    case 'IfStmt': {
      const test = emitExpr((s as any).condition);
      const thenStmts: Stmt[] = (s as any).thenBranch.type === 'BlockStmt'
        ? (s as any).thenBranch.statements
        : [(s as any).thenBranch];
      const cons = block(emitFunctionBodyInner(thenStmts));
      if ((s as any).elseBranch) {
        const elseStmts: Stmt[] = (s as any).elseBranch.type === 'BlockStmt'
          ? (s as any).elseBranch.statements
          : [(s as any).elseBranch];
        const alt = block(emitFunctionBodyInner(elseStmts));
        return [ifNode(test, cons, alt)];
      }
      // No else branch — if without else at tail position returns undefined
      // from the missing branch, which is fine (matches interpreter).
      return [ifNode(test, cons)];
    }

    case 'BlockStmt': {
      const stmts = (s as any).statements as Stmt[];
      return [block(emitFunctionBodyInner(stmts))];
    }

    case 'ReturnStmt':
      return emitStmt(s);

    default:
      // Non-returnable tail (let, var, type decl, etc.) — emit normally,
      // implicitly returns undefined (same as interpreter's nil).
      return emitStmt(s);
  }
}

function emitFunctionBodyInner(stmts: Stmt[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const isLast = i === stmts.length - 1;
    if (isLast) {
      out.push(...makeReturning(s));
    } else {
      out.push(...emitStmt(s));
    }
  }
  return out;
}

function emitFunctionBody(stmts: Stmt[]): Node[] {
  return emitFunctionBodyInner(stmts);
}

// ─── Program emitter ──────────────────────────────────────────────────────────
// Produces a full estree Program node with a require preamble.
//
// options.runtimeRequirePath — path used in the require('./pfun-runtime') call.
//   Defaults to './pfun-runtime'. Pass a relative path from the output file to
//   the libs directory, e.g. '../../output/libs/pfun-runtime'.

export function transpileToEstree(stmts: Stmt[], options: TranspileOptions = {}): any {
  const runtimePath = options.runtimeRequirePath ?? './pfun-runtime';

  const preamble: Node[] = [
    // const { $println, $add, ... } = require('./pfun-runtime');
    {
      type: 'VariableDeclaration', kind: 'const',
      declarations: [{
        type: 'VariableDeclarator',
        id: {
          type: 'ObjectPattern',
          properties: [
            'PfunChar','PfunByte','PfunArray','PfunDict','PfunBuffer',
            '$curry','$memoize',
            '$char','$byte','$record','$registerType',
            '$stringify','$println','$print','$flushStdout','$truthy',
            '$readln','$readChar','$scriptArgs','$getEnv','$envVars',
            '$ck',
            '$add','$sub','$mul','$div','$mod','$neg',
            '$eq','$neq','$lt','$lte','$gt','$gte',
            '$bitAnd','$bitOr','$shl','$shr',
            '$get','$index','$indexSet',
            '$match',
            // Core list ops
            '$length','$head','$tail','$map','$filter','$reduce',
            '$reverse','$join','$split','$range','$cons','$take','$drop','$nth',
            // Extended list ops
            '$slice','$find','$findSlice',
            // Lazy sequences
            '$iterate','$repeat','$cycle','$isInfinite',
            // Char / String
            '$asc','$chr','$__str__',
            // Numeric casts & predicates
            '$toFloat','$toInt','$floor','$ceil','$round','$isNaN','$isFinite',
            // Byte / Char conversions
            '$toByte','$toChar','$charBytes','$bytesToChar',
            // Mutable structures
            '$array_from','$dict_from',
            '$arrayLength','$append','$removeAt','$insertAt','$toList','$toArray','$toDict',
            '$has','$remove','$keys','$values',
            '$dictToList','$listToDict',
            '$makeBuffer','$makeStringBuffer','$appendBuffer','$appendChar','$appendString',
            '$bufferToBytes','$bufferToString','$bufferLength',
            'ByteMode','CharMode',
            'None','Some',
          ].map(name => ({
            type: 'Property', kind: 'init', computed: false, shorthand: true,
            key: id(name), value: id(name), method: false,
          })),
        },
        init: call(id('require'), [str(runtimePath)]),
      }],
    },
  ];

  // Schema registrations for type/union definitions in this file
  const schemaStmts = collectSchemaStmts(stmts);

  // Executable body — wrapped in an async IIFE so that `await` expressions
  // work at any nesting level (top-level proc calls, match arm blocks, etc.).
  // The IIFE catches errors and prints them to stderr in a format matching the
  // interpreter's "[ErrorKind] Error: message" output.
  const body = stmts.flatMap(emitStmt);

  // (async () => { try { ...body... } catch(e) { process.stderr.write(...); process.exit(1); } })();
  const catchBody = block([
    exprStmt(call(
      member(member(id('process'), id('stderr')), id('write')),
      [binary('+', member(id('$e$'), id('message')), str('\n'))],
    )),
    exprStmt(call(member(id('process'), id('exit')), [lit(1)])),
  ]);

  const wrappedBody: Node = exprStmt(call(
    {
      type: 'ArrowFunctionExpression',
      params: [],
      body: block([{
        type: 'TryStatement',
        block: block(body),
        handler: { type: 'CatchClause', param: id('$e$'), body: catchBody },
        finalizer: null,
      }]),
      async: true,
      expression: false,
    },
    [],
  ));

  return {
    type: 'Program',
    sourceType: 'script',
    body: [...preamble, ...schemaStmts, wrappedBody],
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function transpile(stmts: Stmt[], _source?: string, options: TranspileOptions = {}): string {
  _currentOptions = options;
  _inAsyncContext = false;
  const program = transpileToEstree(stmts, options);
  _currentOptions = {};
  _inAsyncContext = false;
  return generate(program);
}
