// src/parser.ts
import { Token } from './lexer';
import { Expr, Stmt, MatchArm } from './ast';

/**
 * Defines the binding power (precedence) of operators for the Pratt Parser.
 * Higher values bind tighter.
 */
enum Precedence {
  NONE, ASSIGNMENT, TERNARY, OR, AND, EQUALITY, COMPARISON, TERM, FACTOR, UNARY, CALL, PRIMARY
}

export class Parser {
  private tokens: Token[];
  private current: number = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  public parse(): Stmt[] {
    const statements: Stmt[] = [];
    while (!this.isAtEnd()) statements.push(this.parseStatement());
    return statements;
  }

  /**
   * Recursive descent dispatcher for statements.
   * Routes to specific parsing methods based on the leading keyword.
   */
  private parseStatement(): Stmt {
    if (this.match('SemiToken')) return this.parseStatement();
    if (this.match('ImportToken')) return this.parseImportStatement();
    if (this.match('ExportToken')) return this.parseExportStatement();
    if (this.match('FunctionToken')) return this.parseFunctionStatement();
    if (this.match('ProcToken')) return this.parseProcedureStatement();
    if (this.match('LetToken')) return this.parseLetStatement();
    if (this.match('VarToken')) return this.parseVarStatement();
    if (this.match('TypeToken')) return this.parseTypeStatement();
    if (this.match('ReturnToken')) return this.parseReturnStatement();
    if (this.match('EvalToken')) return this.parseEvalStatement();
    if (this.match('IfToken')) return this.parseIfStatement();
    if (this.match('LBraceToken')) return this.parseBlockStatement();

    // Fallback: If no statement keyword is found, it must be an expression statement.
    const expr = this.parseExpression();
    this.match('SemiToken'); // Consume optional trailing semicolon
    return { type: 'ExprStmt', expression: expr };
  }

  private parseFunctionStatement(): Stmt {
    const name = (this.consume('IdentToken', "Expected function name.") as any).value;
    this.consume('LParenToken', "Expected '(' after function name.");
    const params = this.parseParameters();
    this.consume('RParenToken', "Expected ')' after parameters.");

    const statements: Stmt[] = [];
    if (this.match('LBraceToken')) {
      while (!this.check('RBraceToken') && !this.isAtEnd()) { if (this.match('SemiToken')) continue; statements.push(this.parseStatement()); }
      this.consume('RBraceToken', "Expected '}' after block.");
    } else {
      while (!this.check('FunctionToken') && !this.isAtEnd()) statements.push(this.parseStatement());
    }
    return { type: 'FunctionStmt', name, params, body: statements };
  }

  private parseProcedureStatement(): Stmt {
    const name = (this.consume('IdentToken', "Expected procedure name.") as any).value;
    this.consume('LParenToken', "Expected '(' after procedure name.");
    const params = this.parseParameters();
    this.consume('RParenToken', "Expected ')' after parameters.");

    const statements: Stmt[] = [];
    if (this.match('LBraceToken')) {
      while (!this.check('RBraceToken') && !this.isAtEnd()) { if (this.match('SemiToken')) continue; statements.push(this.parseStatement()); }
      this.consume('RBraceToken', "Expected '}' after block.");
    } else {
      while (!this.check('ProcToken') && !this.isAtEnd()) statements.push(this.parseStatement());
    }
    return { type: 'ProcedureStmt', name, params, body: statements };
  }

  private parseParameters(): string[] {
    const params: string[] = [];
    if (!this.check('RParenToken')) {
      do {
        if (this.check('WildcardToken')) {
          this.advance();
          params.push('_');
        } else {
          params.push((this.consume('IdentToken', "Expected parameter name.") as any).value);
        }
      } while (this.match('CommaToken'));
    }
    return params;
  }

