import { Lexer, Token } from './lexer';

const lex = (input: string): Token[] => new Lexer(input).lex();

describe('Lexer Unit Tests', () => {
  describe('Comments', () => {
    it('should skip single-line comments', () => {
      const tokens = lex('let x = 10; // this is a comment\nprint x;');
      expect(tokens.map(t => t.type)).toEqual([
        'LetToken', 'IdentToken', 'AssignToken', 'IntToken', 'SemiToken',
        'PrintToken', 'IdentToken', 'SemiToken', 'EOFToken'
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
});
