// Faithful port of Python's difflib.SequenceMatcher, plus Python-compatible rounding.
//
// Why not a fuzzy-match library: Scrapling's scores are ratios produced by *this*
// algorithm, including its autojunk heuristic and its tie-breaking. Any other
// implementation would shift every relocation score.

/** Python treats str as a sequence of code points, not UTF-16 units. */
export function toSeq(x) {
  if (typeof x === "string") return Array.from(x);
  return Array.from(x);
}

const isJunk = () => false; // Scrapling always passes None

export class SequenceMatcher {
  constructor(a, b) {
    this.a = toSeq(a);
    this.b = toSeq(b);
    this._chainB();
  }

  _chainB() {
    const b = this.b;
    this.b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let arr = this.b2j.get(elt);
      if (!arr) {
        arr = [];
        this.b2j.set(elt, arr);
      }
      arr.push(i);
    }

    // isjunk is always None here, so bjunk stays empty.
    this.bjunk = new Set();

    // autojunk: for sequences >= 200 long, elements appearing more than
    // n/100 + 1 times are treated as popular and removed from b2j. This
    // materially changes ratios for long text.
    this.bpopular = new Set();
    const n = b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of this.b2j) {
        if (idxs.length > ntest) this.bpopular.add(elt);
      }
      for (const elt of this.bpopular) this.b2j.delete(elt);
    }
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const { a, b, b2j, bjunk } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();

    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const idxs = b2j.get(a[i]);
      if (idxs) {
        for (const j of idxs) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }

    const eq = (x, y) => x === y;
    while (besti > alo && bestj > blo && bjunk.has(b[bestj - 1]) && eq(a[besti - 1], b[bestj - 1])) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      bjunk.has(b[bestj + bestsize]) &&
      eq(a[besti + bestsize], b[bestj + bestsize])
    ) {
      bestsize++;
    }
    while (besti > alo && bestj > blo && !bjunk.has(b[bestj - 1]) && eq(a[besti - 1], b[bestj - 1])) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      !bjunk.has(b[bestj + bestsize]) &&
      eq(a[besti + bestsize], b[bestj + bestsize])
    ) {
      bestsize++;
    }

    return [besti, bestj, bestsize];
  }

  getMatchingBlocks() {
    if (this._mb) return this._mb;
    const la = this.a.length;
    const lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const blocks = [];

    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }

    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);

    this._mb = nonAdjacent;
    return this._mb;
  }

  ratio() {
    let matches = 0;
    for (const t of this.getMatchingBlocks()) matches += t[2];
    const len = this.a.length + this.b.length;
    return len ? (2.0 * matches) / len : 1.0;
  }
}

export const ratio = (a, b) => new SequenceMatcher(a, b).ratio();

/**
 * Python's round(x, 2): correctly-rounded decimal, ties to even — NOT JS
 * Math.round (ties away from zero). Scores are bucketed by this value, so a
 * rounding difference changes which elements tie for "best".
 */
export function pyRound2(x) {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const s = Math.abs(x).toFixed(40); // exact for the magnitudes we score
  const [ip, fracRaw] = s.split(".");
  const frac = (fracRaw || "").padEnd(40, "0");
  let n = BigInt(ip + frac.slice(0, 2));
  const rest = frac.slice(2);
  const first = rest[0] || "0";
  const restNonZero = /[1-9]/.test(rest.slice(1));
  if (first > "5" || (first === "5" && (restNonZero || n % 2n === 1n))) n += 1n;
  const out = Number(n) / 100;
  return neg ? -out : out;
}