  private parseLetStatement(): Stmt {
    const name = (this.consume('IdentToken', "Expected variable name.") as any).value;
    this.consume('AssignToken', "Expected '=' after variable name.");
    const initializer = this.parseExpression();
    this.match('SemiToken');
    return { type: 'LetStmt', name, initializer };
  }

  private parseVarStatement(): Stmt {
    const name = (this.consume('IdentToken', "Expected variable name.") as any).value;
    this.consume('AssignToken', "Expected '=' after variable name.");
    const initializer = this.parseExpression();
    this.match('SemiToken');
    return { type: 'VarStmt', name, initializer };
  }

  /**
   * Parses both plain record types and discriminated union types.
   *
   * Plain record:
   *   type Point = { x, y }
   *
   * Discriminated union (leading pipe inside the braces):
   *   type Shape = {
   *     | Square: side
   *     | Circle: radius
   *     | Rectangle: x, y
   *   }
   */
  private parseTypeStatement(): Stmt {
    const name = (this.consume('IdentToken', "Expected type name.") as any).value;
    this.consume('AssignToken', "Expected '=' after type name.");
    this.consume('LBraceToken', "Expected '{' for type definition.");

    // Discriminated union: first token inside the braces is a pipe
    if (this.check('PipeToken')) {
      const variants: { name: string; fields: string[] }[] = [];
      while (this.match('PipeToken')) {
        const variantName = (this.consume('IdentToken', "Expected variant name.") as any).value;
        const fields: string[] = [];
        // Colon and fields are optional — zero-field variants like `| None` have neither.
        if (this.match('ColonToken')) {
          // Fields are a comma-separated list of identifiers.
          // Stop when we hit another pipe, a closing brace, or EOF.
          do {
            fields.push((this.consume('IdentToken', "Expected field name.") as any).value);
          } while (this.match('CommaToken') && !this.check('PipeToken') && !this.check('RBraceToken'));
        }
        variants.push({ name: variantName, fields });
      }
      this.consume('RBraceToken', "Expected '}' after union variants.");
      this.match('SemiToken');
      return { type: 'UnionTypeStmt', name, variants };
    }

    // Plain record type
    const fields: string[] = [];
    if (!this.check('RBraceToken')) {
      do {
        fields.push((this.consume('IdentToken', "Expected field name.") as any).value);
      } while (this.match('CommaToken'));
    }
    this.consume('RBraceToken', "Expected '}' after type fields.");
    this.match('SemiToken');
    return { type: 'TypeStmt', name, fields };
  }

  private parseImportStatement(): Stmt {
    // import * from "path"          — star: all exports into current scope
    // import * as Name from "path"  — namespace: all exports under alias
    if (this.match('StarToken')) {
      if (this.match('AsToken')) {
        const alias = (this.consume('IdentToken', "Expected namespace alias.") as any).value;
        this.consume('FromToken', "Expected 'from' after alias.");
        const path = (this.consume('StrToken', "Expected module path string.") as any).value;
        this.match('SemiToken');
        return { type: 'ImportStmt', kind: 'namespace', alias, path };
      }
      // bare star — no alias
      this.consume('FromToken', "Expected 'from' after '*'.");
      const path = (this.consume('StrToken', "Expected module path string.") as any).value;
      this.match('SemiToken');
      return { type: 'ImportStmt', kind: 'star', path };
    }
    // import { name, name as alias, ... } from "path"
    this.consume('LBraceToken', "Expected '{', '*' after 'import'.");
    const names: { name: string; alias?: string }[] = [];
    if (!this.check('RBraceToken')) {
      do {
        const name = (this.consume('IdentToken', "Expected import name.") as any).value;
        let alias: string | undefined;
        if (this.match('AsToken')) {
          alias = (this.consume('IdentToken', "Expected alias after 'as'.") as any).value;
        }
        names.push({ name, alias });
      } while (this.match('CommaToken'));
    }
    this.consume('RBraceToken', "Expected '}' after import names.");
    this.consume('FromToken', "Expected 'from' after import list.");
    const path = (this.consume('StrToken', "Expected module path string.") as any).value;
    this.match('SemiToken');
    return { type: 'ImportStmt', kind: 'named', names, path };
  }

