
// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { jsonlibFunctions } from './jsonlib';
import { PfunError, buildPfunError } from './errors';
import { inferTypes, checkTypes } from './typechecker';
import { Stmt, Expr } from './ast';

/**
 * Sets up a fresh interpreter with the core standard library.
 * IO functions are NOT included here — scripts must: import * from 'io';
 */
function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
}

// ─── AST walker — collect all MatchExpr nodes ────────────────────────────────

function collectMatchExprs(stmts: Stmt[]): Array<{ expr: any; source: string }> {
  const results: Array<{ expr: any; source: string }> = [];

  function walkExpr(e: Expr): void {
    if (!e) return;
    switch (e.type) {
      case 'MatchExpr':
        results.push({ expr: e, source: '' });
        walkExpr(e.subject);
        for (const arm of e.arms) walkExpr(arm.body);
        break;
      case 'BinaryExpr':   walkExpr(e.left); walkExpr(e.right); break;
      case 'UnaryExpr':    walkExpr(e.right); break;
      case 'GroupExpr':    walkExpr(e.expression); break;
      case 'TernaryExpr':  walkExpr(e.condition); walkExpr(e.thenBranch); walkExpr(e.elseBranch); break;
      case 'CallExpr':     walkExpr(e.callee); e.args.forEach(walkExpr); break;
      case 'LambdaExpr':   walkExpr(e.body); break;
      case 'ListExpr':     e.elements.forEach(walkExpr); break;
      case 'RecordExpr':   e.fields.forEach(f => walkExpr(f.value)); break;
      case 'GetExpr':      walkExpr(e.object); break;
      case 'AssignExpr':   walkExpr(e.value); break;
      case 'IndexExpr':    walkExpr(e.object); walkExpr(e.index); break;
      case 'IndexAssignExpr': walkExpr(e.object); walkExpr(e.index); walkExpr(e.value); break;
      case 'ComprehensionExpr':
        e.generators.forEach(g => walkExpr(g.source));
        if (e.guard) walkExpr(e.guard);
        walkExpr(e.body);
        break;
      case 'BlockExpr':    e.statements.forEach(walkStmt); break;
      case 'DictExpr':     e.entries.forEach(en => { walkExpr(en.key); walkExpr(en.value); }); break;
      case 'ArrayExpr':    e.elements.forEach(walkExpr); break;
    }
  }

  function walkStmt(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExprStmt':
      case 'EvalStmt':     walkExpr(s.expression); break;
      case 'LetStmt':
      case 'VarStmt':      walkExpr(s.initializer); break;
      case 'ReturnStmt':   if (s.value) walkExpr(s.value); break;
      case 'IfStmt':       walkExpr(s.condition); walkStmt(s.thenBranch); if (s.elseBranch) walkStmt(s.elseBranch); break;
      case 'BlockStmt':    s.statements.forEach(walkStmt); break;
      case 'FunctionStmt':
      case 'ProcedureStmt': s.body.forEach(walkStmt); break;
      case 'ExportStmt':   walkStmt(s.declaration); break;
    }
  }

  for (const s of stmts) walkStmt(s);
  return results;
}

function runFile(filePath: string) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const baseDir = path.dirname(absolutePath);
  const loader  = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);

  // Register built-in system modules
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('file', filelibFunctions, filelibTypes);
  loader.registerBuiltin('json', jsonlibFunctions);

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

  // ── Type inference pass ─────────────────────────────────────────────────
  // inferTypes annotates the AST (needed for seeding and exhaustiveness).
  // checkTypes collects HM unification errors — surfaced as warnings since
  // currying and string coercion are not yet fully modelled.
  inferTypes(ast!);
  const hmErrors = checkTypes(ast!, source);
  for (const err of hmErrors) {
    console.warn(err.pfunMessage.replace('[TypeCheck]', '[TypeWarn]'));
  }

  // ── Collect compile-time errors ──────────────────────────────────────────
  const matchNodes = collectMatchExprs(ast!);
  const typeErrors: PfunError[] = [];

  for (const { expr } of matchNodes) {
    if (expr.missingVariants && expr.missingVariants.length > 0) {
      // Determine the union name from the subject's inferred type
      const subjectType = expr.subject?.inferredType;
      const unionName = subjectType?.unionName ?? subjectType?.name ?? 'unknown';
      const missing = expr.missingVariants.map((v: string) => `'${v}'`).join(', ');
      const message = `Non-exhaustive match on '${unionName}': missing arm(s) for ${missing}.`;
      const raw = Object.assign(new Error(message), { pos: expr.pos });
      typeErrors.push(buildPfunError(raw, source, expr.pos, expr, () => undefined, { stringify: String }));
    }
  }

  if (typeErrors.length > 0) {
    for (const err of typeErrors) console.error(err.pfunMessage);
    process.exit(1);
  }

  // ── Interpret ────────────────────────────────────────────────────────────
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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: pfun <script.pf>');
  process.exit(1);
}

runFile(args[0]);
