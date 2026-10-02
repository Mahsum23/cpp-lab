/**
 * Practice rounds: staying on one concept until it has landed.
 *
 * A lesson day introduces one idea. Before this, the next day introduced the next one,
 * whether or not the first had stuck, and the review deck had about a dozen cards per day
 * to say it with — so the same questions came round again and again. Now a concept that
 * has a practice bank (`day-NN-<slug>.practice.yaml`, 25–40 verified items) is practised
 * in rounds on the days after its lesson:
 *
 *   - a round is ROUND_SIZE items, mostly things to *write* from memory, the rest quick
 *     predict / choose items, and fresh ones first: an item is not dealt again while the
 *     bank still holds one you have not seen;
 *   - an item's first-ever attempt is what counts, so a round measures recall rather than
 *     remembering yesterday's answer;
 *   - a round that scores LAND_AT or better lands the concept, and the next lesson opens.
 *     "Move on anyway" opens it too, without pretending the concept landed.
 *
 * Pure on purpose: everything here is tested in node (scripts/test-practice.mjs).
 */
import type { Day, PracticeState } from './types';
import type { CardRef } from './review';

export const ROUND_SIZE = 10;
/** Of a round, how much is typed from memory rather than picked from options. */
export const WRITE_SHARE = 0.7;
/** First-try score that lands a concept. */
export const LAND_AT = 0.8;
/** A round this short can't land anything: 4 out of 4 is not evidence. */
export const MIN_ROUND = 6;

type Rng = () => number;

export const emptyPractice = (): PracticeState => ({ first: {}, rounds: [], landedAt: null, movedOn: false });

/** Every item in a day's bank, as review cards. */
export function bankCards(day: Day): CardRef[] {
  const p = day.practice;
  if (!p) return [];
  return [
    ...(p.write?.challenges ?? []).map((c) => ({ id: `write:${day.id}:${c.id}`, kind: 'write' as const, dayId: day.id, questionId: c.id })),
    ...p.drill.map((s) => ({ id: `drill:${day.id}:${s.id}`, kind: 'drill' as const, dayId: day.id, questionId: s.id })),
  ];
}

/** The key an item's first attempt is stored under. */
export const itemKey = (c: Pick<CardRef, 'kind' | 'questionId'>) => `${c.kind}:${c.questionId}`;

export interface PracticeStatus {
  total: number;
  /** Never dealt. */
  fresh: number;
  /** Missed at the first attempt — dealt again once the fresh ones run out. */
  missed: number;
  rounds: number;
  /** The last round's first-try score, 0–1, or null before any round. */
  last: number | null;
  landed: boolean;
  movedOn: boolean;
}

export function practiceStatus(day: Day, state: PracticeState | undefined): PracticeStatus {
  const s = state ?? emptyPractice();
  const cards = bankCards(day);
  const seen = cards.filter((c) => itemKey(c) in s.first);
  const last = s.rounds.at(-1);
  return {
    total: cards.length,
    fresh: cards.length - seen.length,
    missed: seen.filter((c) => s.first[itemKey(c)] === false).length,
    rounds: s.rounds.length,
    last: last && last.asked ? last.right / last.asked : null,
    landed: Boolean(s.landedAt),
    movedOn: s.movedOn,
  };
}

/** Whether this day's concept still holds the next lesson back. */
export function needsPractice(day: Day, state: PracticeState | undefined): boolean {
  if (!bankCards(day).length) return false;
  return !state?.landedAt && !state?.movedOn;
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The next round: fresh items first, in about the WRITE_SHARE mix; then, once the bank
 * has no fresh items left, the ones missed at the first attempt; then anything.
 *
 * Quick items are spread through the round rather than bunched, so it alternates
 * between typing and thinking instead of ending on a run of multiple choice.
 */
export function buildRound(day: Day, state: PracticeState | undefined, rng: Rng = Math.random, size = ROUND_SIZE): CardRef[] {
  const s = state ?? emptyPractice();
  const all = bankCards(day);
  const fresh = all.filter((c) => !(itemKey(c) in s.first));
  const missed = all.filter((c) => s.first[itemKey(c)] === false);
  const rest = all.filter((c) => s.first[itemKey(c)] === true);

  const wantWrite = Math.round(size * WRITE_SHARE);
  const pick = (pool: CardRef[], kind: 'write' | 'drill', n: number) => shuffle(pool.filter((c) => c.kind === kind), rng).slice(0, n);

  let writes = pick(fresh, 'write', wantWrite);
  let quick = pick(fresh, 'drill', size - writes.length);
  // A bank short of one kind fills the round with the other.
  if (writes.length + quick.length < size) {
    const used = new Set([...writes, ...quick].map((c) => c.id));
    writes = [...writes, ...pick(fresh.filter((c) => !used.has(c.id)), 'write', size - writes.length - quick.length)];
  }
  let chosen = [...writes, ...quick];
  for (const pool of [missed, rest]) {
    if (chosen.length >= size) break;
    const used = new Set(chosen.map((c) => c.id));
    chosen = [...chosen, ...shuffle(pool.filter((c) => !used.has(c.id)), rng).slice(0, size - chosen.length)];
  }

  // Interleave: the quick items at even spacing among the written ones.
  const w = shuffle(chosen.filter((c) => c.kind !== 'drill'), rng);
  const q = shuffle(chosen.filter((c) => c.kind === 'drill'), rng);
  if (!q.length) return w;
  const out: CardRef[] = [];
  const step = (w.length + q.length) / q.length;
  let next = step / 2;
  for (let i = 0, wi = 0, qi = 0; i < w.length + q.length; i++) {
    if (qi < q.length && (i >= next - 0.5 || wi >= w.length)) {
      out.push(q[qi++]);
      next += step;
    } else out.push(w[wi++]);
  }
  return out;
}

/** Record an item's first attempt. Later attempts never overwrite it. */
export function recordFirst(state: PracticeState, card: Pick<CardRef, 'kind' | 'questionId'>, right: boolean): PracticeState {
  const k = itemKey(card);
  if (k in state.first) return state;
  return { ...state, first: { ...state.first, [k]: right } };
}

/** Close a round. A round that clears the bar lands the concept. */
export function finishRound(state: PracticeState, asked: number, right: number, at = new Date().toISOString()): PracticeState {
  const rounds = [...state.rounds, { at, asked, right }];
  const lands = asked >= MIN_ROUND && right / asked >= LAND_AT;
  return { ...state, rounds, landedAt: state.landedAt ?? (lands ? at : null) };
}

/** Two devices' practice on the same day, combined. Nothing either did is lost. */
export function mergePractice(a: PracticeState | undefined, b: PracticeState | undefined): PracticeState | undefined {
  if (!a || !b) return a ?? b;
  const first = { ...b.first };
  // A first attempt is one event; if the devices disagree, the miss is the safer record.
  for (const [k, v] of Object.entries(a.first)) first[k] = k in first ? first[k] && v : v;
  const byAt = new Map([...b.rounds, ...a.rounds].map((r) => [r.at, r]));
  const rounds = [...byAt.values()].sort((x, y) => x.at.localeCompare(y.at));
  const landed = [a.landedAt, b.landedAt].filter(Boolean).sort()[0] ?? null;
  return { first, rounds, landedAt: landed, movedOn: a.movedOn || b.movedOn };
}