  private parseExportStatement(): Stmt {
    // export <let|var|function|proc|type stmt>
    const declaration = this.parseStatement();
    return { type: 'ExportStmt', declaration };
  }

  private parseEvalStatement(): Stmt {
    const expr = this.parseExpression();
    this.match('SemiToken');
    return { type: 'EvalStmt', expression: expr };
  }

  private parseReturnStatement(): Stmt {
    let value: Expr | undefined = undefined;
    if (this.isExprStart()) value = this.parseExpression();
    this.match('SemiToken');
    return { type: 'ReturnStmt', value };
  }

  private parseIfStatement(): Stmt {
    const condition = this.parseExpression();
    this.consume('ThenToken', "Expected 'then' after if condition.");
    const thenBranch = this.parseStatement();
    let elseBranch: Stmt | undefined = undefined;
    if (this.match('ElseToken')) elseBranch = this.parseStatement();
    return { type: 'IfStmt', condition, thenBranch, elseBranch };
  }

  private parseBlockExpr(): Expr {
    // Parses { stmt; stmt; expr } as a BlockExpr — evaluates stmts, returns last value.
    this.advance(); // consume '{'
    const statements: Stmt[] = [];
    while (!this.check('RBraceToken') && !this.isAtEnd()) {
      if (this.match('SemiToken')) continue;
      statements.push(this.parseStatement());
    }
    this.consume('RBraceToken', "Expected '}' after block.");
    return { type: 'BlockExpr', statements };
  }

  private parseBlockStatement(): Stmt {
    const statements: Stmt[] = [];
    while (!this.check('RBraceToken') && !this.isAtEnd()) { if (this.match('SemiToken')) continue; statements.push(this.parseStatement()); }
    this.consume('RBraceToken', "Expected '}' after block.");
    return { type: 'BlockStmt', statements };
  }

  /**
   * PRATT PARSING ALGORITHM (Top-Down Operator Precedence)
   */
  private parseExpression(precedence: Precedence = Precedence.NONE): Expr {
    let left = this.parsePrefix();
    while (!this.isAtEnd() && precedence < this.getPrecedence(this.peek().type)) {
      left = this.parseInfix(left);
    }
    return left;
  }

