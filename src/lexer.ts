// src/lexer.ts

/**
 * Discriminated union representing all possible lexical tokens in the language.
 * Using a discriminated union on the `type` property allows for exhaustive
 * type-checking in the parser.
 */
export type Token =
  | { type: 'IntToken'; value: bigint }
  | { type: 'BoolToken'; value: boolean }
  | { type: 'StrToken'; value: string }
  | { type: 'CharToken'; value: string }  // single-character, distinct from string
  | { type: 'IdentToken'; value: string }
  | { type: 'PlusToken' } | { type: 'MinusToken' } | { type: 'StarToken' }
  | { type: 'SlashToken' } | { type: 'PercentToken' }
  | { type: 'AssignToken' }   // '=' (Assignment)
  | { type: 'EqualToken' }    // '==' (Equality Test)
  | { type: 'GreaterToken' } | { type: 'LessToken' } | { type: 'NotEqualToken' }
  | { type: 'LessEqualToken' } | { type: 'GreaterEqualToken' } | { type: 'BooleanNot' }
  | { type: 'BooleanAnd' } | { type: 'BooleanOr' } | { type: 'LParenToken' }
  | { type: 'RParenToken' } | { type: 'LBraceToken' } | { type: 'RBraceToken' }
  | { type: 'LBracketToken' } | { type: 'RBracketToken' } // List brackets
  | { type: 'LetToken' } | { type: 'VarToken' } | { type: 'TypeToken' } // Mutability & Types
  | { type: 'EvalToken' } | { type: 'IfToken' }
  | { type: 'ThenToken' } | { type: 'ElseToken' }
  | { type: 'FunctionToken' } | { type: 'ReturnToken' } | { type: 'FnToken' } | { type: 'ProcToken' }
  | { type: 'ForToken' }        // 'for' list comprehension generator
  | { type: 'ArrowLeftToken' }  // '<-' generator binding
  | { type: 'DictToken' }       // 'dict' dictionary literal
  | { type: 'ImportToken' }     // 'import' module import
  | { type: 'ExportToken' }     // 'export' module export
  | { type: 'AsToken' }         // 'as' namespace alias
  | { type: 'FromToken' }       // 'from' import source
  | { type: 'ArrowToken' }      // '=>' Lambda arrow
  | { type: 'ArrowRightToken' } // '->' Match arm arrow
  | { type: 'CommaToken' } | { type: 'ColonToken' }
  | { type: 'QuestionToken' } | { type: 'DotToken' } // Ternary & Property Access
  | { type: 'PipeToken' }       // '|' Match arm / union variant separator
  | { type: 'MatchToken' }      // 'match' keyword
  | { type: 'WhereToken' }      // 'where' guard clause
  | { type: 'WildcardToken' }   // '_' wildcard pattern
  | { type: 'SemiToken' } | { type: 'EOFToken' };

export class Lexer {
  private input: string;
  private pos: number = 0;

  constructor(input: string) { this.input = input; }

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

      // Delegate to specialized readers for multi-character literals
      if (this.isDigit(char)) { tokens.push(this.readNumber()); continue; }
      if (char === '"') { tokens.push(this.readString()); continue; }
      if (char === "'") { tokens.push(this.readChar()); continue; }
      if (this.isAlpha(char)) { tokens.push(this.readIdentifierOrKeyword()); continue; }

      // Handle single and multi-character operators
      this.advance();
      switch (char) {
        case '+': tokens.push({ type: 'PlusToken' }); break;
        case '*': tokens.push({ type: 'StarToken' }); break;
        case '/': tokens.push({ type: 'SlashToken' }); break;
        case '%': tokens.push({ type: 'PercentToken' }); break;
        // '-' could be subtraction or the start of '->' (match arm arrow)
        case '-':
          tokens.push(this.match('>') ? { type: 'ArrowRightToken' } : { type: 'MinusToken' });
          break;
        // '=' could be assignment '=', equality '==', or lambda arrow '=>'
        case '=':
          tokens.push(this.match('=') ? { type: 'EqualToken' } : (this.match('>') ? { type: 'ArrowToken' } : { type: 'AssignToken' }));
          break;
        case '(': tokens.push({ type: 'LParenToken' }); break;
        case ')': tokens.push({ type: 'RParenToken' }); break;
        case '{': tokens.push({ type: 'LBraceToken' }); break;
        case '}': tokens.push({ type: 'RBraceToken' }); break;
        case '[': tokens.push({ type: 'LBracketToken' }); break;
        case ']': tokens.push({ type: 'RBracketToken' }); break;
        case ',': tokens.push({ type: 'CommaToken' }); break;
        case ';': tokens.push({ type: 'SemiToken' }); break;
        case ':': tokens.push({ type: 'ColonToken' }); break;
        case '?': tokens.push({ type: 'QuestionToken' }); break;
        case '.': tokens.push({ type: 'DotToken' }); break;
        // '|' is now a pipe token for union variants and match arms.
        // '||' is still supported for boolean or.
        case '|':
          tokens.push(this.match('|') ? { type: 'BooleanOr' } : { type: 'PipeToken' });
          break;
        // Lookahead for compound comparison operators
        case '>': tokens.push(this.match('=') ? { type: 'GreaterEqualToken' } : { type: 'GreaterToken' }); break;
        case '<': tokens.push(this.match('=') ? { type: 'LessEqualToken' } : (this.match('-') ? { type: 'ArrowLeftToken' } : { type: 'LessToken' })); break;
        case '!': tokens.push(this.match('=') ? { type: 'NotEqualToken' } : { type: 'BooleanNot' }); break;
        // Strict requirement for double-character logical and
        case '&': if (this.match('&')) tokens.push({ type: 'BooleanAnd' }); else throw new Error("Expected '&&'"); break;
        default: throw new Error(`Unexpected character '${char}'`);
      }
    }
    tokens.push({ type: 'EOFToken' });
    return tokens;
  }

  // --- Scanner State Helpers ---
  private isAtEnd(): boolean { return this.pos >= this.input.length; }
  private peek(): string { return this.input[this.pos]; }
  private advance(): string { return this.input[this.pos++]; }

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
  private isAlpha(c: string): boolean { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  private isAlphaNumeric(c: string): boolean { return this.isAlpha(c) || this.isDigit(c); }

  // --- Token Readers ---
  private readNumber(): Token {
    let s = '';
    while (!this.isAtEnd() && this.isDigit(this.peek())) s += this.advance();
    // The language exclusively uses BigInt for numerical precision
    return { type: 'IntToken', value: BigInt(s) };
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
      case 'import':   return { type: 'ImportToken' };
      case 'export':   return { type: 'ExportToken' };
      case 'as':       return { type: 'AsToken' };
      case 'from':     return { type: 'FromToken' };
      case 'match':    return { type: 'MatchToken' };
      case 'where':    return { type: 'WhereToken' };
      default:         return { type: 'IdentToken', value: s };
    }
  }
}
