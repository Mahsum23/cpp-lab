/**
 * test-review.mjs — the spaced-repetition scheduler.
 *
 * This is the part of the app with no visible failure mode. A schedule that quietly
 * drifts wrong doesn't crash or look broken; it just stops asking about Day 1, and you
 * find out months later by not knowing Day 1. So it gets tested properly, with the
 * randomness injected rather than left to chance.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bundle = async (entry, name) => {
  const out = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, format: 'esm', write: false,
  });
  const file = join(tmpdir(), name);
  writeFileSync(file, out.outputFiles[0].text);
  return import(file);
};

const R = await bundle('../src/lib/review.ts', 'cpp-lab-review.mjs');
const M = await bundle('../src/lib/merge.ts', 'cpp-lab-merge-review.mjs');
const { today } = await bundle('../src/lib/date.ts', 'cpp-lab-date.mjs');
const { grade, newCard, cardsFor, pickNext, dueCards, shouldAmbush, parseCardId, cardId, START_EASE } = R;

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `  << ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

/** A fixed sequence standing in for Math.random, so every case is reproducible. */
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
/** No jitter: 0.5 is the midpoint, so an interval comes back exactly as calculated. */
const mid = () => 0.5;

const NOW = new Date('2026-09-07T10:00:00Z');
const at = (days) => new Date(NOW.getTime() + days * 86_400_000);

console.log('\n— the interval ladder —');
let c = newCard(NOW);
ok('a new card is due immediately', c.due === today(NOW) && c.interval === 0);

c = grade(c, 'good', NOW, mid);
ok('first correct answer books it a day out', c.interval === 1, JSON.stringify(c));
c = grade(c, 'good', NOW, mid);
ok('second goes to three days', c.interval === 3, String(c.interval));
// Two correct answers have nudged ease to 2.4, so the third step is 3 * 2.4, and with
// the midpoint roll no jitter is applied to it.
ok('ease has climbed with the run', Math.abs(c.ease - (START_EASE + 0.1)) < 1e-9, String(c.ease));
c = grade(c, 'good', NOW, mid);
ok('third multiplies by ease', c.interval === 7, String(c.interval));
ok('the streak counts up', c.streak === 3, String(c.streak));
ok('intervals are capped', grade({ ...c, interval: 1000, streak: 9 }, 'good', NOW, mid).interval === 120);

console.log('\n— a miss is expensive —');
const strong = { interval: 60, ease: 2.6, streak: 5, due: '2026-11-01', seen: 5, lapses: 0, lastAt: null };
const missed = grade(strong, 'again', NOW, mid);
ok('a miss drops straight back to one day', missed.interval === 1, String(missed.interval));
ok('and it comes back tomorrow, not today', missed.due === today(at(1)), missed.due);
ok('the streak resets', missed.streak === 0);
ok('ease drops', missed.ease < strong.ease);
ok('the lapse is counted', missed.lapses === 1);
ok('ease has a floor', grade({ ...strong, ease: 1.3 }, 'again', NOW, mid).ease === 1.3);

console.log('\n— jitter scatters a batch —');
// Same card, same day, different rolls: the whole point is that these disagree.
const a = grade({ ...newCard(NOW), streak: 2, interval: 10, ease: 2.5 }, 'good', NOW, () => 0);
const b = grade({ ...newCard(NOW), streak: 2, interval: 10, ease: 2.5 }, 'good', NOW, () => 1);
ok('a low roll pulls the interval in', a.interval < 25, String(a.interval));
ok('a high roll pushes it out', b.interval > 25, String(b.interval));
ok('but never below one day', grade({ ...newCard(NOW), streak: 2, interval: 1, ease: 1.3 }, 'good', NOW, () => 0).interval >= 1);
ok('and stays within 20% either way', a.interval >= 20 && b.interval <= 30, `${a.interval}..${b.interval}`);

console.log('\n— which cards a day has earned —');
const day = {
  id: 'day-01', day: 1, title: 'A socket is a file descriptor', estMinutes: 25, teaser: null,
  teachBack: 'What is the int actually an index into?', status: 'available',
  theoryMarkdown: '# theory', task: null,
  quiz: [{ id: 'q1', prompt: '?', options: [] }, { id: 'q2', prompt: '?', options: [] }],
};
const answered = { theoryDone: true, quiz: { answers: {}, correct: { q1: true, q2: false }, completedAt: null, cleanSweep: false } };

ok('a day never opened yields nothing', cardsFor(day, undefined).length === 0);
let cards = cardsFor(day, answered);
ok('answered questions become cards', cards.filter((x) => x.kind === 'quiz').length === 2, JSON.stringify(cards.map((x) => x.id)));
// A question he got wrong still becomes a card — that's the one most worth asking again.
ok('a question answered wrongly is still a card', cards.some((x) => x.id === 'quiz:day-01:q2'));
ok('the teach-back becomes a card', cards.some((x) => x.kind === 'explain'));
ok('theory becomes a forgeable card', cards.some((x) => x.kind === 'forge'));

