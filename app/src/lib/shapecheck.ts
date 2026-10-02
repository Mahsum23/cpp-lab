/**
 * Judging code you typed from memory, when the code cannot be run.
 *
 * SQL is judged by running it (writecheck.ts). Go and C++ cannot be run in a browser at a
 * size worth shipping: a Go interpreter that fits gets `defer` wrong and the loop-variable
 * rule wrong, which is worse than not judging at all, and a C++ compiler is tens of
 * megabytes and could not open a socket anyway. So these cards are judged by *shape*: the
 * answer is tokenized (comments and whitespace gone) and must contain the constructs the
 * card asks for, in patterns that allow the spellings that are equally right.
 *
 * Shape is not behaviour, and the card files say how it is kept honest: every reference
 * answer, every alternative and every deliberately wrong example is run through the real
 * `go` / `g++` in a harness, and the judge is mutation-tested against them
 * (scripts/check-shape-cards.mjs). A card whose pattern accepts something the real
 * compiler rejects fails that check.
 *
 * Pure on purpose — no DOM, no engine — so every rule below is tested in node.
 */

export type ShapeLang = 'go' | 'cpp';

export interface Tok {
  /** The token's text, as written. */
  t: string;
  k: 'id' | 'num' | 'str' | 'op';
  /** Where it sits in the source, so a mutation can edit the original text. */
  s: number;
  e: number;
}

export interface Lexed {
  toks: Tok[];
  /** Set when the text cannot be tokenized at all (an unclosed string or comment). */
  error: string | null;
}

// Longest first. `>>` and `>>=` are left out for C++ on purpose: in `vector<vector<int>>`
// they are two closers, and for matching it is simpler that they are always two tokens.
const OPS_COMMON = ['...', '++', '--', '<<', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<='];
const OPS_GO = ['&^=', '&^', ':=', '<-', '>>', '>>='];
const OPS_CPP = ['->*', '<=>', '::', '->', '.*'];

const opsFor = (lang: ShapeLang) =>
  [...OPS_COMMON, ...(lang === 'go' ? OPS_GO : OPS_CPP)].sort((a, b) => b.length - a.length);

const NUMBER = /^(0[xX][0-9a-fA-F_']+|0[bB][01_']+|0[oO][0-7_]+|(\d[\d_']*)?\.?\d[\d_']*([eE][+-]?\d+)?)[uUlLfFi]*/;
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u;

export function tokenize(src: string, lang: ShapeLang): Lexed {
  const toks: Tok[] = [];
  const ops = opsFor(lang);
  let i = 0;
  const push = (t: string, k: Tok['k'], s: number, e: number) => toks.push({ t, k, s, e });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return { toks, error: 'a comment is never closed' };
      i = end + 2;
      continue;
    }
    const start = i;
    // C++ raw string: R"delim( ... )delim"
    if (lang === 'cpp' && c === 'R' && src[i + 1] === '"') {
      const open = src.indexOf('(', i + 2);
      const delim = open < 0 ? '' : src.slice(i + 2, open);
      const close = open < 0 ? -1 : src.indexOf(`)${delim}"`, open);
      if (close < 0) return { toks, error: 'a string is never closed' };
      i = close + delim.length + 2;
      push(src.slice(start, i), 'str', start, i);
      continue;
    }
    if (c === '"' || (c === "'" && lang === 'cpp' && !/\d/.test(src[i - 1] ?? '')) || (c === "'" && lang === 'go')) {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') return { toks, error: 'a string or character literal is never closed' };
        i++;
      }
      if (i >= src.length) return { toks, error: 'a string or character literal is never closed' };
      i++;
      push(src.slice(start, i), 'str', start, i);
      continue;
    }
    if (c === '`' && lang === 'go') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) return { toks, error: 'a raw string is never closed' };
      i = end + 1;
      push(src.slice(start, i), 'str', start, i);
      continue;
    }
    const rest = src.slice(i);
    const num = (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) ? NUMBER.exec(rest) : null;
    if (num) {
      i += num[0].length;
      push(num[0], 'num', start, i);
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      i += id[0].length;
      push(id[0], 'id', start, i);
      continue;
    }
    const op = ops.find((o) => rest.startsWith(o));
    if (op) {
      i += op.length;
      push(op, 'op', start, i);
      continue;
    }
    i++;
    push(c, 'op', start, i);
  }
  return { toks, error: null };
}

/**
 * Spellings that mean the same thing in C++ and are not worth asking a learner to
 * match: `std::` (so `memset` and `std::memset` agree), a leading `::`, and the
 * elaborated `struct` in `struct sockaddr_in`. Applied to the answer and to the patterns.
 */
export function normalize(toks: Tok[], lang: ShapeLang): Tok[] {
  if (lang !== 'cpp') return toks;
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.t === 'std' && next?.t === '::') {
      i++;
      continue;
    }
    if (t.t === '::' && next?.k === 'id' && !(out.at(-1)?.k === 'id' || out.at(-1)?.t === '>')) continue;
    if (t.t === 'struct' && next?.k === 'id') continue;
    out.push(t);
  }
  return out;
}

