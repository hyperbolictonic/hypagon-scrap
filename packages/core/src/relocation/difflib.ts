/**
 * Faithful port of Python's `difflib.SequenceMatcher`, plus Python-compatible
 * rounding.
 *
 * Scrapling's relocation scores are ratios produced by *this* algorithm,
 * including its autojunk heuristic. A generic fuzzy-match library would shift
 * every score, so this is a deliberate line-by-line port rather than a
 * dependency.
 */

type Sequence = readonly string[];

function toSeq(value: string | readonly string[]): Sequence {
  // Python strings are sequences of code points, not UTF-16 code units.
  return typeof value === "string" ? Array.from(value) : value;
}

export class SequenceMatcher {
  readonly a: Sequence;
  readonly b: Sequence;

  readonly #b2j = new Map<string, number[]>();

  constructor(a: string | readonly string[], b: string | readonly string[]) {
    this.a = toSeq(a);
    this.b = toSeq(b);
    this.#chainB();
  }

  #chainB(): void {
    const b = this.b;
    const b2j = this.#b2j;

    for (let i = 0; i < b.length; i++) {
      const elt = b[i]!;
      const indices = b2j.get(elt);
      if (indices) indices.push(i);
      else b2j.set(elt, [i]);
    }

    // autojunk: for sequences >= 200 long, elements occurring more than
    // n/100 + 1 times are dropped from the index. This materially changes
    // ratios for long text, so it is not optional.
    const n = b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      const popular: string[] = [];
      for (const [elt, indices] of b2j) {
        if (indices.length > ntest) popular.push(elt);
      }
      for (const elt of popular) b2j.delete(elt);
    }
  }

  #findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    const { a, b } = this;
    const b2j = this.#b2j;

    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();

    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      const indices = b2j.get(a[i]!);
      if (indices) {
        for (const j of indices) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          next.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = next;
    }

    // isjunk is always None in Scrapling, so only the non-junk extension
    // passes can change the result.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }

    return [besti, bestj, bestsize];
  }

  getMatchingBlocks(): Array<[number, number, number]> {
    const la = this.a.length;
    const lb = this.b.length;
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const blocks: Array<[number, number, number]> = [];

    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const [i, j, k] = this.#findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }

    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Array<[number, number, number]> = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1 > 0) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1 > 0) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);

    return nonAdjacent;
  }

  ratio(): number {
    let matches = 0;
    for (const block of this.getMatchingBlocks()) matches += block[2];
    const length = this.a.length + this.b.length;
    return length === 0 ? 1.0 : (2.0 * matches) / length;
  }
}

export function ratio(a: string | readonly string[], b: string | readonly string[]): number {
  return new SequenceMatcher(a, b).ratio();
}

/**
 * Python's `round(x, 2)`: correctly rounded decimal, ties to even — not
 * `Math.round` (ties away from zero). Scores are bucketed by this value, so a
 * rounding difference changes which elements tie for "best".
 */
export function pyRound2(x: number): number {
  if (!Number.isFinite(x)) return x;

  const negative = x < 0;
  const text = Math.abs(x).toFixed(40); // exact for the magnitudes scored here
  const [integer, fractionRaw = ""] = text.split(".") as [string, string?];
  const fraction = fractionRaw.padEnd(40, "0");

  let hundredths = BigInt(integer + fraction.slice(0, 2));
  const rest = fraction.slice(2);
  const first = rest[0] ?? "0";
  const restNonZero = /[1-9]/.test(rest.slice(1));

  if (first > "5" || (first === "5" && (restNonZero || hundredths % 2n === 1n))) {
    hundredths += 1n;
  }

  const result = Number(hundredths) / 100;
  return negative ? -result : result;
}
