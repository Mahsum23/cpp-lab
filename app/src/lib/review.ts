/**
 * Spaced repetition, with the schedule deliberately blurred.
 *
 * The problem this solves is not "did you do today's lesson" — that part already works.
 * It's that Day 1 quietly rots while you're on Day 6, and nothing in the app ever asks
 * you about it again. A day you finished is treated as finished forever, which is the
 * one assumption memory does not honour.
 *
 * So every finished day leaves cards behind, and they come back on a widening interval:
 * a day, then a few, then a week, then a fortnight. Get one wrong and it drops back to
 * the start, because a fact you just failed to recall is not a fact you know.
 *
 * **Why the jitter.** A clean doubling schedule makes every card in a day's batch come
 * due on the same morning forever — you'd answer six questions about Day 2 in a row,
 * recognise the batch rather than the material, and get a pile of nothing on the days
 * between. Every interval here is scattered by up to 20%, so batches fray apart within
 * a couple of cycles and the deck arrives as a trickle instead of a lump. It also means
 * you genuinely cannot predict which day you're about to be asked about, which is the
 * difference between recall and recognition.
 *
 * Everything here is pure and takes its randomness as an argument, because a scheduler
 * you can't run twice with the same result is a scheduler you can't test.
 */
import { today } from './date';
import type { Day, DayProgress, ReviewCard, ReviewState } from './types';

/** How a card went. Recall is close enough to binary that finer grades are noise. */
export type Grade = 'again' | 'good';

/** Starting ease. SM-2 uses 2.5; slightly lower suits material this dense. */
export const START_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_INTERVAL = 120;

/** Interval scatter, each way. See the note above on why this exists at all. */
const JITTER = 0.2;

/** Chance that a card which isn't due yet gets thrown in anyway. */
const WILDCARD_CHANCE = 0.15;

/** Chance of being asked something on a day when nothing is actually due. */
const SURPRISE_CHANCE = 0.2;

export type Rng = () => number;

export const DAY_MS = 86_400_000;

export function newCard(now: Date = new Date()): ReviewCard {
  return { interval: 0, ease: START_EASE, streak: 0, due: today(now), seen: 0, lapses: 0, lastAt: null };
}

/** Scatter an interval so batches learned together don't stay together. */
function jitter(days: number, rng: Rng): number {
  if (days <= 1) return days;
  const spread = 1 + (rng() * 2 - 1) * JITTER;
  return Math.max(1, Math.round(days * spread));
}

/**
 * Advance one card after it's been answered.
 *
 * A miss is expensive on purpose: back to a one-day interval and the ease drops, so a
 * card you keep failing keeps coming back until it stops being one you fail.
 */
export function grade(
  card: ReviewCard,
  result: Grade,
  now: Date = new Date(),
  rng: Rng = Math.random,
  opts: { early?: boolean } = {},
): ReviewCard {
  const seen = card.seen + 1;
  const lastAt = now.toISOString();

  // Practising a card that wasn't due yet can hurt your schedule but not flatter it.
  // Getting it right when you asked for it early is weak evidence — you chose the card
  // and it was still fresh — so it records the attempt and leaves the interval alone.
  // Failing it is strong evidence either way, and still pulls the card back.
  if (opts.early && result === 'good') return { ...card, seen, lastAt };

  if (result === 'again') {
    return {
      interval: 1,
      ease: Math.max(MIN_EASE, card.ease - 0.2),
      streak: 0,
      due: today(new Date(now.getTime() + DAY_MS)),
      seen,
      lapses: card.lapses + 1,
      lastAt,
    };
  }

  // 1 day, then 3, then multiply. The first two steps are fixed because multiplying
  // up from zero gets you nowhere and multiplying up from one is too shallow to escape.
  const base = card.streak === 0 ? 1 : card.streak === 1 ? 3 : card.interval * card.ease;
  const interval = Math.min(MAX_INTERVAL, jitter(base, rng));
  return {
    interval,
    ease: Math.min(3, card.ease + 0.05),
    streak: card.streak + 1,
    due: today(new Date(now.getTime() + interval * DAY_MS)),
    seen,
    lapses: card.lapses,
    lastAt,
  };
}

// --- what cards exist -----------------------------------------------------

export type CardKind = 'quiz' | 'explain' | 'forge' | 'parsons';

export interface CardRef {
  id: string;
  kind: CardKind;
  dayId: string;
  /** Only on a quiz card: which question of that day's quiz. */
  questionId?: string;
}

const KINDS = new Set<string>(['quiz', 'explain', 'forge', 'parsons']);

export const cardId = (kind: CardKind, dayId: string, questionId?: string) =>
  questionId ? `${kind}:${dayId}:${questionId}` : `${kind}:${dayId}`;

export function parseCardId(id: string): CardRef | null {
  const [kind, dayId, questionId] = id.split(':');
  if (!dayId || !KINDS.has(kind)) return null;
  return { id, kind: kind as CardKind, dayId, ...(questionId ? { questionId } : {}) };
}