  /**
   * Prefix parser (Nud): Handles tokens that appear at the beginning of an expression.
   */
  private parsePrefix(): Expr {
    const token = this.advance();
    switch (token.type) {
      case 'IntToken': return { type: 'IntExpr', value: token.value };
      case 'BoolToken': return { type: 'BoolExpr', value: token.value };
      case 'StrToken': return { type: 'StrExpr', value: token.value };
      case 'CharToken': return { type: 'CharExpr', value: token.value };
      case 'IdentToken':
        // printf("...{name}...{name.field}...") desugars at parse time into
        // a print() call with a string concatenation expression.
        if (token.value === 'printf' && this.check('LParenToken')) {
          return this.parsePrintf();
        }
        // Positional / Named Record Constructor: Point { 1, 2 } or Point { x=1, y=2 }
        // Guard: do NOT treat '{ |' or '{ }' as a constructor — those are match bodies
        // or empty blocks, not record field lists.
        if (this.check('LBraceToken') &&
            this.peekNext().type !== 'PipeToken' &&
            this.peekNext().type !== 'RBraceToken') {
          this.advance();
          const fields: { key: string | null, value: Expr }[] = [];
          if (!this.check('RBraceToken')) {
            do {
              // Peek ahead to distinguish named (ident =) from positional
              if (this.check('IdentToken') && this.peekNext().type === 'AssignToken') {
                const key = (this.advance() as any).value;
                this.advance(); // consume '='
                fields.push({ key, value: this.parseExpression() });
              } else {
                fields.push({ key: null, value: this.parseExpression() });
              }
            } while (this.match('CommaToken'));
          }
          this.consume('RBraceToken', "Expected '}' after record fields.");
          return { type: 'RecordExpr', name: token.value, fields };
        }
        return { type: 'IdentExpr', name: token.value };
      case 'BooleanNot': case 'MinusToken':
        return { type: 'UnaryExpr', operator: token.type, right: this.parseExpression(Precedence.UNARY) };
      case 'FnToken': return this.parseLambda();
      case 'MatchToken': return this.parseMatchExpression();
      case 'DictToken': {
        this.consume('LBraceToken', "Expected '{' after 'dict'.");
        const entries: { key: Expr; value: Expr }[] = [];
        if (!this.check('RBraceToken')) {
          do {
            const key = this.parseExpression();
            this.consume('ArrowRightToken', "Expected '->' between dict key and value.");
            const value = this.parseExpression();
            entries.push({ key, value });
          } while (this.match('CommaToken'));
        }
        this.consume('RBraceToken', "Expected '}' after dict entries.");
        return { type: 'DictExpr', entries };
      }
      case 'LParenToken': {
        const expr = this.parseExpression();
        this.consume('RParenToken', "Expected ')' after expression.");
        return { type: 'GroupExpr', expression: expr };
      }
      case 'LBracketToken': {
        // Empty list: []
        if (this.check('RBracketToken')) {
          this.advance();
          return { type: 'ListExpr', elements: [] };
        }
        // Parse the first expression — could be a list element or comprehension body
        const first = this.parseExpression();
        // Comprehension: [ <body> for <var> <- <source> [for ...] [where <guard>] ]
        if (this.check('ForToken')) {
          const generators: { variable: string; source: Expr }[] = [];
          while (this.match('ForToken')) {
            const variable = (this.consume('IdentToken', "Expected variable name after 'for'.") as any).value;
            this.consume('ArrowLeftToken', "Expected '<-' after generator variable.");
            const source = this.parseExpression();
            generators.push({ variable, source });
          }
          let guard: Expr | undefined = undefined;
          if (this.match('WhereToken')) guard = this.parseExpression();
          this.consume('RBracketToken', "Expected ']' after list comprehension.");
          return { type: 'ComprehensionExpr', body: first, generators, guard };
        }
        // Regular list literal
        const elements: Expr[] = [first];
        while (this.match('CommaToken')) {
          elements.push(this.parseExpression());
        }
        this.consume('RBracketToken', "Expected ']' after list elements.");
        return { type: 'ListExpr', elements };
      }
      default: throw new Error(`Unexpected token in expression: ${token.type}`);
    }
  }

  /**
   * Parses a match expression:
   *
   *   match <expr> {
   *     | <Variant> <binding> [where <guard>] -> <expr>
   *     | <Variant> _ -> <expr>
   *     | _ -> <expr>
   *   }
   *
   * Arms are tried in order. The first arm whose variant matches (and whose
   * optional guard evaluates to truthy) wins.
   */
  private parseMatchExpression(): Expr {
    // Parse at NONE so subjects like 'match foo.bar { ... }' work fully.
    // The IdentToken prefix case is guarded against consuming '{ | ...' as a
    // record constructor, so the opening brace of the arm block is safe.
    const subject = this.parseExpression(Precedence.NONE);
    this.consume('LBraceToken', "Expected '{' after match subject.");

    const arms: MatchArm[] = [];
    while (this.match('PipeToken')) {
      // Wildcard arm: | _ -> expr
      if (this.check('WildcardToken')) {
        this.advance(); // consume '_'
        this.consume('ArrowRightToken', "Expected '->' after wildcard pattern.");
        const body = this.check('LBraceToken') ? this.parseBlockExpr() : this.parseExpression();
        arms.push({ variant: null, binding: null, body });
        this.match('SemiToken');
        continue;
      }

      const variantName = (this.consume('IdentToken', "Expected variant name or '_' in match arm.") as any).value;

      // Binding: a named identifier or '_'
      let binding: string | null = null;
      if (this.check('WildcardToken')) {
        this.advance(); // consume '_', binding stays null
      } else if (this.check('IdentToken')) {
        binding = (this.advance() as any).value;
      }

      // Optional guard: where <expr>
      let guard: Expr | undefined = undefined;
      if (this.match('WhereToken')) {
        guard = this.parseExpression();
      }

      this.consume('ArrowRightToken', "Expected '->' after match pattern.");
      const body = this.check('LBraceToken') ? this.parseBlockExpr() : this.parseExpression();
      arms.push({ variant: variantName, binding, guard, body });
      this.match('SemiToken');
    }

    this.consume('RBraceToken', "Expected '}' after match arms.");
    return { type: 'MatchExpr', subject, arms };
  }

