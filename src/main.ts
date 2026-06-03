// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';

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
  const ast    = new Parser(new Lexer(source).lex()).parse();
  const interp = new Interpreter(baseDir, loader);
  setupInterpreter(interp);
  interp.interpret(ast);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: pfun <script.pf>');
  process.exit(1);
}

runFile(args[0]);