/** Brackets must pair up; a string that never closes already failed in tokenize. */
export function unbalanced(toks: Tok[]): string | null {
  const close: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const { t, k } of toks) {
    if (k !== 'op') continue;
    if (t === '(' || t === '[' || t === '{') stack.push(t);
    else if (close[t]) {
      if (stack.pop() !== close[t]) return `a "${t}" has nothing matching it`;
    }
  }
  return stack.length ? `a "${stack.at(-1)}" is never closed` : null;
}

// --- patterns ---------------------------------------------------------------

/**
 * A pattern is plain code with a few holes:
 *
 *   `$name`      one identifier; the same name later must be the same identifier
 *   `$any`       exactly one token of any kind
 *   `$num`       a number          `$str`  a string       `$str=text`  a string containing `text`
 *   `$*`  `$+`   any run of tokens (zero or more / one or more), brackets balanced
 *   `\( a \| b \)`   either a or b (leave one side empty for "optional")
 *   `@name`      a fragment the card file defined under `defs`
 *
 * Whitespace and comments do not matter, exactly as in the answer.
 */
type PItem =
  | { k: 'lit'; t: string }
  | { k: 'var'; name: string }
  | { k: 'any' }
  | { k: 'num' }
  | { k: 'str'; has: string | null }
  | { k: 'seq'; min: 0 | 1 }
  | { k: 'alt'; alts: PItem[][] };

export function expandDefs(text: string, defs: Record<string, string> = {}, depth = 0): string {
  if (depth > 6) throw new Error('definitions refer to each other in a loop');
  return text.replace(/@([A-Za-z][A-Za-z0-9_]*)/g, (_, name: string) => {
    const body = defs[name];
    if (body === undefined) throw new Error(`pattern uses @${name}, which is not in defs`);
    return `\\( ${expandDefs(body, defs, depth + 1)} \\)`;
  });
}

export function compilePattern(text: string, lang: ShapeLang, defs: Record<string, string> = {}): PItem[] {
  const src = expandDefs(text, defs);
  let pos = 0;

  const lits = (chunk: string): PItem[] => {
    const lexed = tokenize(chunk, lang);
    if (lexed.error) throw new Error(`pattern "${text}": ${lexed.error}`);
    return normalize(lexed.toks, lang).map((t) => ({ k: 'lit', t: t.t }) as PItem);
  };

  function parseSeq(): { items: PItem[]; ended: 'eof' | 'bar' | 'close' } {
    const items: PItem[] = [];
    let chunk = '';
    const flush = () => {
      if (chunk.trim()) items.push(...lits(chunk));
      chunk = '';
    };
    while (pos < src.length) {
      if (src.startsWith('\\(', pos)) {
        flush();
        pos += 2;
        const alts: PItem[][] = [];
        for (;;) {
          const r = parseSeq();
          alts.push(r.items);
          if (r.ended === 'close') break;
          if (r.ended === 'eof') throw new Error(`pattern "${text}": a \\( is never closed`);
        }
        items.push({ k: 'alt', alts });
        continue;
      }
      if (src.startsWith('\\|', pos)) {
        flush();
        pos += 2;
        return { items, ended: 'bar' };
      }
      if (src.startsWith('\\)', pos)) {
        flush();
        pos += 2;
        return { items, ended: 'close' };
      }
      if (src[pos] === '$') {
        const m = /^\$(\*|\+|[A-Za-z][A-Za-z0-9]*)(=\S+)?/.exec(src.slice(pos));
        if (m) {
          flush();
          pos += m[0].length;
          const name = m[1];
          if (name === '*') items.push({ k: 'seq', min: 0 });
          else if (name === '+') items.push({ k: 'seq', min: 1 });
          else if (name === 'any') items.push({ k: 'any' });
          else if (name === 'num') items.push({ k: 'num' });
          else if (name === 'str') items.push({ k: 'str', has: m[2] ? m[2].slice(1) : null });
          else items.push({ k: 'var', name });
          continue;
        }
      }
      chunk += src[pos++];
    }
    flush();
    return { items, ended: 'eof' };
  }

  const top = parseSeq();
  if (top.ended !== 'eof') throw new Error(`pattern "${text}": a stray \\| or \\)`);
  return top.items;
}

type Env = Record<string, string>;