  /**
   * Desugars printf("text {name} or {rec.field}\n") at parse time into
   * a print() call with concatenated string + identifier/property expressions.
   * Escape sequences: \n \t \\ \" \{ \}
   */
  private parsePrintf(): Expr {
    this.advance(); // consume '('
    const fmtToken = this.advance();
    if (fmtToken.type !== 'StrToken') throw new Error("printf requires a string literal as its argument.");
    this.consume('RParenToken', "Expected ')' after printf format string.");

    const fmt = fmtToken.value;
    const parts: Expr[] = [];
    let i = 0;
    let current = '';

    while (i < fmt.length) {
      const ch = fmt[i];
      if (ch === '\uE000') { current += '{'; i++; continue; }  // sentinel for \{
      if (ch === '\uE001') { current += '}'; i++; continue; }  // sentinel for \}
      if (ch === '{') {
        if (current.length > 0) { parts.push({ type: 'StrExpr', value: current }); current = ''; }
        i++;
        let interp = '';
        while (i < fmt.length && fmt[i] !== '}') interp += fmt[i++];
        if (i >= fmt.length) throw new Error("printf: unclosed '{' in format string.");
        i++; // consume '}'
        interp = interp.trim();
        const dotIdx = interp.indexOf('.');
        if (dotIdx === -1) {
          parts.push({ type: 'IdentExpr', name: interp });
        } else {
          const objName = interp.slice(0, dotIdx);
          const fieldName = interp.slice(dotIdx + 1);
          parts.push({ type: 'GetExpr', object: { type: 'IdentExpr', name: objName }, name: fieldName });
        }
      } else {
        current += ch;
        i++;
      }
    }
    if (current.length > 0) parts.push({ type: 'StrExpr', value: current });

    if (parts.length === 0) {
      return { type: 'CallExpr', callee: { type: 'IdentExpr', name: 'print' }, args: [{ type: 'StrExpr', value: '' }] };
    }
    let concat: Expr = parts[0];
    for (let j = 1; j < parts.length; j++) {
      concat = { type: 'BinaryExpr', left: concat, operator: 'PlusToken', right: parts[j] };
    }
    return { type: 'CallExpr', callee: { type: 'IdentExpr', name: 'print' }, args: [concat] };
  }

  private parseLambda(): Expr {
    let params: string[] = [];
    if (this.match('LParenToken')) {
      params = this.parseParameters();
      this.consume('RParenToken', "Expected ')' after parameters.");
    } else {
      do {
        if (this.check('WildcardToken')) {
          this.advance();
          params.push('_');
        } else {
          params.push((this.consume('IdentToken', "Expected parameter name.") as any).value);
        }
      } while (this.match('CommaToken'));
    }
    this.consume('ArrowToken', "Expected '=>' after lambda parameters.");
    const body = this.parseExpression();
    return { type: 'LambdaExpr', params, body };
  }

