import { Lexer, Token } from '../lexer';

const lex = (input: string): Token[] => new Lexer(input).lex();

describe('Lexer Unit Tests', () => {
  describe('Comments', () => {
    it('should skip single-line comments', () => {
      const tokens = lex('let x = 10; // this is a comment\nprintln(x);');
      expect(tokens.map(t => t.type)).toEqual([
        'LetToken', 'IdentToken', 'AssignToken', 'IntToken', 'SemiToken',
        'IdentToken', 'LParenToken', 'IdentToken', 'RParenToken', 'SemiToken', 'EOFToken'
      ]);
    });

    it('should skip multi-line comments', () => {
      const tokens = lex('let x = /* multi \n line */ 10;');
      expect(tokens.map(t => t.type)).toEqual([
        'LetToken', 'IdentToken', 'AssignToken', 'IntToken', 'SemiToken', 'EOFToken'
      ]);
    });
  });

  describe('Existing Operators', () => {
    it('should distinguish between assignment and equality', () => {
      expect(lex('=')[0].type).toBe('AssignToken');
      expect(lex('==')[0].type).toBe('EqualToken');
    });

    it('should tokenize lambda arrow =>', () => {
      expect(lex('=>')[0].type).toBe('ArrowToken');
    });

    it('should tokenize ternary and property access', () => {
      const tokens = lex('a ? b : c.d');
      expect(tokens.map(t => t.type)).toEqual([
        'IdentToken', 'QuestionToken', 'IdentToken', 'ColonToken',
        'IdentToken', 'DotToken', 'IdentToken', 'EOFToken'
      ]);
    });

    it('should tokenize list brackets', () => {
      expect(lex('[1, 2]')[0].type).toBe('LBracketToken');
      expect(lex('[1, 2]')[4].type).toBe('RBracketToken');
    });

    it('should tokenize boolean or as ||', () => {
      expect(lex('||')[0].type).toBe('BooleanOr');
    });
  });

  describe('New Tokens: Discriminated Unions & Match', () => {
    it('should tokenize | as PipeToken', () => {
      expect(lex('|')[0].type).toBe('PipeToken');
    });

    it('should distinguish | (pipe) from || (boolean or)', () => {
      const tokens = lex('| ||');
      expect(tokens[0].type).toBe('PipeToken');
      expect(tokens[1].type).toBe('BooleanOr');
    });

    it('should tokenize -> as ArrowRightToken', () => {
      expect(lex('->')[0].type).toBe('ArrowRightToken');
    });

    it('should distinguish -> (arrow right) from - (minus)', () => {
      const tokens = lex('x - 1 -> y');
      expect(tokens[1].type).toBe('MinusToken');
      expect(tokens[3].type).toBe('ArrowRightToken');
    });

    it('should tokenize match keyword', () => {
      expect(lex('match')[0].type).toBe('MatchToken');
    });

    it('should tokenize where keyword', () => {
      expect(lex('where')[0].type).toBe('WhereToken');
    });

    it('should tokenize _ as WildcardToken', () => {
      expect(lex('_')[0].type).toBe('WildcardToken');
    });

    it('should tokenize a full union type definition', () => {
      const tokens = lex('type Shape = { | Square: side | Circle: radius }');
      expect(tokens.map(t => t.type)).toEqual([
        'TypeToken', 'IdentToken', 'AssignToken', 'LBraceToken',
        'PipeToken', 'IdentToken', 'ColonToken', 'IdentToken',
        'PipeToken', 'IdentToken', 'ColonToken', 'IdentToken',
        'RBraceToken', 'EOFToken'
      ]);
    });

    it('should tokenize a full match expression', () => {
      const tokens = lex('match x { | Square s -> s.side | _ -> 0 }');
      expect(tokens.map(t => t.type)).toEqual([
        'MatchToken', 'IdentToken', 'LBraceToken',
        'PipeToken', 'IdentToken', 'IdentToken', 'ArrowRightToken', 'IdentToken', 'DotToken', 'IdentToken',
        'PipeToken', 'WildcardToken', 'ArrowRightToken', 'IntToken',
        'RBraceToken', 'EOFToken'
      ]);
    });
  });

  describe('New Tokens: Char Literals', () => {
    it('should tokenize a simple char literal', () => {
      const token = lex("'a'")[0];
      expect(token.type).toBe('CharToken');
      expect((token as any).value).toBe('a');
    });

    it('should tokenize newline escape in char literal', () => {
      const token = lex("'\\n'")[0];
      expect(token.type).toBe('CharToken');
      expect((token as any).value).toBe('\n');
    });

    it('should tokenize tab escape in char literal', () => {
      const token = lex("'\\t'")[0];
      expect(token.type).toBe('CharToken');
      expect((token as any).value).toBe('\t');
    });

    it('should tokenize escaped single quote in char literal', () => {
      const token = lex("'\\''")[0];
      expect(token.type).toBe('CharToken');
      expect((token as any).value).toBe("'");
    });

    it('should tokenize escape sequences in string literals', () => {
      const token = lex('"He said \\"hi\\""')[0];
      expect(token.type).toBe('StrToken');
      expect((token as any).value).toBe('He said "hi"');
    });

    it('should tokenize \\n in string as actual newline', () => {
      const token = lex('"line1\\nline2"')[0];
      expect((token as any).value).toBe('line1\nline2');
    });
  });

  describe('New Tokens: Comprehension & Dict', () => {
    it('should tokenize for as ForToken', () => {
      expect(lex('for')[0].type).toBe('ForToken');
    });

    it('should tokenize <- as ArrowLeftToken', () => {
      expect(lex('<-')[0].type).toBe('ArrowLeftToken');
    });

    it('should distinguish <- from < and <=', () => {
      const tokens = lex('x <- y x < y x <= y');
      expect(tokens[1].type).toBe('ArrowLeftToken');
      expect(tokens[4].type).toBe('LessToken');
      expect(tokens[7].type).toBe('LessEqualToken');
    });

    it('should tokenize dict as DictToken', () => {
      expect(lex('dict')[0].type).toBe('DictToken');
    });

    it('should tokenize proc as ProcToken', () => {
      expect(lex('proc')[0].type).toBe('ProcToken');
    });

    it('should tokenize print and println as IdentTokens (not keywords)', () => {
      expect(lex('print')[0].type).toBe('IdentToken');
      expect(lex('println')[0].type).toBe('IdentToken');
    });
  });

  describe('$ and @ string operators', () => {
    it('should tokenize $ as DollarToken', () => {
      expect(lex('$')[0].type).toBe('DollarToken');
    });

    it('should tokenize $"..." as DollarToken then StrToken', () => {
      const tokens = lex('$"hello {name}"');
      expect(tokens[0].type).toBe('DollarToken');
      expect(tokens[1].type).toBe('StrToken');
      expect((tokens[1] as any).value).toBe('hello {name}');
    });

    it('should tokenize @"..." as RawStrToken with backslashes preserved', () => {
      const token = lex('@"Use \\n as literal"')[0];
      expect(token.type).toBe('RawStrToken');
      expect((token as any).value).toBe('Use \\n as literal');
    });

    it('@"..." should preserve \\t and \\\\ literally', () => {
      const token = lex('@"tab\\there"')[0];
      expect(token.type).toBe('RawStrToken');
      expect((token as any).value).toBe('tab\\there');
    });

    it('regular string should still process \\n as newline', () => {
      const token = lex('"line1\\nline2"')[0];
      expect(token.type).toBe('StrToken');
      expect((token as any).value).toBe('line1\nline2');
    });
  });

  // ── Async/await (phase 1) ────────────────────────────────────────────────
  describe('Async/await keywords', () => {
    it('should tokenize "async" as AsyncToken', () => {
      expect(lex('async')[0].type).toBe('AsyncToken');
    });

    it('should tokenize "await" as AwaitToken', () => {
      expect(lex('await')[0].type).toBe('AwaitToken');
    });

    it('should tokenize an async function declaration with await in the body', () => {
      const tokens = lex('async function f() { await x }');
      expect(tokens.map(t => t.type)).toEqual([
        'AsyncToken', 'FunctionToken', 'IdentToken', 'LParenToken', 'RParenToken',
        'LBraceToken', 'AwaitToken', 'IdentToken', 'RBraceToken', 'EOFToken'
      ]);
    });

    it('should tokenize an async proc declaration', () => {
      const tokens = lex('async proc p() { }');
      expect(tokens.map(t => t.type)).toEqual([
        'AsyncToken', 'ProcToken', 'IdentToken', 'LParenToken', 'RParenToken',
        'LBraceToken', 'RBraceToken', 'EOFToken'
      ]);
    });

    it('should not confuse identifiers containing "async"/"await" as substrings with the keywords', () => {
      const tokens = lex('asyncValue awaitable');
      expect(tokens.map(t => t.type)).toEqual(['IdentToken', 'IdentToken', 'EOFToken']);
      expect((tokens[0] as any).value).toBe('asyncValue');
      expect((tokens[1] as any).value).toBe('awaitable');
    });
  });
});
