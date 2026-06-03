
// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';
import { PfunError, buildPfunError } from './errors';

/**
 * Sets up a fresh interpreter with the core standard library.
 * IO functions are NOT included here — scripts must: import * from 'io';
 */
function setupInterpreter(interp: Interpreter): void {
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
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