  /**
   * Infix parser (Led): Handles tokens that appear between two expressions.
   */
  private parseInfix(left: Expr): Expr {
    const token = this.advance();
    const precedence = this.getPrecedence(token.type);

    if (token.type === 'AssignToken') {
      if (left.type === 'IndexExpr') {
        return { type: 'IndexAssignExpr', object: left.object, index: left.index, value: this.parseExpression(precedence - 1) };
      }
      if (left.type !== 'IdentExpr') throw new Error("Invalid assignment target.");
      return { type: 'AssignExpr', name: left.name, value: this.parseExpression(precedence - 1) };
    }

    if (token.type === 'QuestionToken') {
      const thenBranch = this.parseExpression();
      this.consume('ColonToken', "Expected ':' in ternary expression.");
      const elseBranch = this.parseExpression(precedence - 1);
      return { type: 'TernaryExpr', condition: left, thenBranch, elseBranch };
    }

    if (token.type === 'DotToken') {
      const prop = this.consume('IdentToken', "Expected property name after '.'.");
      return { type: 'GetExpr', object: left, name: (prop as any).value };
    }

    if (token.type === 'LParenToken') {
      return this.parseCall(left);
    }

    if (token.type === 'LBracketToken') {
      const index = this.parseExpression();
      this.consume('RBracketToken', "Expected ']' after index.");
      return { type: 'IndexExpr', object: left, index };
    }

    return { type: 'BinaryExpr', left, operator: token.type, right: this.parseExpression(precedence) };
  }

  private parseCall(callee: Expr): Expr {
    const args: Expr[] = [];
    let isNamedRecord = false;

    if (!this.check('RParenToken')) {
      do {
        const expr = this.parseExpression();
        if (expr.type === 'AssignExpr') isNamedRecord = true;
        args.push(expr);
      } while (this.match('CommaToken'));
    }
    this.consume('RParenToken', "Expected ')' after arguments.");

    if (callee.type === 'IdentExpr' && isNamedRecord) {
      const fields = args.map(a => ({ key: (a as any).name, value: (a as any).value }));
      return { type: 'RecordExpr', name: callee.name, fields };
    }

    return { type: 'CallExpr', callee, args };
  }

  private getPrecedence(type: Token['type']): Precedence {
    switch (type) {
      case 'AssignToken': return Precedence.ASSIGNMENT;
      case 'QuestionToken': return Precedence.TERNARY;
      case 'BooleanOr': return Precedence.OR;
      case 'BooleanAnd': return Precedence.AND;
      case 'EqualToken': case 'NotEqualToken': return Precedence.EQUALITY;
      case 'GreaterToken': case 'LessToken': case 'GreaterEqualToken': case 'LessEqualToken': return Precedence.COMPARISON;
      case 'PlusToken': case 'MinusToken': return Precedence.TERM;
      case 'StarToken': case 'SlashToken': case 'PercentToken': return Precedence.FACTOR;
      case 'LParenToken': case 'DotToken': case 'LBracketToken': return Precedence.CALL;
      default: return Precedence.NONE;
    }
  }

  // --- Parser State Helpers ---
  private isExprStart(): boolean {
    const t = this.peek().type;
    return ['IntToken', 'BoolToken', 'StrToken', 'CharToken', 'IdentToken', 'BooleanNot', 'MinusToken',
            'LParenToken', 'LBracketToken', 'FnToken', 'MatchToken', 'DictToken'].includes(t);
  }
  private isAtEnd(): boolean { return this.peek().type === 'EOFToken'; }
  private peek(): Token { return this.tokens[this.current]; }
  private peekNext(): Token { return this.tokens[this.current + 1] ?? { type: 'EOFToken' }; }
  private advance(): Token { if (!this.isAtEnd()) this.current++; return this.tokens[this.current - 1]; }
  private check(type: Token['type']): boolean { return this.peek().type === type; }
  private match(type: Token['type']): boolean { if (this.check(type)) { this.advance(); return true; } return false; }
  private consume(type: Token['type'], message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(message);
  }
}
