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
  | { type: 'ThenToken' } | { type: 'ElseToken' } | { type: 'PrintToken' }
  | { type: 'FunctionToken' } | { type: 'ReturnToken' } | { type: 'FnToken' }
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
        case '_': tokens.push({ type: 'WildcardToken' }); break;
        // '|' is now a pipe token for union variants and match arms.
        // '||' is still supported for boolean or.
        case '|':
          tokens.push(this.match('|') ? { type: 'BooleanOr' } : { type: 'PipeToken' });
          break;
        // Lookahead for compound comparison operators
        case '>': tokens.push(this.match('=') ? { type: 'GreaterEqualToken' } : { type: 'GreaterToken' }); break;
        case '<': tokens.push(this.match('=') ? { type: 'LessEqualToken' } : { type: 'LessToken' }); break;
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
    this.advance(); // Consume opening quote
    let s = '';
    while (!this.isAtEnd() && this.peek() !== '"') s += this.advance();
    if (this.isAtEnd()) throw new Error("Unterminated string.");
    this.advance(); // Consume closing quote
    return { type: 'StrToken', value: s };
  }

  /**
   * Reads alphanumeric sequences and checks against a reserved keyword map.
   * If no keyword matches, it defaults to a user-defined Identifier.
   */
  private readIdentifierOrKeyword(): Token {
    let s = '';
    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) s += this.advance();
    switch (s) {
      case 'true':     return { type: 'BoolToken', value: true };
      case 'false':    return { type: 'BoolToken', value: false };
      case 'let':      return { type: 'LetToken' };
      case 'var':      return { type: 'VarToken' };
      case 'type':     return { type: 'TypeToken' };
      case 'eval':     return { type: 'EvalToken' };
      case 'if':       return { type: 'IfToken' };
      case 'then':     return { type: 'ThenToken' };
      case 'else':     return { type: 'ElseToken' };
      case 'print':    return { type: 'PrintToken' };
      case 'function': return { type: 'FunctionToken' };
      case 'return':   return { type: 'ReturnToken' };
      case 'fn':       return { type: 'FnToken' };
      case 'match':    return { type: 'MatchToken' };
      case 'where':    return { type: 'WhereToken' };
      default:         return { type: 'IdentToken', value: s };
    }
  }
}
