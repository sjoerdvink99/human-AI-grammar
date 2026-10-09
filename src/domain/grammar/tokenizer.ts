export type TokenKind =
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "colon"
  | "plus"
  | "arrow"
  | "star"
  | "tilde"
  | "word"
  | "end";

export interface Token {
  kind: TokenKind;
  text: string;
  offset: number;
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const punctuation: Record<string, TokenKind> = {
  "(": "lparen",
  ")": "rparen",
  "[": "lbracket",
  "]": "rbracket",
  ":": "colon",
  "+": "plus",
  "*": "star",
  "~": "tilde",
  "→": "arrow",
};

const wordChar = /[\p{L}\p{N}_-]/u;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (input.startsWith("->", i)) {
      tokens.push({ kind: "arrow", text: "->", offset: i });
      i += 2;
      continue;
    }

    const kind = punctuation[char];
    if (kind) {
      tokens.push({ kind, text: char, offset: i });
      i += 1;
      continue;
    }

    if (wordChar.test(char)) {
      const start = i;
      while (i < input.length && wordChar.test(input[i]) && !input.startsWith("->", i)) {
        i += 1;
      }
      tokens.push({ kind: "word", text: input.slice(start, i), offset: start });
      continue;
    }

    throw new TokenizeError(`Unexpected character '${char}'`, i);
  }

  tokens.push({ kind: "end", text: "", offset: input.length });
  return tokens;
}
