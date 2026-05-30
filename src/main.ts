// src/main.ts
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';

/**
 * Orchestrates the interpretation pipeline:
 * Source Code -> Lexer -> Tokens -> Parser -> AST -> Interpreter -> Execution
 */
function run(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.lex();

  const parser = new Parser(tokens);
  const ast = parser.parse();

  const interpreter = new Interpreter();
  interpreter.interpret(ast);
}

function runFile(filePath: string) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }
  const source = fs.readFileSync(absolutePath, 'utf-8');
  run(source);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: d1 <script.d1>');
  process.exit(1);
}

runFile(args[0]);
