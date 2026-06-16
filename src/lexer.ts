// src/lexer.ts

/**
 * Source position — 1-based line and column, plus absolute character offset.
 */
export type SourcePos = { line: number; col: number; offset: number };

/**
 * Discriminated union representing all possible lexical tokens in the language.
 * Every token carries an optional `pos` field with its source position.
 * It is optional so that synthetic tokens and tokens produced in tests without
 * positions still type-check without changes.
 */
export type Token =
  | { type: 'IntToken'; value: bigint; pos?: SourcePos }
  | { type: 'FloatToken'; value: number; pos?: SourcePos }
  | { type: 'BoolToken'; value: boolean; pos?: SourcePos }
  | { type: 'StrToken'; value: string; pos?: SourcePos }
  | { type: 'CharToken'; value: string; pos?: SourcePos }
  | { type: 'ByteToken'; value: number; pos?: SourcePos }
  | { type: 'IdentToken'; value: string; pos?: SourcePos }
  | { type: 'PlusToken'; pos?: SourcePos } | { type: 'MinusToken'; pos?: SourcePos } | { type: 'StarToken'; pos?: SourcePos }
  | { type: 'SlashToken'; pos?: SourcePos } | { type: 'PercentToken'; pos?: SourcePos }
  | { type: 'AssignToken'; pos?: SourcePos }
  | { type: 'EqualToken'; pos?: SourcePos }
  | { type: 'GreaterToken'; pos?: SourcePos } | { type: 'LessToken'; pos?: SourcePos } | { type: 'NotEqualToken'; pos?: SourcePos }
  | { type: 'LessEqualToken'; pos?: SourcePos } | { type: 'GreaterEqualToken'; pos?: SourcePos } | { type: 'BooleanNot'; pos?: SourcePos }
  | { type: 'BooleanAnd'; pos?: SourcePos } | { type: 'BooleanOr'; pos?: SourcePos } | { type: 'LParenToken'; pos?: SourcePos }
  // ── Bitwise operators ─────────────────────────────────────────────────────
  | { type: 'BitAndToken'; pos?: SourcePos }     // &  (single)
  | { type: 'BitOrToken'; pos?: SourcePos }      // |  (single, mid-expression; parser disambiguates from PipeToken)
  | { type: 'ShiftLeftToken'; pos?: SourcePos }  // <<
  | { type: 'ShiftRightToken'; pos?: SourcePos } // >>
  | { type: 'RParenToken'; pos?: SourcePos } | { type: 'LBraceToken'; pos?: SourcePos } | { type: 'RBraceToken'; pos?: SourcePos }
  | { type: 'LBracketToken'; pos?: SourcePos } | { type: 'RBracketToken'; pos?: SourcePos }
  | { type: 'LetToken'; pos?: SourcePos } | { type: 'VarToken'; pos?: SourcePos } | { type: 'TypeToken'; pos?: SourcePos }
  | { type: 'EvalToken'; pos?: SourcePos } | { type: 'IfToken'; pos?: SourcePos }
  | { type: 'ThenToken'; pos?: SourcePos } | { type: 'ElseToken'; pos?: SourcePos }
  | { type: 'FunctionToken'; pos?: SourcePos } | { type: 'ReturnToken'; pos?: SourcePos } | { type: 'FnToken'; pos?: SourcePos } | { type: 'ProcToken'; pos?: SourcePos }
  | { type: 'ForToken'; pos?: SourcePos }
  | { type: 'ArrowLeftToken'; pos?: SourcePos }
  | { type: 'DictToken'; pos?: SourcePos }
  | { type: 'ArrayToken'; pos?: SourcePos }
  | { type: 'MemoToken'; pos?: SourcePos }
  | { type: 'ImportToken'; pos?: SourcePos }
  | { type: 'ExportToken'; pos?: SourcePos }
  | { type: 'AsToken'; pos?: SourcePos }
  | { type: 'FromToken'; pos?: SourcePos }
  | { type: 'ArrowToken'; pos?: SourcePos }
  | { type: 'ArrowRightToken'; pos?: SourcePos }
  | { type: 'CommaToken'; pos?: SourcePos } | { type: 'ColonToken'; pos?: SourcePos }
  | { type: 'QuestionToken'; pos?: SourcePos } | { type: 'DotToken'; pos?: SourcePos }
  | { type: 'PipeToken'; pos?: SourcePos }
  | { type: 'MatchToken'; pos?: SourcePos }
  | { type: 'WithToken'; pos?: SourcePos }       // 'with' keyword (opens match arms)
  | { type: 'WhereToken'; pos?: SourcePos }
  | { type: 'WildcardToken'; pos?: SourcePos }
  | { type: 'GenericToken'; pos?: SourcePos }
  | { type: 'DollarToken'; pos?: SourcePos }     // $ prefix for interpolated strings
  | { type: 'RawStrToken'; value: string; pos?: SourcePos } // @"..." raw string literal
  // ── Async/await (phase 1) ─────────────────────────────────────────────────
  // 'async' modifies function/proc declarations; 'await' is a unary prefix
  // expression operator. See parser.ts parsePrefix/parseStatement and
  // ast.ts AwaitExpr / FunctionStmt.async / ProcedureStmt.async.
  | { type: 'AsyncToken'; pos?: SourcePos }
  | { type: 'AwaitToken'; pos?: SourcePos }
  | { type: 'SemiToken'; pos?: SourcePos } | { type: 'EOFToken'; pos?: SourcePos };

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;

  constructor(input: string) { this.input = input; }

  /** Returns the current source position (before advancing). */
  private currentPos(): SourcePos {
    return { line: this.line, col: this.col, offset: this.pos };
  }

  /**
   * Main scanning loop. Iterates through the input string character by character,
   * delegating to specific readers for complex tokens (strings, numbers, identifiers)
   * and using a switch statement with lookahead for operators.
   */
  public lex(): Token[] {
    const tokens: Token[] = [];
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) break;
      const char = this.peek();

      // Capture position before reading the token
      const tokPos = this.currentPos();

      // Delegate to specialized readers for multi-character literals
      if (this.isDigit(char)) { tokens.push({ ...this.readNumber(), pos: tokPos }); continue; }
      if (char === '"') { tokens.push({ ...this.readString(), pos: tokPos }); continue; }
      if (char === "'") { tokens.push({ ...this.readChar(), pos: tokPos }); continue; }
      if (char === '@' && this.pos + 1 < this.input.length && this.input[this.pos + 1] === '"') {
        tokens.push({ ...this.readRawString(), pos: tokPos }); continue;
      }
      if (this.isAlpha(char)) { tokens.push({ ...this.readIdentifierOrKeyword(), pos: tokPos }); continue; }

      // Handle single and multi-character operators
      this.advance();
      switch (char) {
        case '+': tokens.push({ type: 'PlusToken', pos: tokPos }); break;
        case '*': tokens.push({ type: 'StarToken', pos: tokPos }); break;
        case '/': tokens.push({ type: 'SlashToken', pos: tokPos }); break;
        case '%': tokens.push({ type: 'PercentToken', pos: tokPos }); break;
        // '-' could be subtraction or the start of '->' (match arm arrow)
        case '-':
          tokens.push(this.match('>') ? { type: 'ArrowRightToken', pos: tokPos } : { type: 'MinusToken', pos: tokPos });
          break;
        // '=' could be assignment '=', equality '==', or lambda arrow '=>'
        case '=':
          tokens.push(this.match('=') ? { type: 'EqualToken', pos: tokPos } : (this.match('>') ? { type: 'ArrowToken', pos: tokPos } : { type: 'AssignToken', pos: tokPos }));
          break;
        case '(': tokens.push({ type: 'LParenToken', pos: tokPos }); break;
        case ')': tokens.push({ type: 'RParenToken', pos: tokPos }); break;
        case '{': tokens.push({ type: 'LBraceToken', pos: tokPos }); break;
        case '}': tokens.push({ type: 'RBraceToken', pos: tokPos }); break;
        case '[': tokens.push({ type: 'LBracketToken', pos: tokPos }); break;
        case ']': tokens.push({ type: 'RBracketToken', pos: tokPos }); break;
        case ',': tokens.push({ type: 'CommaToken', pos: tokPos }); break;
        case ';': tokens.push({ type: 'SemiToken', pos: tokPos }); break;
        case ':': tokens.push({ type: 'ColonToken', pos: tokPos }); break;
        case '?': tokens.push({ type: 'QuestionToken', pos: tokPos }); break;
        case '.': tokens.push({ type: 'DotToken', pos: tokPos }); break;
        case '$': tokens.push({ type: 'DollarToken', pos: tokPos }); break;
        // '|' — '||' is boolean or; single '|' is PipeToken (match arms / union defs).
        // The parser re-interprets PipeToken as BitOrToken in expression context.
        case '|':
          tokens.push(this.match('|') ? { type: 'BooleanOr', pos: tokPos } : { type: 'PipeToken', pos: tokPos });
          break;
        // '<' — could be <=, <-, <<, or plain <
        case '<':
          if (this.match('<'))      tokens.push({ type: 'ShiftLeftToken', pos: tokPos });
          else if (this.match('=')) tokens.push({ type: 'LessEqualToken', pos: tokPos });
          else if (this.match('-')) tokens.push({ type: 'ArrowLeftToken', pos: tokPos });
          else                      tokens.push({ type: 'LessToken', pos: tokPos });
          break;
        // '>' — could be >=, >>, or plain >
        case '>':
          if (this.match('>'))      tokens.push({ type: 'ShiftRightToken', pos: tokPos });
          else if (this.match('=')) tokens.push({ type: 'GreaterEqualToken', pos: tokPos });
          else                      tokens.push({ type: 'GreaterToken', pos: tokPos });
          break;
        case '!': tokens.push(this.match('=') ? { type: 'NotEqualToken', pos: tokPos } : { type: 'BooleanNot', pos: tokPos }); break;
        // '&' — '&&' is boolean and; single '&' is bitwise and
        case '&':
          tokens.push(this.match('&') ? { type: 'BooleanAnd', pos: tokPos } : { type: 'BitAndToken', pos: tokPos });
          break;
        default: throw new Error(`Unexpected character '${char}'`);
      }
    }
    tokens.push({ type: 'EOFToken', pos: this.currentPos() });
    return tokens;
  }

  // --- Scanner State Helpers ---
  private isAtEnd(): boolean { return this.pos >= this.input.length; }
  private peek(): string { return this.input[this.pos]; }
  private advance(): string {
    const c = this.input[this.pos++];
    if (c === '\n') { this.line++; this.col = 1; } else { this.col++; }
    return c;
  }

  /**
   * Consumes the current character only if it matches the expected character.
   * Used for lookahead when scanning multi-character tokens.
   */
  private match(expected: string): boolean {
    if (this.isAtEnd() || this.input[this.pos] !== expected) return false;
    this.pos++; return true;
  }

  /**
   * Skips standard whitespace as well as single-line (//) and multi-line comments.
   */
  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const c = this.peek();
      if ([' ', '\r', '\t', '\n'].includes(c)) {
        this.advance();
      } else if (c === '/' && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        if (next === '/') {
          // Single-line comment
          while (!this.isAtEnd() && this.peek() !== '\n') this.advance();
        } else if (next === '*') {
          // Multi-line comment
          this.advance(); this.advance(); // Skip /*
          while (!this.isAtEnd() && !(this.peek() === '*' && this.pos + 1 < this.input.length && this.input[this.pos + 1] === '/')) {
            this.advance();
          }
          if (!this.isAtEnd()) { this.advance(); this.advance(); } // Skip */
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  // --- Character Classification ---
  private isDigit(c: string): boolean { return c >= '0' && c <= '9'; }
  private isHexDigit(c: string): boolean { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
  private isAlpha(c: string): boolean { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  private isAlphaNumeric(c: string): boolean { return this.isAlpha(c) || this.isDigit(c); }

  // --- Token Readers ---
  private readNumber(): Token {
    let s = '';
    while (!this.isAtEnd() && this.isDigit(this.peek())) s += this.advance();

    // Hex literal: 0x... optionally followed by 'b' suffix for byte.
    // We scan non-b/B hex digits freely, then handle a trailing b/B specially:
    // consume it only if the character after it is NOT a hex digit (i.e. it's
    // a suffix, not part of the number e.g. 0xAB where B is the last hex digit).
    if (s === '0' && !this.isAtEnd() && (this.peek() === 'x' || this.peek() === 'X')) {
      s += this.advance(); // consume 'x'/'X'
      // Consume hex digits, but stop before a lone trailing 'b'/'B' that looks like a suffix
      while (!this.isAtEnd()) {
        const ch = this.peek();
        // If this is b/B, peek at the character after it
        if (ch === 'b' || ch === 'B') {
          const afterB = (this.pos + 1 < this.input.length) ? this.input[this.pos + 1] : '';
          if (this.isHexDigit(afterB)) {
            // b/B is a mid-number hex digit (e.g. 0xABCD), consume it normally
            s += this.advance();
          } else {
            // b/B is the byte suffix — stop scanning hex digits here
            break;
          }
        } else if (this.isHexDigit(ch)) {
          s += this.advance();
        } else {
          break;
        }
      }
      if (!this.isAtEnd() && (this.peek() === 'b' || this.peek() === 'B')) {
        this.advance(); // consume 'b' suffix
        const n = parseInt(s.slice(2), 16); // skip '0x'/'0X'
        if (n < 0 || n > 255) throw new Error(`Byte literal out of range (0–255): ${s}b`);
        return { type: 'ByteToken', value: n };
      }
      return { type: 'IntToken', value: BigInt(s) };
    }

    // Check for decimal point followed by at least one digit (1.5, not 1.)
    let isFloat = false;
    if (!this.isAtEnd() && this.peek() === '.' &&
        this.pos + 1 < this.input.length && this.isDigit(this.input[this.pos + 1])) {
      isFloat = true;
      s += this.advance(); // consume '.'
      while (!this.isAtEnd() && this.isDigit(this.peek())) s += this.advance();
    }

    // Check for scientific notation: e/E followed by optional +/- and digits
    if (!this.isAtEnd() && (this.peek() === 'e' || this.peek() === 'E')) {
      const nextPos = this.pos + 1;
      const nextCh  = nextPos < this.input.length ? this.input[nextPos] : '';
      const afterSign = (nextCh === '+' || nextCh === '-')
        ? (this.pos + 2 < this.input.length ? this.input[this.pos + 2] : '')
        : nextCh;
      if (this.isDigit(afterSign)) {
        isFloat = true;
        s += this.advance(); // consume 'e' or 'E'
        if (!this.isAtEnd() && (this.peek() === '+' || this.peek() === '-')) s += this.advance();
        while (!this.isAtEnd() && this.isDigit(this.peek())) s += this.advance();
      }
    }

    if (isFloat) return { type: 'FloatToken', value: parseFloat(s) };

    // Decimal byte literal: 255b
    if (!this.isAtEnd() && this.peek() === 'b') {
      this.advance(); // consume 'b' suffix
      const n = parseInt(s, 10);
      if (n < 0 || n > 255) throw new Error(`Byte literal out of range (0–255): ${s}b`);
      return { type: 'ByteToken', value: n };
    }

    return { type: 'IntToken', value: BigInt(s) };
  }

  private readRawString(): Token {
    this.advance(); // Consume '@'
    this.advance(); // Consume opening "
    let s = '';
    while (!this.isAtEnd() && this.peek() !== '"') {
      s += this.advance();
    }
    if (this.isAtEnd()) throw new Error("Unterminated raw string.");
    this.advance(); // Consume closing "
    return { type: 'RawStrToken', value: s };
  }

  private readString(): Token {
    this.advance(); // Consume opening "
    let s = '';
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance(); // consume backslash
        s += this.readEscapeChar('"');
      } else {
        s += this.advance();
      }
    }
    if (this.isAtEnd()) throw new Error("Unterminated string.");
    this.advance(); // Consume closing "
    return { type: 'StrToken', value: s };
  }

  private readChar(): Token {
    this.advance(); // Consume opening '
    if (this.isAtEnd()) throw new Error("Unterminated char literal.");
    let c: string;
    if (this.peek() === '\\') {
      this.advance(); // consume backslash
      c = this.readEscapeChar("'");
    } else {
      c = this.advance();
    }
    if (this.isAtEnd() || this.peek() !== "'") throw new Error("Char literal must contain exactly one character.");
    this.advance(); // Consume closing '
    return { type: 'CharToken', value: c };
  }

  private readEscapeChar(delimiter: string): string {
    if (this.isAtEnd()) throw new Error("Unterminated escape sequence.");
    const e = this.advance();
    switch (e) {
      case 'n':  return '\n';
      case 't':  return '\t';
      case '\\': return '\\';
      case '{':  return '\uE000'; // private-use sentinel: literal {
      case '}':  return '\uE001'; // private-use sentinel: literal }
      case '"':  return '"';
      case "'":  return "'";
      default:   throw new Error(`Unknown escape sequence: \\${e}`);
    }
  }

  /**
   * Reads alphanumeric sequences and checks against a reserved keyword map.
   * If no keyword matches, it defaults to a user-defined Identifier.
   */
  private readIdentifierOrKeyword(): Token {
    let s = '';
    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) s += this.advance();
    switch (s) {
      case '_':        return { type: 'WildcardToken' };
      case 'true':     return { type: 'BoolToken', value: true };
      case 'false':    return { type: 'BoolToken', value: false };
      case 'let':      return { type: 'LetToken' };
      case 'var':      return { type: 'VarToken' };
      case 'type':     return { type: 'TypeToken' };
      case 'eval':     return { type: 'EvalToken' };
      case 'if':       return { type: 'IfToken' };
      case 'then':     return { type: 'ThenToken' };
      case 'else':     return { type: 'ElseToken' };
      case 'function': return { type: 'FunctionToken' };
      case 'proc':     return { type: 'ProcToken' };
      case 'return':   return { type: 'ReturnToken' };
      case 'fn':       return { type: 'FnToken' };
      case 'for':      return { type: 'ForToken' };
      case 'dict':     return { type: 'DictToken' };
      case 'array':    return { type: 'ArrayToken' };
      case 'memo':     return { type: 'MemoToken' };
      case 'import':   return { type: 'ImportToken' };
      case 'export':   return { type: 'ExportToken' };
      case 'as':       return { type: 'AsToken' };
      case 'from':     return { type: 'FromToken' };
      case 'match':    return { type: 'MatchToken' };
      case 'with':     return { type: 'WithToken' };
      case 'where':    return { type: 'WhereToken' };
      case 'generic':  return { type: 'GenericToken' };
      // ── Async/await (phase 1) ──────────────────────────────────────────────
      case 'async':    return { type: 'AsyncToken' };
      case 'await':    return { type: 'AwaitToken' };
      default:         return { type: 'IdentToken', value: s };
    }
  }
}