/**
 * Every card a day has earned the right to ask.
 *
 * Gated on having actually answered the quiz, not on having opened the day: being
 * asked to recall something you never learned isn't revision, it's just a wrong answer
 * with extra steps. The teach-back and forged cards additionally want the theory read,
 * since both are about explaining material rather than recognising an option.
 */
export function cardsFor(day: Day, progress: DayProgress | undefined): CardRef[] {
  if (!progress) return [];
  const cards: CardRef[] = [];

  for (const q of day.quiz ?? []) {
    if (q.id in progress.quiz.correct) {
      cards.push({ id: cardId('quiz', day.id, q.id), kind: 'quiz', dayId: day.id, questionId: q.id });
    }
  }
  if (progress.theoryDone && day.teachBack) {
    cards.push({ id: cardId('explain', day.id), kind: 'explain', dayId: day.id });
  }
  if (progress.theoryDone && day.theoryMarkdown) {
    cards.push({ id: cardId('forge', day.id), kind: 'forge', dayId: day.id });
  }
  // One per code block the lesson actually contains, indexed by position so the id is
  // stable as long as the block is.
  codeBlocksFor(day).forEach((_, i) => {
    cards.push({ id: cardId('parsons', day.id, String(i)), kind: 'parsons', dayId: day.id, questionId: String(i) });
  });
  return cards;
}

/**
 * The fenced code blocks in a day's theory, as line arrays.
 *
 * These are what the Parsons cards are built from, and they come from content the app
 * already has — so a card that asks you to reconstruct a program needs no model, no
 * network, and no compiler. That is the whole reason this card kind exists: it is the
 * only form of real code practice that survives being on a train with a phone.
 *
 * Blocks are filtered to a size worth reordering. Two lines is not a puzzle, and
 * anything past a dozen is a scrolling exercise on a phone rather than a recall one.
 */
export function codeBlocksFor(day: Day, min = 3, max = 12): string[][] {
  const md = day.theoryMarkdown;
  if (!md) return [];

  const blocks: string[][] = [];
  // Scanned line by line rather than matched with one regex. A regex that treats
  // ``` as both an opener and a closer will happily pair a *closing* fence with the
  // next *opening* one and hand you the prose in between, which is how the first
  // version of this dealt a card made of three sentences and a heading.
  let open: { lang: string; lines: string[] } | null = null;
  for (const line of md.split('\n')) {
    const fence = /^[ \t]*```(\w*)/.exec(line);
    if (fence) {
      if (open) {
        const lines = open.lines.filter((l) => l.trim());
        // Repeated lines mean more than one correct order exists, and marking one of
        // them wrong would be a lie.
        if (
          (open.lang === 'cpp' || open.lang === 'c') &&
          lines.length >= min &&
          lines.length <= max &&
          new Set(lines).size === lines.length
        ) {
          blocks.push(lines);
        }
        open = null;
      } else {
        open = { lang: fence[1].toLowerCase(), lines: [] };
      }
      continue;
    }
    open?.lines.push(line);
  }
  return blocks;
}

// --- selection ------------------------------------------------------------

const shuffle = <T>(items: T[], rng: Rng): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const isDue = (card: ReviewCard | undefined, on: string): boolean => !card || card.due <= on;

export function dueCards(deck: CardRef[], state: ReviewState, on: string): CardRef[] {
  return deck.filter((c) => isDue(state.cards[c.id], on));
}

/**
 * Choose what to ask next.
 *
 * Due cards come first, shuffled — not oldest-first, because a deterministic order is
 * one you start to anticipate. A wildcard is occasionally spliced in from the cards
 * that aren't due at all, which is the whole "ask me when I'm not ready" idea: the
 * schedule decides what you *owe*, not what you can be asked.
 */
export function pickNext(
  deck: CardRef[],
  state: ReviewState,
  on: string,
  rng: Rng = Math.random,
  exclude: ReadonlySet<string> = new Set(),
): CardRef | null {
  const pool = deck.filter((c) => !exclude.has(c.id));
  if (!pool.length) return null;

  const due = pool.filter((c) => isDue(state.cards[c.id], on));
  const resting = pool.filter((c) => !isDue(state.cards[c.id], on));

  if (due.length && resting.length && rng() < WILDCARD_CHANCE) return shuffle(resting, rng)[0];
  if (due.length) return shuffle(due, rng)[0];
  return shuffle(resting, rng)[0];
}

/**
 * Should opening the app lead with a review rather than the lesson?
 *
 * Once a day at most, so it stays an interruption rather than a toll booth. It fires
 * when something is genuinely due, and occasionally when nothing is — a deck that only
 * ever appears on a schedule is a deck you can feel coming.
 */
export function shouldAmbush(
  state: ReviewState,
  deck: CardRef[],
  on: string,
  rng: Rng = Math.random,
): boolean {
  if (!deck.length || state.lastAmbush === on) return false;
  if (dueCards(deck, state, on).length) return true;
  return rng() < SURPRISE_CHANCE;
}