const unanswered = { theoryDone: false, quiz: { answers: {}, correct: {}, completedAt: null, cleanSweep: false } };
ok('an unanswered quiz earns no cards', cardsFor(day, unanswered).length === 0);
// Being asked to recall what you never read is not revision.
ok('unread theory forges nothing', !cardsFor(day, unanswered).some((x) => x.kind === 'forge'));

console.log('\n— card ids survive a round trip —');
ok('a quiz card carries its question', parseCardId(cardId('quiz', 'day-02', 'q3')).questionId === 'q3');
ok('a day card does not', parseCardId(cardId('explain', 'day-02')).questionId === undefined);
ok('the day comes back', parseCardId('forge:day-05').dayId === 'day-05');
ok('nonsense is rejected', parseCardId('nope') === null);
ok('an unknown kind is rejected', parseCardId('banana:day-01') === null);

console.log('\n— selection —');
const deck = cards;
const fresh = { cards: {}, lastAmbush: null, doneToday: 0, countedOn: null };
ok('everything unseen is due', dueCards(deck, fresh, '2026-09-07').length === deck.length);

const parked = {
  cards: Object.fromEntries(deck.map((x) => [x.id, { ...newCard(NOW), due: '2026-12-01' }])),
  lastAmbush: null, doneToday: 0, countedOn: null,
};
ok('nothing due when everything is parked', dueCards(deck, parked, '2026-09-07').length === 0);

// One due card among parked ones: it should normally be the one picked...
const oneDue = { ...parked, cards: { ...parked.cards, [deck[0].id]: { ...newCard(NOW), due: '2026-09-01' } } };
ok('a due card is preferred', pickNext(deck, oneDue, '2026-09-07', seq(0.9, 0)).id === deck[0].id);
// ...but a low roll splices in a wildcard that isn't due at all, which is the point.
ok('a low roll pulls a wildcard instead', pickNext(deck, oneDue, '2026-09-07', seq(0.01, 0)).id !== deck[0].id);
ok('an exhausted deck returns null', pickNext(deck, fresh, '2026-09-07', mid, new Set(deck.map((x) => x.id))) === null);
ok('nothing due still offers something', pickNext(deck, parked, '2026-09-07', mid) !== null);

console.log('\n— the ambush —');
ok('due cards justify an interruption', shouldAmbush(fresh, deck, '2026-09-07', () => 0.99));
ok('but only once a day', !shouldAmbush({ ...fresh, lastAmbush: '2026-09-07' }, deck, '2026-09-07', () => 0));
ok('an empty deck never interrupts', !shouldAmbush(fresh, [], '2026-09-07', () => 0));
ok('nothing due, high roll: left alone', !shouldAmbush(parked, deck, '2026-09-07', () => 0.99));
// Occasionally it asks anyway — "when I'm not ready" was the actual request.
ok('nothing due, low roll: asked anyway', shouldAmbush(parked, deck, '2026-09-07', () => 0.01));

console.log('\n— two devices, one deck —');
const card = (over) => ({ ...newCard(NOW), ...over });
const local = {
  cards: { x: card({ due: '2026-10-01', lastAt: '2026-09-07T09:00:00Z', seen: 3, lapses: 1 }) },
  lastAmbush: '2026-09-07', doneToday: 2, countedOn: '2026-09-07',
};
const remote = {
  cards: { x: card({ due: '2026-09-08', lastAt: '2026-09-07T11:00:00Z', seen: 2, lapses: 2 }) },
  lastAmbush: '2026-09-06', doneToday: 3, countedOn: '2026-09-07',
};
let m = M.mergeReview(local, remote);
// The later answer wins the card even though its due date is nearer — a miss on the
// laptop must not be buried by an earlier correct answer on the phone.
ok('the most recent answer wins the card', m.cards.x.due === '2026-09-08', m.cards.x.due);
ok('counters take the max, not the sum', m.cards.x.seen === 3 && m.cards.x.lapses === 2, JSON.stringify(m.cards.x));
ok('the later ambush date is kept', m.lastAmbush === '2026-09-07');
ok('same-day tallies add up', m.doneToday === 5, String(m.doneToday));

m = M.mergeReview(local, { ...remote, countedOn: '2026-09-06', doneToday: 9 });
ok('a stale tally is not added in', m.doneToday === 2, String(m.doneToday));

m = M.mergeReview({ cards: { only: card({}) }, lastAmbush: null, doneToday: 0, countedOn: null }, remote);
ok('a card only one device has is kept', Boolean(m.cards.only) && Boolean(m.cards.x));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all review cases pass');
process.exit(fails ? 1 : 0);
