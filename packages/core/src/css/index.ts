/**
 * CSS selector -> XPath 1.0 translation.
 *
 * Scrapling uses Python's `cssselect.HTMLTranslator` (via
 * `scrapling.core.translator.css_to_xpath`). This is a focused port of the
 * semantics that matter for scraping, validated by *selected nodes* against
 * `cssselect` rather than by comparing XPath strings.
 *
 * Deliberately unsupported, and loud about it: namespace prefixes, escaped
 * identifiers, `:disabled`, `:enabled`, `:is()`, `:where()`, `:has()`,
 * `:nth-*(…)` combined with a universal type, and pseudo-elements other than
 * `::text` / `::attr()`.
 */

export class CssSelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CssSelectorError";
  }
}

type Combinator = " " | ">" | "+" | "~";

type SimplePart =
  | { kind: "class"; name: string }
  | { kind: "id"; name: string }
  | { kind: "attr"; name: string; op?: string; value?: string; flag?: string }
  | { kind: "pseudo"; name: string; argument?: string }
  | { kind: "pseudo-element"; name: string; argument?: string };

interface Compound {
  tag: string | null;
  parts: SimplePart[];
}

interface Complex {
  compounds: Compound[];
  combinators: Combinator[];
}

const ATTRIBUTE_OPERATORS = ["~=", "|=", "^=", "$=", "*=", "!=", "="] as const;
const ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ASCII_LOWER = "abcdefghijklmnopqrstuvwxyz";

const NEVER_MATCH_PSEUDOS = new Set(["visited", "hover", "active", "focus", "target"]);

function isIdentStart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[A-Za-z_-]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

function isIdentPart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[A-Za-z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;

  const parts: string[] = [];
  const segments = value.split("'");
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) parts.push(`"'"`);
    if (segments[i]!.length > 0) parts.push(`"${segments[i]!}"`);
  }
  return `concat(${parts.join(",")})`;
}