function m(items: PItem[], p: number, toks: Tok[], i: number, env: Env, cont: (i: number, env: Env) => boolean): boolean {
  if (p === items.length) return cont(i, env);
  const it = items[p];
  const tok = toks[i];
  switch (it.k) {
    case 'lit':
      return tok !== undefined && tok.t === it.t && m(items, p + 1, toks, i + 1, env, cont);
    case 'var': {
      if (!tok || tok.k !== 'id') return false;
      const bound = env[it.name];
      if (bound !== undefined && bound !== tok.t) return false;
      return m(items, p + 1, toks, i + 1, bound === undefined ? { ...env, [it.name]: tok.t } : env, cont);
    }
    case 'any':
      return tok !== undefined && m(items, p + 1, toks, i + 1, env, cont);
    case 'num':
      return tok?.k === 'num' && m(items, p + 1, toks, i + 1, env, cont);
    case 'str':
      return tok?.k === 'str' && (it.has === null || tok.t.includes(it.has)) && m(items, p + 1, toks, i + 1, env, cont);
    case 'seq': {
      let depth = 0;
      for (let j = 0; ; j++) {
        if (j >= it.min && depth === 0 && m(items, p + 1, toks, i + j, env, cont)) return true;
        const t = toks[i + j];
        if (!t) return false;
        if (t.k === 'op') {
          if (t.t === '(' || t.t === '[' || t.t === '{') depth++;
          else if (t.t === ')' || t.t === ']' || t.t === '}') {
            depth--;
            if (depth < 0) return false;
          }
        }
      }
    }
    case 'alt':
      for (const a of it.alts) {
        if (m(a, 0, toks, i, env, (i2, env2) => m(items, p + 1, toks, i2, env2, cont))) return true;
      }
      return false;
  }
}

/** Every place the pattern matches at or after `from`, as [start, end, bindings]. */
function* matches(items: PItem[], toks: Tok[], from: number, env: Env): Generator<[number, number, Env]> {
  // A pattern that starts with a name matches that name, not the tail of `x.name`,
  // `x->name` or `ns::name` — otherwise `printf(` would be satisfied by `anything::printf(`.
  const first = items[0];
  const startsWithName = first !== undefined && (first.k === 'var' || (first.k === 'lit' && /^[\p{L}_]/u.test(first.t)));
  for (let s = from; s <= toks.length; s++) {
    const before = toks[s - 1];
    if (startsWithName && before?.k === 'op' && (before.t === '::' || before.t === '.' || before.t === '->')) continue;
    const found: [number, number, Env][] = [];
    m(items, 0, toks, s, env, (e, env2) => {
      found.push([s, e, env2]);
      return false; // keep going: every way of matching is a candidate
    });
    for (const f of found) yield f;
  }
}

// --- the judge --------------------------------------------------------------

export interface ShapeRequire {
  /** What is being asked for, in words that describe it rather than spell it. */
  say: string;
  /** One pattern that must appear somewhere in the answer... */
  match?: string;
  /** ...or several that must appear in this order. */
  then?: string[];
}

export interface ShapeForbid {
  say: string;
  match: string;
}

export interface ShapeSpec {
  requires: ShapeRequire[];
  forbids?: ShapeForbid[];
}

export interface ShapeItem {
  ok: boolean;
  say: string;
  kind: 'require' | 'forbid' | 'syntax';
}

export interface ShapeReport {
  ok: boolean;
  items: ShapeItem[];
}

/** One requirement, found somewhere at or after `from`; the first way it fits wins. */
function satisfy(req: ShapeRequire, toks: Tok[], lang: ShapeLang, defs: Record<string, string>, env: Env): Env | null {
  const parts = (req.then ?? (req.match !== undefined ? [req.match] : [])).map((p) => compilePattern(p, lang, defs));
  if (!parts.length) throw new Error(`requirement "${req.say}" has neither match nor then`);
  const go = (k: number, from: number, e: Env): Env | null => {
    if (k === parts.length) return e;
    for (const [, end, env2] of matches(parts[k], toks, from, e)) {
      const r = go(k + 1, end, env2);
      if (r) return r;
    }
    return null;
  };
  return go(0, 0, env);
}

export function judge(code: string, lang: ShapeLang, spec: ShapeSpec, defs: Record<string, string> = {}): ShapeReport {
  const lexed = tokenize(code, lang);
  const problem = lexed.error ?? unbalanced(lexed.toks);
  if (problem) {
    return { ok: false, items: [{ ok: false, kind: 'syntax', say: `This doesn't parse: ${problem}.` }] };
  }
  const toks = normalize(lexed.toks, lang);
  const items: ShapeItem[] = [];
  let env: Env = {};
  for (const req of spec.requires) {
    const got = satisfy(req, toks, lang, defs, env);
    if (got) env = got;
    items.push({ ok: Boolean(got), kind: 'require', say: req.say });
  }
  for (const f of spec.forbids ?? []) {
    const pat = compilePattern(f.match, lang, defs);
    const hit = matches(pat, toks, 0, {}).next().done === false;
    if (hit) items.push({ ok: false, kind: 'forbid', say: f.say });
  }
  return { ok: items.every((i) => i.ok), items };
}

/** The same token stream, for comparing two answers that may only differ in layout. */
export const shapeKey = (code: string, lang: ShapeLang): string =>
  normalize(tokenize(code, lang).toks, lang).map((t) => t.t).join(' ');
