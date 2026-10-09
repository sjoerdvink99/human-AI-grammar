import { tokenize, TokenizeError, type Token, type TokenKind } from "./tokenizer";
import {
  actorKinds,
  type ActorKind,
  type ParseResult,
  type Process,
  type Representation,
  type SourceSpan,
  type State,
  type Transform,
} from "./types";

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly length: number,
  ) {
    super(message);
  }
}

const actorPattern = new RegExp(`^(${actorKinds.join("|")})(_[\\p{L}\\p{N}_-]+)?$`, "iu");

function parseActor(text: string): { actor: ActorKind; actorInstance?: string } | null {
  const match = actorPattern.exec(text);
  if (!match) return null;
  const actor = match[1].toLowerCase() as ActorKind;
  return match[2] ? { actor, actorInstance: text } : { actor };
}

function locate(input: string, offset: number, length = 1): SourceSpan {
  const before = input.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return { offset, length, line, column };
}

export function parseProcess(input: string): ParseResult {
  try {
    return { ok: true, process: new Parser(tokenize(input), input).process() };
  } catch (error) {
    if (error instanceof TokenizeError) {
      return { ok: false, error: { message: error.message, ...locate(input, error.offset) } };
    }
    if (error instanceof ParseFailure) {
      return { ok: false, error: { message: error.message, ...locate(input, error.offset, error.length) } };
    }
    throw error;
  }
}

export function parseState(input: string): State | null {
  try {
    return new Parser(tokenize(input), input).lone();
  } catch (error) {
    if (error instanceof TokenizeError || error instanceof ParseFailure) return null;
    throw error;
  }
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly input: string,
  ) {}

  process(): Process {
    if (this.at("end")) this.fail("Expression is empty", this.peek());

    const states = [this.state()];
    const transforms: Transform[] = [];

    while (!this.at("end")) {
      this.expect("arrow", "Expected '->' before the next transformation");
      transforms.push(this.transform());
      if (this.at("end")) {
        this.fail("Transformation must be followed by '->' and a state", this.previous());
      }
      this.expect("arrow", "Expected '->' after the transformation");
      if (this.at("end")) this.fail("Transition '->' has no following state", this.previous());
      states.push(this.state());
    }

    if (transforms.length === 0) {
      this.fail("A process needs at least one transformation: state -> [actor operation] -> state", this.previous());
    }

    return { states, transforms };
  }

  lone(): State {
    const state = this.state();
    if (!this.at("end")) this.fail("Expected a single state", this.peek());
    return state;
  }

  private state(): State {
    const representations = [this.representation()];
    while (this.at("plus")) {
      const plus = this.advance();
      if (!this.at("lparen")) this.fail("Expected a representation '(id: role medium)' after '+'", plus);
      representations.push(this.representation());
    }
    return { representations };
  }

  private representation(): Representation {
    const open = this.expect("lparen", "Expected a state '(id: role medium)'");
    const id = this.expect("word", "Representation is missing an identifier").text;
    this.expect("colon", `Expected ':' after representation identifier '${id}'`);
    if (!this.at("word")) this.fail(`Representation '${id}' is missing a role and a medium`, this.peek());
    const role = this.advance().text.toLowerCase();
    if (!this.at("word")) this.fail(`Representation '${id}' is missing a medium after role '${role}'`, this.peek());
    const medium = this.advance().text.toLowerCase();

    if (this.at("word")) {
      this.fail(`Unexpected '${this.peek().text}' in representation '${id}'; expected (id: role medium)`, this.peek());
    }
    if (!this.at("rparen")) {
      const { line, column } = locate(this.input, open.offset);
      this.fail(`Missing closing ')' for representation opened at line ${line}, column ${column}`, this.peek());
    }
    this.advance();
    return { id, role, medium };
  }

  private transform(): Transform {
    const open = this.expect("lbracket", "Expected a transformation '[actor operation]'");
    const words: Token[] = [];
    while (this.at("word")) words.push(this.advance());

    if (this.at("tilde")) this.fail("Place '~' after the closing bracket, as in [model generate]~", this.peek());
    if (!this.at("rbracket")) {
      const { line, column } = locate(this.input, open.offset);
      this.fail(`Missing closing ']' for transformation opened at line ${line}, column ${column}`, this.peek());
    }
    const close = this.advance();
    const stochastic = this.at("tilde");
    if (stochastic) this.advance();

    const [actorToken, operationToken, extra] = words;
    if (!actorToken) this.fail("Transformation is missing an actor and an operation", open, close);
    const actor = parseActor(actorToken.text);

    if (!operationToken) {
      this.fail(
        actor
          ? `Transformation is missing an operation after actor '${actorToken.text}'`
          : `Transformation is missing an actor before operation '${actorToken.text}'`,
        open,
        close,
      );
    }
    if (!actor) {
      this.fail(
        `Unknown actor '${actorToken.text}'; expected human, model, or tool, optionally with an instance suffix such as model_1`,
        actorToken,
      );
    }
    if (extra) this.fail(`Unexpected '${extra.text}'; a transformation has the form [actor operation]`, extra);

    return { ...actor, operation: operationToken.text.toLowerCase(), stochastic };
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)];
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.index += 1;
    return token;
  }

  private expect(kind: TokenKind, message: string): Token {
    if (!this.at(kind)) this.fail(message, this.peek());
    return this.advance();
  }

  private fail(message: string, from: Token, to: Token = from): never {
    const length = Math.max(1, to.offset + to.text.length - from.offset);
    throw new ParseFailure(message, from.offset, length);
  }
}