class Parser {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): Complex[] {
    this.#skipWhitespace();
    if (this.#done()) throw new CssSelectorError("Empty selector");

    const group = [this.#parseComplex()];
    this.#skipWhitespace();
    while (this.#peek() === ",") {
      this.#index++;
      this.#skipWhitespace();
      group.push(this.#parseComplex());
      this.#skipWhitespace();
    }

    if (!this.#done()) {
      throw new CssSelectorError(`Unexpected '${this.#peek()}' at position ${this.#index}`);
    }
    return group;
  }

  #parseComplex(): Complex {
    const compounds = [this.#parseCompound()];
    const combinators: Combinator[] = [];

    for (;;) {
      const hadWhitespace = this.#skipWhitespace();
      const ch = this.#peek();
      if (ch === undefined || ch === ",") break;

      if (ch === ">" || ch === "+" || ch === "~") {
        this.#index++;
        this.#skipWhitespace();
        combinators.push(ch);
        compounds.push(this.#parseCompound());
        continue;
      }

      if (!hadWhitespace) {
        throw new CssSelectorError(`Unexpected '${ch}' at position ${this.#index}`);
      }

      combinators.push(" ");
      compounds.push(this.#parseCompound());
    }

    return { compounds, combinators };
  }

  #parseCompound(): Compound {
    const start = this.#index;
    let tag: string | null = null;
    const parts: SimplePart[] = [];

    const ch = this.#peek();
    if (ch === "*") {
      this.#index++;
      tag = "*";
    } else if (isIdentStart(ch)) {
      tag = this.#readIdent().toLowerCase();
    }

    for (;;) {
      const next = this.#peek();
      if (next === ".") {
        this.#index++;
        parts.push({ kind: "class", name: this.#readIdent() });
      } else if (next === "#") {
        this.#index++;
        parts.push({ kind: "id", name: this.#readIdent() });
      } else if (next === "[") {
        parts.push(this.#parseAttribute());
      } else if (next === ":") {
        parts.push(this.#parsePseudo());
      } else {
        break;
      }
    }

    if (tag === null && parts.length === 0) {
      throw new CssSelectorError(
        this.#done()
          ? `Expected a selector at position ${start}`
          : `Unexpected '${this.#peek()}' at position ${this.#index}`,
      );
    }

    return { tag, parts };
  }

  #parseAttribute(): SimplePart {
    this.#expect("[");
    this.#skipWhitespace();
    const name = this.#readIdent().toLowerCase();
    this.#skipWhitespace();

    if (this.#peek() === "]") {
      this.#index++;
      return { kind: "attr", name };
    }

    let operator: string | undefined;
    for (const candidate of ATTRIBUTE_OPERATORS) {
      if (this.#text.startsWith(candidate, this.#index)) {
        operator = candidate;
        this.#index += candidate.length;
        break;
      }
    }
    if (!operator) {
      throw new CssSelectorError(
        `Unsupported attribute operator in '${this.#text}' at position ${this.#index}`,
      );
    }

    this.#skipWhitespace();
    const value = this.#readValue();
    this.#skipWhitespace();

    let flag: string | undefined;
    const maybeFlag = this.#peek()?.toLowerCase();
    if (maybeFlag === "i" || maybeFlag === "s") {
      flag = maybeFlag;
      this.#index++;
      this.#skipWhitespace();
    }

    this.#expect("]");
    return { kind: "attr", name, op: operator, value, flag };
  }

  #parsePseudo(): SimplePart {
    this.#expect(":");

    if (this.#peek() === ":") {
      this.#index++;
      const name = this.#readIdent().toLowerCase();
      const argument = this.#peek() === "(" ? this.#readParenthesised() : undefined;
      return { kind: "pseudo-element", name, argument };
    }

    const name = this.#readIdent().toLowerCase();
    const argument = this.#peek() === "(" ? this.#readParenthesised() : undefined;
    return { kind: "pseudo", name, argument };
  }

  #readIdent(): string {
    if (this.#peek() === "\\") {
      throw new CssSelectorError("Escaped identifiers are not supported");
    }

    const start = this.#index;
    while (isIdentPart(this.#peek())) this.#index++;
    if (start === this.#index) {
      throw new CssSelectorError(
        `Expected an identifier at position ${this.#index} in '${this.#text}'`,
      );
    }
    return this.#text.slice(start, this.#index);
  }

  #readValue(): string {
    const quote = this.#peek();
    if (quote === "'" || quote === '"') {
      this.#index++;
      let value = "";
      while (!this.#done() && this.#peek() !== quote) {
        if (this.#peek() === "\\") {
          this.#index++;
          value += this.#peek() ?? "";
          this.#index++;
        } else {
          value += this.#peek();
          this.#index++;
        }
      }
      this.#expect(quote!);
      return value;
    }
    return this.#readIdent();
  }

  #readParenthesised(): string {
    this.#expect("(");
    let depth = 1;
    let quote: string | null = null;
    const start = this.#index;

    while (!this.#done()) {
      const ch = this.#peek()!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          const argument = this.#text.slice(start, this.#index);
          this.#index++;
          return argument.trim();
        }
      }
      this.#index++;
    }

    throw new CssSelectorError("Unclosed parenthesis in selector");
  }

  #skipWhitespace(): boolean {
    const start = this.#index;
    while (/\s/.test(this.#peek() ?? "")) this.#index++;
    return this.#index > start;
  }

  #peek(): string | undefined {
    return this.#text[this.#index];
  }

  #done(): boolean {
    return this.#index >= this.#text.length;
  }

  #expect(ch: string): void {
    if (this.#peek() !== ch) {
      throw new CssSelectorError(
        `Expected '${ch}' at position ${this.#index} in '${this.#text}'`,
      );
    }
    this.#index++;
  }
}

// ---- translation ---------------------------------------------------------

function attributeReference(name: string, value: string | undefined, flag: string | undefined): {
  reference: string;
  value: string | undefined;
} {
  if (flag === "i") {
    return {
      reference: `translate(${`@${name}`}, ${xpathLiteral(ASCII_UPPER)}, ${xpathLiteral(ASCII_LOWER)})`,
      value: value === undefined ? undefined : value.toLowerCase(),
    };
  }
  if (flag === "s") {
    return { reference: `@${name}`, value };
  }
  return { reference: `@${name}`, value };
}

function attributeCondition(part: {
  name: string;
  op?: string;
  value?: string;
  flag?: string;
}): string {
  const { reference, value } = attributeReference(part.name, part.value, part.flag);
  const literal = value === undefined ? undefined : xpathLiteral(value);

  switch (part.op) {
    case undefined:
      return reference;
    case "=":
      return `${reference} = ${literal}`;
    case "!=":
      return value
        ? `not(${reference}) or ${reference} != ${literal}`
        : `${reference} != ${literal}`;
    case "~=":
      return value
        ? `${reference} and contains(${reference}, ${literal}) and contains(concat(' ', normalize-space(${reference}), ' '), ${xpathLiteral(` ${value} `)})`
        : "0";
    case "|=":
      return `${reference} and (${reference} = ${literal} or starts-with(${reference}, ${xpathLiteral(`${value}-`)}))`;
    case "^=":
      return value ? `${reference} and starts-with(${reference}, ${literal})` : "0";
    case "$=":
      return value
        ? `${reference} and substring(${reference}, string-length(${reference})-${value.length - 1}) = ${literal}`
        : "0";
    case "*=":
      return value ? `${reference} and contains(${reference}, ${literal})` : "0";
    default:
      throw new CssSelectorError(`Unsupported attribute operator '${part.op}'`);
  }
}

function parseNthSeries(argument: string): { a: number; b: number } {
  const text = argument.replace(/\s+/g, "").toLowerCase();
  if (text === "odd") return { a: 2, b: 1 };
  if (text === "even") return { a: 2, b: 0 };

  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(text);
  if (match) {
    const rawA = match[1]!;
    const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : Number(rawA);
    const b = match[2] === undefined ? 0 : Number(match[2]);
    return { a, b };
  }

  if (/^[+-]?\d+$/.test(text)) return { a: 0, b: Number(text) };

  throw new CssSelectorError(`Invalid nth expression '${argument}'`);
}

function nthCondition(
  series: { a: number; b: number },
  tag: string | null,
  last: boolean,
  ofType: boolean,
): string | null {
  const { a } = series;
  const bMinus1 = series.b - 1;

  if (a === 1 && bMinus1 <= 0) return null;
  if (a < 0 && bMinus1 < 0) return "0";

  let nodeTest = "*";
  if (ofType) {
    if (!tag || tag === "*") {
      throw new CssSelectorError(
        ":nth-of-type() requires a concrete element type, like cssselect",
      );
    }
    nodeTest = tag;
  }

  const siblingCount = last
    ? `count(following-sibling::${nodeTest})`
    : `count(preceding-sibling::${nodeTest})`;

  if (a === 0) return `${siblingCount} = ${bMinus1}`;

  const expressions: string[] = [];
  if (a > 0) {
    if (bMinus1 > 0) expressions.push(`${siblingCount} >= ${bMinus1}`);
  } else {
    expressions.push(`${siblingCount} <= ${bMinus1}`);
  }

  if (Math.abs(a) !== 1) {
    let left = siblingCount;
    const modulus = Math.abs(a);
    const shift = ((-bMinus1 % modulus) + modulus) % modulus;
    if (shift !== 0) left = `(${left} +${shift})`;
    expressions.push(`${left} mod ${a} = 0`);
  }

  return expressions.length > 1
    ? expressions.map((expression) => `(${expression})`).join(" and ")
    : expressions[0]!;
}

function pseudoCondition(
  name: string,
  argument: string | undefined,
  tag: string | null,
): string | null {
  switch (name) {
    case "root":
      return "not(parent::*)";
    case "empty":
      return "not(*) and not(string-length())";
    case "first-child":
      return "count(preceding-sibling::*) = 0";
    case "last-child":
      return "count(following-sibling::*) = 0";
    case "only-child":
      return "count(preceding-sibling::*) = 0 and count(following-sibling::*) = 0";
    case "first-of-type":
      requireConcreteType(tag, "first-of-type");
      return `count(preceding-sibling::${tag}) = 0`;
    case "last-of-type":
      requireConcreteType(tag, "last-of-type");
      return `count(following-sibling::${tag}) = 0`;
    case "only-of-type":
      requireConcreteType(tag, "only-of-type");
      return `count(preceding-sibling::${tag}) = 0 and count(following-sibling::${tag}) = 0`;
    case "scope":
      return "position() = 1";
    case "nth-child":
      return nthCondition(parseNthSeries(argument ?? ""), tag, false, false);
    case "nth-last-child":
      return nthCondition(parseNthSeries(argument ?? ""), tag, true, false);
    case "nth-of-type":
      return nthCondition(parseNthSeries(argument ?? ""), tag, false, true);
    case "nth-last-of-type":
      return nthCondition(parseNthSeries(argument ?? ""), tag, true, true);
    case "checked":
      return (
        "(@selected and name(.) = 'option') or " +
        "(@checked and (name(.) = 'input' or name(.) = 'command') " +
        "and (@type = 'checkbox' or @type = 'radio'))"
      );
    case "link":
      return "@href and (name(.) = 'a' or name(.) = 'link' or name(.) = 'area')";
    case "contains": {
      const value = unquote(argument ?? "");
      return `contains(., ${xpathLiteral(value)})`;
    }
    case "lang": {
      const value = unquote(argument ?? "").toLowerCase();
      return (
        "ancestor-or-self::*[@lang][1][starts-with(concat(" +
        `translate(@lang, ${xpathLiteral(ASCII_UPPER)}, ${xpathLiteral(ASCII_LOWER)}), '-'), ` +
        `${xpathLiteral(`${value}-`)})]`
      );
    }
    case "not":
      return negatedCondition(argument ?? "");
    default:
      break;
  }

  if (NEVER_MATCH_PSEUDOS.has(name)) return "0";

  throw new CssSelectorError(`Unsupported pseudo-class ':${name}'`);
}

function requireConcreteType(tag: string | null, pseudo: string): void {
  if (!tag || tag === "*") {
    throw new CssSelectorError(`:${pseudo} requires a concrete element type, like cssselect`);
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function negatedCondition(argument: string): string {
  const parsed = new Parser(argument).parse();
  if (parsed.length !== 1) {
    throw new CssSelectorError(":not() accepts a single selector");
  }
  const complex = parsed[0]!;
  if (complex.combinators.length > 0 || complex.compounds.length > 1) {
    throw new CssSelectorError(":not() with combinators is not supported");
  }

  const compound = complex.compounds[0]!;
  const conditions = compoundConditions(compound);
  return conditions.length > 0 ? `not(${conditions.join(" and ")})` : "not(*)";
}

function compoundConditions(compound: Compound): string[] {
  const conditions: string[] = [];
  if (compound.tag && compound.tag !== "*") {
    conditions.push(`self::${compound.tag}`);
  }

  for (const part of compound.parts) {
    if (part.kind === "class") {
      conditions.push(
        `contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${part.name} `)})`,
      );
    } else if (part.kind === "id") {
      conditions.push(`@id = ${xpathLiteral(part.name)}`);
    } else if (part.kind === "attr") {
      conditions.push(attributeCondition(part));
    } else if (part.kind === "pseudo") {
      const condition = pseudoCondition(part.name, part.argument, compound.tag);
      if (condition) conditions.push(condition);
    } else {
      throw new CssSelectorError("Pseudo-elements are not supported inside :not()");
    }
  }

  return conditions;
}

function compoundStep(compound: Compound): { step: string; tag: string | null } {
  const tag = compound.tag ?? "*";
  const conditions = compoundConditions(compound);
  const predicates = conditions.map((condition) => `[${condition}]`).join("");
  return { step: `${tag}${predicates}`, tag };
}

function complexToXpath(complex: Complex): string {
  const { compounds, combinators } = complex;

  // A pseudo-element may only appear at the end of the final compound.
  let pseudoElement: Extract<SimplePart, { kind: "pseudo-element" }> | null = null;
  const last = compounds[compounds.length - 1]!;
  const trailing = last.parts[last.parts.length - 1];
  if (trailing && trailing.kind === "pseudo-element") {
    pseudoElement = trailing;
    last.parts = last.parts.slice(0, -1);
  }
  for (const compound of compounds) {
    for (const part of compound.parts) {
      if (part.kind === "pseudo-element") {
        throw new CssSelectorError(
          "Pseudo-elements are only supported at the end of a selector",
        );
      }
    }
  }

  let xpath = `descendant-or-self::${compoundStep(compounds[0]!).step}`;

  for (let i = 1; i < compounds.length; i++) {
    const combinator = combinators[i - 1]!;
    const step = compoundStep(compounds[i]!).step;

    if (combinator === " ") xpath += `/descendant::${step}`;
    else if (combinator === ">") xpath += `/child::${step}`;
    else if (combinator === "~") xpath += `/following-sibling::${step}`;
    else xpath += `/following-sibling::*[1]/self::${step}`;
  }

  if (pseudoElement) {
    if (pseudoElement.name === "text") {
      xpath += "/text()";
    } else if (pseudoElement.name === "attr") {
      const name = unquote(pseudoElement.argument ?? "");
      if (!name) throw new CssSelectorError("::attr() requires an attribute name");
      xpath += `/@${name}`;
    } else {
      throw new CssSelectorError(
        `Unsupported pseudo-element '::${pseudoElement.name}'`,
      );
    }
  }

  return xpath;
}

/**
 * Translates a CSS selector group into an XPath 1.0 expression rooted at
 * `descendant-or-self::`, matching Scrapling's `css_to_xpath`.
 */
export function cssToXpath(selector: string, prefix = "descendant-or-self::"): string {
  const group = new Parser(selector).parse();
  const expressions = group.map(complexToXpath);

  if (prefix !== "descendant-or-self::") {
    return expressions
      .map((expression) =>
        expression.startsWith("descendant-or-self::")
          ? prefix + expression.slice("descendant-or-self::".length)
          : expression,
      )
      .join(" | ");
  }

  return expressions.join(" | ");
}
