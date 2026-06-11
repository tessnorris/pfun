// src/main.ts
//
// Usage:
//   pfun script.pf       run a script
//   pfun -i              start the interactive REPL
//   pfun -i script.pf    load a script then drop into the REPL

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader, PfunFunction, PfunChar, LazyList, PfunDict, PfunArray, NativeFunction } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { PfunError, buildPfunError } from './errors';
import { Stmt } from './ast';

// ─── Interpreter setup ────────────────────────────────────────────────────────

function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
}

function makeInterpreter(baseDir: string): { interp: Interpreter; loader: ModuleLoader } {
  const loader = new ModuleLoader(path.join(baseDir, 'lib'), setupInterpreter);
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('file', filelibFunctions, filelibTypes);
  const interp = new Interpreter(baseDir, loader);
  setupInterpreter(interp);
  return { interp, loader };
}

// ─── Script runner ────────────────────────────────────────────────────────────

function runFile(filePath: string, interp: Interpreter): boolean {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    return false;
  }
  const source = fs.readFileSync(absolutePath, 'utf-8');
  let ast;
  try {
    ast = new Parser(new Lexer(source).lex()).parse();
  } catch (e) {
    const raw = e instanceof Error ? e : new Error(String(e));
    const pfunErr = buildPfunError(raw, source, (raw as any).pos, null, () => undefined, { stringify: String });
    console.error(pfunErr.pfunMessage);
    return false;
  }
  try {
    interp.interpret(ast!, source);
  } catch (e) {
    if (e instanceof PfunError) console.error(e.pfunMessage);
    else console.error(interp.wrapError(e).pfunMessage);
    return false;
  }
  return true;
}

// ─── REPL helpers ─────────────────────────────────────────────────────────────

function prettyPrint(value: any, interp: Interpreter): string {
  if (value === undefined || value === null) return 'nil';
  if (value instanceof PfunFunction) {
    const params = value.params.join(', ');
    if (value.kind === 'procedure') return `<proc ${value.name ?? '?'}(${params})>`;
    if (value.name)                 return `<fun ${value.name}(${params})>`;
    return `<fn (${params})>`;
  }
  if (value instanceof NativeFunction) return '<built-in fn>';
  if (value instanceof LazyList)       return '<lazylist>';
  if (value instanceof PfunDict) {
    const entries = [...value.entries.entries()]
      .map(([k, v]) => `${k.slice(2)} -> ${interp.stringify(v)}`);
    return entries.length === 0 ? 'dict {}' : `dict { ${entries.join(', ')} }`;
  }
  if (value instanceof PfunArray) {
    return `array { ${value.elements.map((v: any) => interp.stringify(v)).join(', ')} }`;
  }
  return interp.stringify(value);
}

function describeStmt(stmt: Stmt): string | null {
  switch (stmt.type) {
    case 'LetStmt':       return `${stmt.name}`;
    case 'VarStmt':       return `${stmt.name}`;
    case 'FunctionStmt':  return `${stmt.memo ? 'memo ' : ''}${stmt.name}(${stmt.params.join(', ')})`;
    case 'ProcedureStmt': return `proc ${stmt.name}(${stmt.params.join(', ')})`;
    case 'TypeStmt':      return `type ${stmt.name}`;
    case 'UnionTypeStmt': return `type ${stmt.name}`;
    case 'ImportStmt':    return stmt.kind === 'star' ? `* from "${stmt.path}"`
                               : stmt.kind === 'namespace' ? `* as ${stmt.alias} from "${stmt.path}"`
                               : `{ ${stmt.names.map(n => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ')} } from "${stmt.path}"`;
    default:              return null;
  }
}

function isIncompleteInput(err: Error): boolean {
  const m = err.message.toLowerCase();
  return (m.includes('unexpected token') && m.includes('eof')) ||
         m.includes("expected '}'") ||
         m.includes("expected ')'") ||
         m.includes("expected ']'") ||
         m.includes("expected '->'") ||
         m.includes("expected 'then'");
}

// ─── REPL loop ────────────────────────────────────────────────────────────────

function startRepl(interp: Interpreter): void {
  const PROMPT_FRESH    = 'pfun> ';
  const PROMPT_CONTINUE = '   .. ';
  let buffer: string[] = [];

  console.log('Pfun REPL — end a line with ? to evaluate. Type exit to leave.\n');

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: PROMPT_FRESH,
  });

  rl.prompt();

  function evalBuffer(source: string): void {
    let stmts: Stmt[];
    try {
      stmts = new Parser(new Lexer(source).lex()).parse();
    } catch (e) {
      const raw = e instanceof Error ? e : new Error(String(e));
      console.error('\n' + buildPfunError(raw, source, (raw as any).pos, null, () => undefined, interp).pfunMessage);
      return;
    }
    interp.sourceText = source;
    for (const stmt of stmts) {
      try {
        const result = interp.force(interp.evaluateStmt(stmt, (interp as any).globals));
        if (stmt.type === 'ExprStmt' || stmt.type === 'EvalStmt') {
          if (result !== undefined) console.log('=> ' + prettyPrint(result, interp));
        } else {
          const desc = describeStmt(stmt);
          if (desc) console.log(`   ${desc}`);
        }
      } catch (e) {
        console.error('\n' + (e instanceof PfunError ? e : interp.wrapError(e)).pfunMessage);
        return;
      }
    }
  }

  rl.on('line', (rawLine: string) => {
    const trimmed = rawLine.trimEnd();

    if (buffer.length === 0 && trimmed === 'exit') {
      rl.close();
      return;
    }

    const evalNow = trimmed.endsWith('?');
    buffer.push(evalNow ? trimmed.slice(0, -1) : rawLine);

    if (!evalNow) {
      const speculative = buffer.join('\n');
      try {
        new Parser(new Lexer(speculative).lex()).parse();
      } catch (e) {
        const raw = e instanceof Error ? e : new Error(String(e));
        if (!isIncompleteInput(raw)) {
          console.error('\n' + buildPfunError(raw, speculative, (raw as any).pos, null, () => undefined, interp).pfunMessage);
          buffer = [];
        }
      }
      rl.setPrompt(buffer.length === 0 ? PROMPT_FRESH : PROMPT_CONTINUE);
      rl.prompt();
      return;
    }

    evalBuffer(buffer.join('\n'));
    buffer = [];
    rl.setPrompt(PROMPT_FRESH);
    rl.prompt();
  });

  rl.on('close', () => { process.exit(0); });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const interactive = args.includes('-i');
const fileArgs = args.filter(a => a !== '-i');

if (!interactive && fileArgs.length === 0) {
  console.error('Usage: pfun [-i] [script.pf]');
  console.error('  pfun script.pf      run a script');
  console.error('  pfun -i             start the REPL');
  console.error('  pfun -i script.pf   load a script then drop into the REPL');
  process.exit(1);
}

const baseDir = fileArgs.length > 0 ? path.dirname(path.resolve(fileArgs[0])) : process.cwd();
const { interp } = makeInterpreter(baseDir);

if (fileArgs.length > 0) {
  const ok = runFile(fileArgs[0], interp);
  if (!ok && !interactive) process.exit(1);
}

if (interactive) {
  interp.allowGlobalRedef = true;
  startRepl(interp);
}
