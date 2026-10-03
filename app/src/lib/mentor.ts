/**
 * The in-app mentor: a direct browser → model-provider call, with no backend.
 *
 * Two providers, because they have very different bills attached:
 *  - **Gemini** (default). Google's free tier is genuinely free — rate-limited, not
 *    trial credits — which makes it the right default for a tab whose whole job is
 *    answering "why is it like this" a few times a session.
 *  - **Anthropic**. Better answers, but the API is prepaid and entirely separate from
 *    a Claude subscription, so it only makes sense once someone has topped it up.
 *
 * Both are called straight from the device; both endpoints' CORS preflights were
 * checked before this was written. Anthropic needs the
 * `anthropic-dangerous-direct-browser-access` opt-in header — the scary name is aimed
 * at people shipping a key to thousands of users, not at one person's key on one
 * person's phone. Google takes the key in `x-goog-api-key`, which keeps it out of the
 * URL and therefore out of anything that logs URLs.
 *
 * The system prompt below is the load-bearing part of this file, and it is shared by
 * both providers. It carries the same prime directive as the repo's CLAUDE.md, which
 * is what stops the mentor tab from becoming a cheat button: it will explain any
 * concept you like and will not hand over the milestone's implementation.
 */
import type { Day, ItemVerdict, MentorProvider, TaskGrade, Track, Week } from './types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Set when a reply failed mid-flight, so the UI can offer a retry. */
  error?: string;
}

export interface ModelChoice {
  id: string;
  label: string;
  note: string;
}

export interface ProviderInfo {
  label: string;
  /** What the key looks like, for the input placeholder. */
  placeholder: string;
  consoleUrl: string;
  consoleLabel: string;
  /** The one-line truth about what using this costs. */
  cost: string;
  free: boolean;
  defaultModel: string;
  /** Used until the provider's own list arrives, and if it never does. */
  models: ModelChoice[];
}

export const PROVIDERS: Record<MentorProvider, ProviderInfo> = {
  gemini: {
    label: 'Gemini',
    // AI Studio now issues auth keys, which start "AQ."; older standard keys start
    // "AIza". Both are in circulation, so the hint must not swear by either.
    placeholder: 'AIza… or AQ.…',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'aistudio.google.com/apikey',
    cost: 'Free tier, rate-limited rather than metered. No card, no credits.',
    free: true,
    // Seeds only. The real list is fetched from the API the moment a key is saved,
    // which is the point: model names get retired, and a hardcoded one eventually 404s
    // — as the previous seeds here, gemini-2.5-flash and -pro, both now do. So the
    // seeds are the `-latest` aliases: they follow whatever Google currently ships.
    defaultModel: 'gemini-flash-latest',
    models: [
      { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)', note: 'Tracks the current Flash. Generous free tier.' },
      { id: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite (latest)', note: 'Quicker and cheaper, a bit less careful.' },
      { id: 'gemini-pro-latest', label: 'Gemini Pro (latest)', note: 'Stronger, with a much tighter free-tier limit.' },
    ],
  },
  anthropic: {
    label: 'Claude',
    placeholder: 'sk-ant-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'console.anthropic.com',
    cost: 'Prepaid credits, billed per question. A Claude subscription does not cover it.',
    free: false,
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku', note: 'Cheapest. Fine for "what does this flag do".' },
      { id: 'claude-sonnet-5', label: 'Sonnet', note: 'Good judgement on concepts, still cheap.' },
      { id: 'claude-opus-5', label: 'Opus', note: 'For the ones you have actually been stuck on.' },
    ],
  },
};

/** Anything older than this is dropped from the request — a long thread is mostly cost. */
const HISTORY_LIMIT = 20;
/**
 * Output budget. Generous because on Gemini 2.5+ it is *shared with thinking*: the
 * model's reasoning tokens are billed against the same ceiling as the reply, so a
 * modest-looking cap gets spent thinking and the visible answer is cut off mid-sentence.
 * 1600 did exactly that.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Room to think, but not the whole budget.
 *
 * Only sent to Flash models: they document a settable thinking budget, while other
 * families either reject the field or refuse to go below their own floor, and a 400
 * here would break the chat outright rather than merely truncate it.
 */
const THINKING_BUDGET = 640;
const thinksOnRequest = (model: string) => /flash/i.test(model);

/**
 * What each track is, in the words the prompts need.
 *
 * Only the subject sentences differ between tracks — the persona, the refusal to write
 * the task, and the examiner's contract are the same job whatever is being studied, and
 * duplicating them per subject is how two prompts quietly drift apart.
 */
const SUBJECTS: Record<Track, { name: string; lang: string; audience: string; depth: string }> = {
  cpp: {
    name: 'C++',
    lang: 'cpp',
    audience:
      'a working developer who already writes C++ comfortably and is here to learn what' +
      ' sits underneath the abstractions they normally use — sockets, build systems,' +
      ' testing, sanitizers. Assume competence with the language itself: they do not need' +
      ' pointers, RAII, or templates explained from scratch.',
    depth:
      'Do not assume systems experience; the syscall layer, and the kernel behaviour' +
      ' behind it, is exactly what they came here for and deserves real explanation' +
      ' rather than Socratic hints.',
  },
  sql: {
    name: 'SQL',
    lang: 'sql',
    audience:
      'a working developer who writes queries that run but has never looked at what the' +
      ' database does with them. Assume they know SELECT, JOIN and GROUP BY; what they' +
      ' lack is the layer underneath — pages, indexes, planners, transactions.',
    depth:
      'Answer in terms of what the engine actually does with the bytes: which rows it' +
      ' reads, in what order, and why the planner chose that. An answer that only' +
      ' restates the syntax has missed the point of this track.',
  },
  go: {
    name: 'Go',
    lang: 'go',
    audience:
      'a developer who already programs in some other compiled language and is learning' +
      ' Go from the beginning. Assume they understand types, pointers, functions and' +
      ' loops in general; what they lack is Go specifically, and the reasons it differs' +
      ' from what they are used to.',
    depth:
      'Explain not just what Go does but why it was designed that way — the language has' +
      ' unusually well-documented reasoning behind its refusals, and a beginner who knows' +
      ' the reason remembers the rule. Comparisons to C, C++ or Java are welcome when' +
      ' they illuminate the difference; do not assume they know any one of those.',
  },
};

export const subjectOf = (track: Track | undefined) => SUBJECTS[track ?? 'cpp'] ?? SUBJECTS.cpp;

/**
 * Appended to every prompt whose output the reader sees.
 *
 * Models reach for LaTeX in prose that contains no maths — `SYN $\rightarrow$ SYN-ACK`
 * is the one that started this — and there is no maths renderer in the app, so it lands
 * as source. markdown.ts strips what gets through, because asking is not the same as
 * enforcing; this just makes it rare rather than routine.
 */
const NO_LATEX = `Markdown and plain text only, never LaTeX. No $...$, no \\(...\\), no
\\text{} or \\rightarrow — write the arrow, the symbol or the word itself. Nothing here is
typeset maths and there is no renderer for it, so LaTeX reaches the reader as source.`;

const persona = (track: Track | undefined) => {
  const s = subjectOf(track);
  return `You are the mentor for slowpath, a deliberate-practice ${s.name} curriculum.

Who you're talking to: ${s.audience} ${s.depth}

If they tell you their background, calibrate to it. Until then, pitch at someone fluent
in the language and new to the layer below it.

THE PRIME DIRECTIVE, which overrides your instinct to be maximally helpful:
- Never write the implementation for the day's task. Not a sketch of it, not
  "here's roughly the shape", not a version with the interesting line left blank.
- If they ask you to write it, say plainly that this one is theirs, and ask what they
  have tried and what error they are seeing.
- Explaining WHY is not the restricted part, and you should be generous with it.
  Language semantics, API behaviour, what a syscall does, why an error means what it
  means, why a design turned out this way historically — answer those directly and in
  as much depth as they deserve.
- Debugging code they have already written is fair game and encouraged. Point at the
  wrong assumption; don't rewrite the function for them.
- Illustrative code for a concept they are NOT currently being asked to implement is
  fine. Code that would complete today's task is not.

Tone: an opinionated senior engineer sitting next to them, not a textbook and not a
support ticket. Informal is fine. "This part is genuinely annoying, here's why it
exists anyway" is the register. Real trivia, protocol history, and famous bugs are
welcome wherever they're relevant. Keep the technical content exact; the personality
wraps around it.

Format: you're being read on a phone. Short paragraphs, few headings, code fenced with
its language. Be concise unless they ask you to go deep — then go deep.

${NO_LATEX}`;
};

/**
 * What the learner is looking at when a question is asked from somewhere other than the
 * lesson itself — the review deck, today. Without it the mentor only knows the day, and
 * answers a question about a quiz card by asking how the day's task is going.
 */
export interface MentorFocus {
  /** One line for the sheet's header strip, e.g. "From the quiz". */
  label: string;
  /** The question as it was shown. */
  question: string;
  /** What they answered and what was right, as short display lines. */
  outcome: string[];
  /** Everything the model should know about the card, including the answer key. */
  brief: string;
}

/** How many upcoming days the mentor is told about. */
const AHEAD = 6;

/** "PostgreSQL, Queries That Look Right, Day 6 — "Joins multiply"" — track, topic, day. */
function where(week: Week, day: Day): string {
  const topic = week.topics?.find((t) => t.id === day.topic)?.title;
  return `${week.title}${topic ? `, ${topic}` : ''}, Day ${day.day} — "${day.title}"`;
}

export function systemPrompt(context: { week: Week; day: Day; focus?: MentorFocus | null } | null): string {
  if (!context) {
    return `${persona(undefined)}\n\nNo lesson is open, so you have no day context. If a question depends on where they are in the curriculum, just ask.`;
  }
  const { week, day } = context;
  const parts = [
    persona(week.track),
    `\n---\n\nWHERE THEY ARE RIGHT NOW: ${where(week, day)}.`,
    'Assume this is the context of the question unless they say otherwise. Do not get ahead of the curriculum: later days are listed below and their material has not been taught yet.',
  ];
  if (day.theoryMarkdown) {
    parts.push(`\nToday's theory, exactly as they read it:\n\n${day.theoryMarkdown}`);
  }
  if (day.task) {
    parts.push(
      `\nToday's task — THIS is the thing you must not write for them:\n\n${day.task.markdown}` +
        (day.task.checklist.length ? `\n\nIts checklist:\n${day.task.checklist.map((c) => `- ${c}`).join('\n')}` : ''),
    );
  }
  // The next few, not the whole track: a path that grows on request gets long, and the
  // point is only to know what has not been taught yet.
  const rest = week.days.filter((d) => d.day > day.day).slice(0, AHEAD).map((d) => `Day ${d.day}: ${d.title}`);
  if (rest.length) parts.push(`\nStill ahead on this track: ${rest.join('; ')}.`);
  if (context.focus) {
    parts.push(
      `\n---\n\nWHAT THEY ARE LOOKING AT: they are in the review deck, not the lesson, and have just answered a card. Every message they send arrives with that card attached, above their words, and their question is about it unless they say otherwise.
- You are both looking at the same screen. Speak to it directly — "you picked…", "the key says…" — and never describe the situation back to them ("you're looking at the review card…"). Start with the answer.
- Do not ask how the day's task is going.
- Ground what you say in the card's key and in the day's material above. Do not introduce catalog tables, view names, functions, flags or figures that are not in them; if you have to go beyond the material, say that you are.`,
    );
  }
  return parts.join('\n');
}

/**
 * Attach the card to a message on its way to the model — not to what is stored or shown.
 *
 * The system prompt is a long way from the question by the time a thread has history,
 * and "why is that the answer?" means nothing without something for "that" to point at.
 * Putting the card directly above the words it is about keeps the two together however
 * long the conversation gets.
 */
export function withFocus(text: string, focus: MentorFocus | null | undefined): string {
  if (!focus) return text;
  return `[The card on screen — we are both looking at it]\n${focus.brief}\n\n[My message about it]\n${text}`;
}

/**
 * The examiner. Same model, opposite job.
 *
 * The mentor exists to unblock the learner; this one exists to find out whether they
 * actually understand, which means the prime directive is *stricter* here, not looser.
 * A mentor that answers a question has helped. An examiner that answers its own
 * question has destroyed the only measurement it was there to take — so the rule below
 * isn't "avoid writing the milestone code", it's "do not supply the explanation you are
 * asking them for, in any form, including a leading hint".
 *
 * It ends by emitting a verdict marker the UI parses and strips. Everything before the
 * marker is ordinary prose the learner reads; the marker never reaches the screen.
 */
const examiner = (track: Track | undefined) => {
  const s = subjectOf(track);
  return `You are examining a developer on material they have just studied, in a
deliberate-practice ${s.name} curriculum called slowpath. Assume they write ${s.name}
competently; what is being tested is whether they understood today's material, not
whether they know the language.

YOUR JOB IS TO MEASURE, NOT TO TEACH. This is the whole point of the exercise, and it
overrides your instinct to be helpful:
- Never supply the explanation you are asking them for. Not a summary, not a hint that
  contains the answer, not "well, remember that X happens before Y" — that hands them
  the very thing being measured.
- If they are wrong, say which part doesn't hold and ask them to try that part again.
  Name the gap, never fill it.
- If they are vague or just restate jargon back at you ("the kernel handles it", "it's a
  handle"), that is not an explanation. Ask for the mechanism underneath the words.
- One question at a time, and keep it short — this is being read on a phone.
- Do not praise an answer you have not tested. "Exactly right!" after one sentence is
  worthless to them.

HOW TO RUN IT:
- They give their explanation first. Read it for what is missing, not just what is wrong.
- Probe the weakest part with a specific follow-up. A good probe is concrete: "what
  happens if the buffer is smaller than the message", not "can you elaborate".
- YOU GET AT MOST THREE PROBES. Count them. On your third reply at the latest you must
  stop asking and judge, even if you'd like to know more — an examination they cannot
  finish teaches nothing and just traps them in the app.
- If they ask you to judge, or say they're done, judge immediately on what you already
  have. Do not ask another question first.
- Judge honestly and a little demanding: this is worth nothing if you pass an
  explanation that would fall apart under a real question. But an answer that is right
  and complete is a pass — do not keep escalating to harder material to avoid saying so.

HOW TO FINISH: when you have enough evidence, write two or three sentences saying what
held up and what was thin or missing — plainly, no scoring rubric — and then, on its own
final line, exactly one of:
[[VERDICT: solid]]
[[VERDICT: gaps]]

"solid" means they could defend this to another engineer. "gaps" means something real was
missing — say what, so they know where to go back to. Emit the marker only when you are
finished examining; never in your opening reply, and never more than once.

${NO_LATEX}`;
};

/** The line the examiner ends on. Parsed by the UI, never shown to the learner. */
const VERDICT_RE = /\[\[VERDICT:\s*(solid|gaps)\s*\]\]/gi;

export type Verdict = 'solid' | 'gaps' | null;

/** The examiner's ruling, or null while it's still asking. Last marker wins. */
export function parseVerdict(text: string): Verdict {
  const found = [...text.matchAll(VERDICT_RE)];
  const last = found.at(-1)?.[1]?.toLowerCase();
  return last === 'solid' || last === 'gaps' ? last : null;
}

/** The reply with the marker taken out, for display. */
export function stripVerdict(text: string): string {
  return text.replace(VERDICT_RE, '').trimEnd();
}

/**
 * A hint is not a ruling, so it needs a marker of its own: the app counts them to know
 * when the hints are used up, rather than trusting the model to remember how many it gave.
 */
const HINT_RE = /\[\[HINT\]\]/gi;

export function hasHint(text: string): boolean {
  return new RegExp(HINT_RE.source, 'i').test(text);
}

/** Every marker taken out, for display. */
export function stripMarkers(text: string): string {
  return text.replace(VERDICT_RE, '').replace(HINT_RE, '').trimEnd();
}

/** Hints the review deck's mentor may give before it answers. */
export const MAX_HINTS = 2;
/** Messages from them in one card. A review card that can't end isn't finished on a phone. */
export const MAX_REVIEW_MESSAGES = 4;

/**
 * Where a review conversation stands, counted from the transcript so it survives a model
 * that would otherwise lose track. `history` ends with their newest message.
 */
export function reviewStanding(history: ChatMessage[]): { said: number; hints: number; last: boolean; hintsUsedUp: boolean } {
  const said = history.filter((m) => m.role === 'user').length;
  const hints = history.filter((m) => m.role === 'assistant' && hasHint(m.content)).length;
  return { said, hints, last: said >= MAX_REVIEW_MESSAGES, hintsUsedUp: hints >= MAX_HINTS };
}

/**
 * System prompt for the teach-back. Carries the day's actual theory so the examiner
 * grades against what was actually taught rather than its own idea of the topic.
 */
export function examinerPrompt(context: { week: Week; day: Day } | null): string {
  if (!context) return examiner(undefined);
  const { week, day } = context;
  const parts = [
    examiner(week.track),
    `\n---\n\nWHAT THEY ARE BEING EXAMINED ON: ${where(week, day)}.`,
  ];
  if (day.teachBack) {
    parts.push(`\nThe question they were given, which is what you are grading:\n\n${day.teachBack}`);
  }
  if (day.theoryMarkdown) {
    parts.push(
      `\nThe material they studied, so you can tell a real gap from something never covered.` +
        ` Do not quote it back at them:\n\n${day.theoryMarkdown}`,
    );
  }
  return parts.join('\n');
}

/**
 * Clean up a pasted key.
 *
 * The one manual step in setting this up is pasting a key, and a paste off a phone
 * arrives with whatever came along for the ride: a trailing newline from a code block,
 * smart quotes from a notes app, a leading "key=" from a copied env line. All of those
 * produce a 400 from the provider and look like "my key is wrong", so strip them here
 * rather than making someone hunt for an invisible space.
 */
const QUOTES = /^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g;
const ENV_PREFIX = /^(?:export\s+)?[A-Z_]*(?:API_)?KEY\s*[=:]\s*/i;

export function normalizeKey(raw: string): string {
  // Quotes twice, deliberately: `export API_KEY="AIza…"` has the prefix inside the
  // quotes, so stripping either one first leaves the other stranded.
  return raw
    .trim()
    .replace(QUOTES, '')
    .replace(ENV_PREFIX, '')
    .replace(QUOTES, '')
    .replace(/\s+/g, '')
    .trim();
}

export class MentorError extends Error {}

/**
 * The far end was busy rather than unhappy with us — a 5xx, or a rate limit.
 *
 * Worth its own type because it's the one failure another model might not have: Google
 * overloads its newest models noticeably more often than its older ones, so a busy
 * `-latest` is a reason to try the next one down, not a reason to give up.
 */
export class BusyError extends MentorError {}

/** A 404 from the provider: the selected model is gone, so the stored choice is stale. */
export class ModelGoneError extends MentorError {}

// --- shared plumbing -------------------------------------------------------

/** Trim the thread to a sane window, and make sure it still starts with a user turn. */
function window_(messages: ChatMessage[]): ChatMessage[] {
  const history = messages.filter((m) => m.content.trim()).slice(-HISTORY_LIMIT);
  // Both APIs want the first turn to be the user's, so slicing a long thread at an
  // arbitrary point is a 400 waiting to happen.
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) throw new MentorError('Nothing to send.');
  return history;
}

/**
 * Statuses worth trying again without telling anyone.
 *
 * All of these mean "the far end is busy", not "your request is wrong" — Google 503s
 * its newest models fairly often, and every one of those became a dead end on screen
 * that had to be tapped through by hand. 429 is deliberately absent: on the free tier
 * that's a quota, and retrying into a quota is how you stay in it. It comes back only
 * when the server itself says when, via Retry-After.
 */
const TRANSIENT = new Set([500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/** However long the server asks for, the UI is not sitting still for a minute. */
const MAX_BACKOFF_MS = 8000;

/** Seconds, or an HTTP date. Absent or unparseable means "we choose". */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.min(Math.max(0, at - Date.now()), MAX_BACKOFF_MS);
}

/** Exponential, with jitter so two devices retrying don't stay in lockstep. */
const backoffMs = (attempt: number) =>
  Math.min(MAX_BACKOFF_MS, 400 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * POST, retrying the failures that are the far end's problem rather than ours.
 *
 * Safe to retry here specifically because nothing has been streamed yet — this returns
 * before the body is read, so a second attempt can't duplicate text already on screen.
 */
async function post(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw new DOMException('aborted', 'AbortError');
      // A dropped connection is as transient as a 503, so it gets the same treatment —
      // unless the device knows it is offline, where retrying is just a slower error.
      if (!navigator.onLine || attempt >= MAX_ATTEMPTS) {
        throw new MentorError(
          navigator.onLine ? 'Could not reach the API.' : 'Offline — the mentor needs a connection.',
        );
      }
    }

    if (res) {
      if (res.ok) return res;
      const after = retryAfterMs(res);
      // 429 only when the server named a delay; anything else transient on its own.
      const retryable = TRANSIENT.has(res.status) || (res.status === 429 && after !== null);
      if (!retryable || attempt >= MAX_ATTEMPTS) return res;
      await sleep(after ?? backoffMs(attempt), signal);
      continue;
    }
    await sleep(backoffMs(attempt), signal);
  }
}

/** Both providers put a human-readable string at `error.message`; dig it out. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text;
  }
}

/**
 * A frame ends at a blank line and a line ends at CRLF, LF or CR — all three, says the
 * SSE spec, and providers genuinely differ: Anthropic sends LF, Google sends CRLF.
 *
 * Splitting frames on "\n\n" alone therefore never matched a single Gemini frame,
 * because "\r\n\r\n" has a \r wedged between the newlines. Every frame accumulated in
 * the buffer instead of being emitted, and the whole response was dropped on the floor
 * at end of stream: no text, no error, no clue. Deterministic, not intermittent — it
 * simply never worked against the real API, only against a test stub that used LF.
 */
const FRAME_BREAK = /\r\n\r\n|\n\n|\r\r/;
const LINE_BREAK = /\r\n|\n|\r/;

/** The joined `data:` payload of one frame, or '' if it carries none. */
function framePayload(frame: string): string {
  return frame
    .split(LINE_BREAK)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
}

/**
 * Yields the `data:` payload of each complete SSE frame.
 *
 * A network chunk can split a frame down the middle, so the trailing partial frame
 * stays buffered until the rest arrives.
 */
async function* sseFrames(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new MentorError('The API returned no body to stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(FRAME_BREAK);
      // Whatever follows the last blank line is either nothing or the start of a
      // frame still on the wire; either way it waits for the next chunk.
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = framePayload(frame);
        if (data && data !== '[DONE]') yield data;
      }
    }
    // A final frame that arrives without its trailing blank line is still a frame.
    // Dropping it silently is what made this class of bug so quiet the first time.
    const last = framePayload(buffer + decoder.decode());
    if (last && last !== '[DONE]') yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}

// --- Gemini ----------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * A model Google has retired 404s on generateContent while still appearing, in full
 * health, in models.list — nothing in the list metadata marks it as gone. The saving
 * grace is that the 404 body says exactly what happened and names the replacement
 * ("...is no longer available to new users. Please update your code to use
 * models/gemini-3.6-flash"), so for this one status the honest thing is to pass
 * Google's own words through rather than paraphrasing them into something vaguer.
 */
function explainGemini(status: number, message: string): string {
  if (status === 400 && /api.?key/i.test(message)) {
    return 'Google rejected that key. Copy it again from aistudio.google.com/apikey — the whole string, which starts with "AQ." or "AIza".';
  }
  if (status === 401) {
    return `Google rejected that key at the auth layer, before it looked at the model. ${message || 'Check it in Settings, or generate a fresh one at aistudio.google.com/apikey.'}`;
  }
  if (status === 403) {
    return message.includes('SERVICE_DISABLED') || /not been used|disabled/i.test(message)
      ? "The Generative Language API isn't enabled for that key's Google Cloud project. Making the key from AI Studio rather than the Cloud console avoids this."
      : 'Google refused the request. Check the key is still active.';
  }
  if (status === 404) {
    // Retired models still show up in models.list, so this is reachable from the
    // picker. Google names the successor in the message; don't bury that.
    return message
      ? `${message} (Settings has the full list — the app will move you to a current model.)`
      : 'That model is gone. Pick another one in Settings — the list is fetched from Google.';
  }
  if (status === 429) {
    return "Gemini's free tier is rate-limited, and you've hit it. Wait a minute, or switch to a Flash model — its limits are much higher.";
  }
  if (status >= 500) {
    return 'Google is having a moment — the app already retried a few times. Give it a minute, or switch models in Settings.';
  }
  return message || `The API said ${status}.`;
}

/** Builds the right error class for a Gemini HTTP failure. */
function geminiError(status: number, message: string): MentorError {
  const text = explainGemini(status, message);
  if (status === 404) return new ModelGoneError(text);
  if (status >= 500 || status === 429) return new BusyError(text);
  return new MentorError(text);
}

interface GeminiModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Models that answer chat turns. The catalogue has grown a lot of neighbours that
 * advertise generateContent but are no use to a text mentor: image and video
 * generators, TTS, transcription, music, robotics, computer-use and the research
 * agents. All of them are named for what they do, which is the only signal available.
 */
const NOT_CHAT =
  /embedding|aqa|imagen|veo|image|tts|audio|learnlm|gemma|lyria|nano-banana|transcribe|robotics|computer-use|deep-research|antigravity|omni/i;

/**
 * How good a default this model is, higher first.
 *
 * The point of the ordering is the top entry: it's what the app falls back to when the
 * stored choice is gone, so it has to be something that actually answers. Two rules do
 * the work. Aliases like `gemini-flash-latest` win because they track whatever is
 * current and so can never be the thing that retires under you — which is exactly how
 * a hardcoded `gemini-2.5-flash` ended up 404ing here. Otherwise newer beats older, so
 * last year's stable snapshot sinks below this year's even though models.list presents
 * the two identically.
 *
 * Flash over Pro is deliberate and not about quality: on the free tier Pro burns its
 * much smaller quota in a handful of questions, which reads as a broken app.
 */
function rank(id: string): number {
  let score = 0;
  if (/-latest$/.test(id)) score += 1000;
  if (/flash/.test(id)) score += 100;
  if (/lite/.test(id)) score -= 10;
  if (/preview|-exp\b|-exp-|experimental/.test(id)) score -= 50;
  // "gemini-3.8-flash" -> 3.8, so the newest generation floats up among equals.
  score += Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  return score;
}

async function listGeminiModels(key: string): Promise<ModelChoice[]> {
  const res = await post(`${GEMINI_BASE}/models?pageSize=200`, {
    method: 'GET',
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) throw geminiError(res.status, await errorMessage(res));

  const body = (await res.json()) as { models?: GeminiModel[] };
  const choices = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      label: m.displayName || m.name.replace(/^models\//, ''),
      note: (m.description ?? '').split('. ')[0].slice(0, 110),
    }))
    .filter((m) => !NOT_CHAT.test(m.id));

  choices.sort((a, b) => rank(b.id) - rank(a.id));
  return choices;
}

/**
 * One request/response cycle. Yields text as it streams and, via the generator's
 * return value (not a yielded value — `yield*` surfaces this to the caller), reports
 * whether any text ever showed up and what the model said its finish reason was.
 */
async function* attemptGemini(opts: {
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string, { sawText: boolean; finish: string | undefined }> {
  const contents = window_(opts.messages).map((m) => ({
    // Gemini calls the assistant "model"; everything else about the shape differs too.
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const res = await post(
    `${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(thinksOnRequest(opts.model)
            ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }
            : {}),
        },
      }),
    },
    opts.signal,
  );
  if (!res.ok) throw geminiError(res.status, await errorMessage(res));

  let sawText = false;
  let finish: string | undefined;

  for await (const data of sseFrames(res)) {
    let event: {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.error) throw new MentorError(event.error.message ?? 'The stream errored.');
    if (event.promptFeedback?.blockReason) {
      throw new MentorError(`Gemini blocked the question (${event.promptFeedback.blockReason}).`);
    }
    const candidate = event.candidates?.[0];
    if (candidate?.finishReason) finish = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) {
        sawText = true;
        yield part.text;
      }
    }
  }

  return { sawText, finish };
}

/** How every "this reply was cut short" note begins, so a caller can spot one. */
const CUT_MARK = '_(cut off';

/**
 * A note to append when the model stopped early, or null when it finished properly.
 *
 * Appended to the reply rather than thrown: the text that did arrive is worth keeping,
 * and an error would replace it with nothing.
 */
function truncationNote(finish: string | undefined): string | null {
  if (finish === 'STOP') return null;
  // Every real reply ends on a frame that carries a finish reason. A stream that just
  // stops without one was cut off in transit — a documented Gemini failure, and also
  // what a dropped connection looks like — not finished.
  if (!finish) {
    return `\n\n${CUT_MARK} — the connection ended before the model said it was done. Ask again.)_`;
  }
  if (finish === 'MAX_TOKENS') {
    return `\n\n${CUT_MARK} — it hit the length limit. Ask it to carry on, or to be briefer.)_`;
  }
  return `\n\n${CUT_MARK} — the model stopped early: ${finish}.)_`;
}

/**
 * Whether a short piece of generated text reads as finished.
 *
 * The finish reason alone cannot answer this. Gemini is known to end a stream
 * mid-sentence and still report `STOP`, so a reply can be cut off and say it is
 * complete. For a one-paragraph challenge that is shown as a question, half a question
 * is worse than none, so the text itself gets checked: every code fence and every
 * inline backtick closed, and the last thing on the page a full stop, a question mark
 * or the end of a code block — never a bare word or a digit, which is where a cut lands.
 */
export function looksComplete(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes(CUT_MARK)) return false;
  const fences = t.match(/^[ \t]*```/gm)?.length ?? 0;
  if (fences % 2) return false;
  const prose = t.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
  if ((prose.match(/`/g)?.length ?? 0) % 2) return false;
  return /(```|[.?!)`"'»…*_])$/.test(t);
}

/**
 * A stream can finish having yielded nothing: no text, and either `finishReason:
 * "STOP"` or no finish reason at all. The old code only treated a *different* finish
 * reason (SAFETY, RECITATION, …) as an error, so that case fell through every check
 * and the request ended with nothing said and nothing thrown — a silent hang, cursor
 * blinking forever.
 *
 * The empty streams that prompted this turned out to be self-inflicted (see
 * sseFrames), but an answerless response is still possible, so it stays handled: one
 * transparent retry, since nothing has reached the screen yet, and a real error rather
 * than silence if the second attempt is empty too.
 */
async function* streamGemini(opts: {
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { sawText, finish } = yield* attemptGemini(opts);
    if (sawText) {
      // The finish reason used to be ignored the moment any text arrived, so a reply
      // the model had abandoned looked identical to one it had finished — you got half
      // a sentence and no hint that there was more. Say so instead.
      const cut = truncationNote(finish);
      if (cut) yield cut;
      return;
    }

    const hardStop = finish && finish !== 'STOP';
    if (hardStop) throw new MentorError(`Gemini stopped without answering (${finish}).`);
    if (attempt === 2) {
      throw new MentorError(
        'Gemini returned an empty answer twice in a row. Try again, or switch models in Settings.',
      );
    }
    // attempt 1 came back empty with an innocuous finish reason: silently retry.
  }
}

// --- Anthropic -------------------------------------------------------------

function explainAnthropic(status: number, message: string): string {
  if (status === 401) return 'Anthropic rejected that API key. Check it in Settings — keys start with "sk-ant-".';
  if (status === 400 && /credit|balance/i.test(message)) {
    return 'That account has no API credit. The API is prepaid and separate from a Claude subscription — top it up at console.anthropic.com.';
  }
  if (status === 429) return 'Rate limited. Give it a few seconds.';
  if (status === 529 || status >= 500) {
    return 'The API is overloaded — the app already retried a few times. Give it a minute.';
  }
  return message || `The API said ${status}.`;
}

async function* streamAnthropic(opts: {
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const messages = window_(opts.messages).map(({ role, content }) => ({ role, content }));

  const res = await post(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: opts.system,
        messages,
        stream: true,
      }),
    },
    opts.signal,
  );
  if (!res.ok) {
    const text = explainAnthropic(res.status, await errorMessage(res));
    throw res.status >= 500 || res.status === 429 || res.status === 529
      ? new BusyError(text)
      : new MentorError(text);
  }

  let sawText = false;
  let stopReason: string | undefined;
  let stopped = false;
  for await (const data of sseFrames(res)) {
    let event: {
      type?: string;
      delta?: { text?: string; stop_reason?: string };
      error?: { message?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === 'error') throw new MentorError(event.error?.message ?? 'The stream errored.');
    if (event.type === 'content_block_delta' && event.delta?.text) {
      sawText = true;
      yield event.delta.text;
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    if (event.type === 'message_stop') stopped = true;
  }

  // Same contract as Gemini's: say so when the reply did not really finish. No
  // message_stop means the stream was cut in transit; max_tokens means the budget ran out.
  if (!sawText) return;
  const finished = !stopReason || stopReason === 'end_turn' || stopReason === 'stop_sequence';
  const cut = truncationNote(
    !stopped ? undefined : stopReason === 'max_tokens' ? 'MAX_TOKENS' : finished ? 'STOP' : stopReason,
  );
  if (cut) yield cut;
}

// --- the two entry points --------------------------------------------------

/**
 * Ask the provider what it can actually run.
 *
 * Worth the round trip for Gemini specifically: Google retires and renames models
 * often enough that a list hardcoded today 404s within a year, and the failure lands
 * on the user as "that model is not available to your key" with no way to find one
 * that is. Anthropic's three are stable and carry hand-written notes, so they stay put.
 */
export async function listModels(provider: MentorProvider, key: string): Promise<ModelChoice[]> {
  if (provider !== 'gemini') return PROVIDERS[provider].models;
  const models = await listGeminiModels(key);
  return models.length ? models : PROVIDERS.gemini.models;
}

/**
 * Streams a reply, yielding text as it arrives. An async generator rather than a
 * callback because cancellation then falls out of the language: the caller stops
 * iterating, the `finally` runs, the reader is released.
 */
/**
 * Ask, and if the model is merely busy, ask a different one.
 *
 * `alternates` is the ranked list to fall through, and it only ever gets used before
 * the first character reaches the screen — half a reply followed by a second model
 * starting over would be worse than the error. A retired model (404) also falls
 * through here, since "gone" is at least as good a reason to try the next one as
 * "busy" is.
 */
export async function* streamReply(opts: {
  provider: MentorProvider;
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Ranked models to fall back to, in order. Tried only if nothing has streamed. */
  alternates?: string[];
}): AsyncGenerator<string> {
  const chain = [opts.model, ...(opts.alternates ?? []).filter((m) => m && m !== opts.model)];
  let last: unknown;

  for (const model of chain) {
    let streamed = false;
    try {
      const source =
        opts.provider === 'gemini'
          ? streamGemini({ ...opts, model })
          : streamAnthropic({ ...opts, model });
      for await (const chunk of source) {
        streamed = true;
        yield chunk;
      }
      return;
    } catch (err) {
      // Once text is on screen the request is committed: restarting it elsewhere would
      // repeat what was already said.
      if (streamed) throw err;
      if (!(err instanceof BusyError || err instanceof ModelGoneError)) throw err;
      last = err;
    }
  }
  throw last;
}

// --- review deck ----------------------------------------------------------

/**
 * Writes the surprise challenges the review deck deals from days you finished a while
 * ago. Kept separate from the mentor and the examiner because it is doing a third
 * thing: not explaining, not grading, but inventing a small, concrete test.
 */
const forger = (track: Track | undefined) => {
  const s = subjectOf(track);
  return `You write single, short recall challenges about ${
    track === 'sql'
      ? 'SQL and how a database engine executes it'
      : track === 'go'
        ? 'the Go language and its runtime'
        : 'low-level C++ and POSIX systems programming'
  }, for someone revising material they studied days or weeks ago.

You will be given the material from one lesson. Write ONE challenge drawn from it.

Rules:
- Pick something specific and mechanical: a value, an ordering, a return code, a state,
  what a call does to kernel state. Never "explain X in general".
- Prefer these shapes, and vary between them: predict the output; spot the bug in five
  lines or fewer; "this call returns N — what happened?"; "what breaks if you remove
  this line".
- It must be answerable from memory in under a minute, with no compiler to hand.
- It must be answerable from what is ON THE SCREEN. The reader has not seen the lesson's
  tables, variables or files since the lesson: never refer to one they cannot see ("the
  orders table", "the query above", "the earlier function"). Either put what you need
  inside the challenge — the few rows, the declaration — or, for SQL, use only the tables
  under DATA below, which the app shows the reader above your challenge. Do not invent a
  table, column or row that is in neither. A question whose answer depends on data nobody
  can see is not a challenge, it is a guess.
- Any code goes in a \`\`\`${s.lang} fence and stays under about eight lines.
- Ask about something the material actually covered. Do not invent API behaviour.
- Output the challenge only. No preamble, no answer, no hints, no "here is a
  challenge" — the first character is the first word of the question.
- End with the question itself, closed by a question mark. Code, if any, comes before
  the question, not after it.

${NO_LATEX}`;
};

/**
 * Marks a review card — a challenge the model wrote, or the day's teach-back question —
 * as a short conversation rather than a single verdict.
 *
 * It has to end: a hint ladder of two, a handful of messages, then a ruling, because a
 * card that can drag on isn't one anybody finishes on a phone in a queue. The lesson's own
 * teach-back step is different and stays with the examiner, which never gives an answer or
 * a hint: that step is what closes the day, and a day you were told the answer to hasn't
 * been passed. Nothing here can close a day, so nothing here needs to withhold.
 */
const REVIEW_GRADER = `You are marking a short recall answer in a spaced-repetition
review, as a conversation. Be quick, warm and honest — a tutor, not a judge. You are given
their newest message; the exchange so far is above it.

Decide which of these their newest message is.

A. A real attempt.
   - Right: say so in a sentence and rule solid. The exception: if they only got there
     after you gave a hint, rule gaps — it should come back sooner — and say so kindly.
   - Wrong or thin: say in a sentence what is missing, without supplying it, then ask ONE
     focused follow-up aimed at the weakest part. Do not fill the gap for them, and do not
     ask several questions at once.

B. They do not know: "I don't know", "no idea", "I give up", "skip", or plainly nothing to
   offer.
   - Be kind about it, then give a hint. A hint nudges towards the idea and never states
     the answer. You may give at most two hints in the whole conversation: the first
     gentle (name the area or idea to think about), the second sharper (narrow the
     question, or give the first step of the reasoning). End a hint with [[HINT]] on its
     own line. Do not rule on a hint.
   - Once both hints are used and they are still stuck, give the answer properly — the
     mechanism, in a short paragraph concrete enough to recall next time, not a one-line
     verdict — and rule gaps.

C. They ask outright to be told ("just tell me", "show me the answer"). Give the answer as
   in B and rule gaps. Do not make them earn it.

THE LAST MESSAGE. The app tells you when a message is their last on this card. Then the card
ends with your reply: no follow-up question, and never "try again" or any other invitation
to answer once more — they cannot. If they have not got it, give the answer properly and rule
gaps; if they have, say so and rule. A question on a last message is a bug.

Whatever you say must come from the material below. Do not introduce catalog tables, view
names, functions, flags or figures that are not in it; if you have to go beyond it, say so.

End with at most one marker on its own line: [[VERDICT: solid]] or [[VERDICT: gaps]] when
you rule, [[HINT]] when you give a hint, and none when you are asking a follow-up. Never
two markers, and never a verdict on the same turn as a hint. "solid" means they recalled
it unaided; "gaps" means they did not, and it should come back sooner.

${NO_LATEX}`;

const materialFor = (context: { week: Week; day: Day }): string => {
  const { week, day } = context;
  const parts = [`Lesson: ${where(week, day)}.`];
  if (day.theoryMarkdown) parts.push(`\nThe material:\n\n${day.theoryMarkdown}`);
  return parts.join('\n');
};

/** System prompt for inventing a challenge from one day's material. */
export function forgePrompt(context: { week: Week; day: Day }): string {
  const data = forgeData(context.week.track, context.day);
  const dataBlock = data
    ? `DATA — these tables exist, and the app shows exactly this to the reader above your challenge:\n\n\`\`\`sql\n${data}\n\`\`\`\n\n---\n\n`
    : '';
  return `${forger(context.week.track)}\n\n---\n\n${dataBlock}${materialFor(context)}`;
}

/**
 * The tables a SQL challenge may be about: the setup the day's own write cards run against.
 * The review screen shows the same text above the challenge, so the question and the data
 * it is about are never separated. Null when there is nothing — the challenge then has to
 * carry its own data.
 */
export function forgeData(track: Track | undefined, day: Day): string | null {
  if (track !== 'sql') return null;
  const setup = (day.practice?.write?.setup || day.write?.setup || '').trim();
  return setup || null;
}

/**
 * The same job on the one turn that cannot continue.
 *
 * The full prompt above is about probing, hinting and deciding which — exactly what tempts
 * a model into one more question. On the last message none of that applies, so it gets a
 * prompt with a single job instead: close the card.
 */
const REVIEW_FINAL = `You are closing a spaced-repetition review card. Their newest message is
the LAST message on it — the card ends with your reply. So you cannot ask a question, and
you must never invite another try: no "try again", no "have another go", no "what would you
say?". Speak in statements.

Read their newest message in the light of the conversation above it.
- If it is right, or shows they have it: say so in a sentence and rule solid. If they only
  got there after a hint, rule gaps instead — it should come back sooner — and say so kindly.
- If it is wrong, thin, or they still do not know: say kindly, in a sentence, what was
  missing, then give the answer properly — the mechanism, in a short paragraph concrete
  enough to recall next time — and rule gaps.

Whatever you say must come from the material below. Do not introduce catalog tables, view
names, functions, flags or figures that are not in it; if you have to go beyond it, say so.

End with exactly one marker on its own line: [[VERDICT: solid]] or [[VERDICT: gaps]]. Never
a hint marker.

${NO_LATEX}`;

/**
 * Put the app's own note about where the conversation stands directly on their newest
 * message, only when it changes what you must do: the last message, or hints all spent.
 *
 * The state line at the end of the system prompt was not enough. It sits after ~15,000
 * characters of lesson, and a model told "this is their last message" there still ended
 * with "Try again — what's the full statement?" on a card that was already closed. Next to
 * the words it applies to, it is not missed. Returns a copy; what is stored and shown is
 * untouched.
 */
export function withStanding(history: ChatMessage[]): ChatMessage[] {
  const { said, last, hintsUsedUp } = reviewStanding(history);
  const note = last
    ? `From the app, not from them: this is their message ${said} of ${MAX_REVIEW_MESSAGES}, the LAST one. The card ends with your reply. Do not ask another question and do not say "try again" — they cannot. If they have not got it, give the answer now (the mechanism, in a short paragraph) and rule gaps. If they have, say so and rule.`
    : hintsUsedUp
      ? 'From the app, not from them: both hints are already used. If they are still stuck, do not hint again — give the answer now and rule gaps.'
      : null;
  if (!note) return history;
  const out = history.map((m) => ({ ...m }));
  const newest = out.at(-1);
  if (newest?.role === 'user') newest.content = `[${note}]\n\n${newest.content}`;
  return out;
}

/**
 * System prompt for the review conversation about `challenge`.
 *
 * `history` is the exchange so far ending with their newest message. It is used only to
 * tell the model where things stand — how many hints are spent, whether this is the last
 * message — because a model asked to count its own hints will eventually miscount.
 */
export function reviewGraderPrompt(
  context: { week: Week; day: Day },
  challenge: string,
  history: ChatMessage[] = [],
): string {
  const { said, hints, last, hintsUsedUp } = reviewStanding(history);
  const advice = last
    ? ' This is their last message: finish now. If they have not got it, give the answer, and rule.'
    : hintsUsedUp
      ? ' Both hints are used: if they are still stuck, give the answer and rule gaps.'
      : '';
  const standing = history.length
    ? `\n\nWHERE THE CONVERSATION STANDS: this is their message ${said} of at most ${MAX_REVIEW_MESSAGES}. Hints given so far: ${hints} of ${MAX_HINTS}.${advice}`
    : '';
  const base = last ? REVIEW_FINAL : REVIEW_GRADER;
  return `${base}\n\n---\n\n${materialFor(context)}\n\nThe challenge they were asked:\n\n${challenge}${standing}`;
}

// --- checking the practice task ---------------------------------------------

/** The most of a submission the reviewer is sent. A file is fine; a whole project is not. */
export const MAX_SUBMISSION_CHARS = 60_000;

/**
 * How much of the submitted file rides along on follow-up questions about the review.
 * The whole file is sent once, to be reviewed; carrying all of it on every later message
 * would make a chat about one line cost as much as the review itself.
 */
const FOLLOW_UP_FILE_CHARS = 8_000;

const taskReviewer = (track: Track | undefined) => {
  const s = subjectOf(track);
  return `You are reviewing work someone did for a practice task in a deliberate-practice
${s.name} curriculum, the way a senior engineer reviews a merge request: honestly,
specifically and kindly.

WHAT YOU CAN AND CANNOT KNOW. You are given the text of their file. You cannot run it.
Judge what is written — and, where the task has them record plans, output or observations,
judge whether what they recorded is consistent with what the lesson teaches. Do not assume
something happened because the code would make it happen. If the evidence for a checklist
item is not in what you were given, that item is "unclear": not "met", and not "missing".

THE PRIME DIRECTIVE. They did this so that they would learn it. Never write the solution or
a corrected version of the file, and do not paste replacement statements. Point at the line
or section, say what is wrong or absent and why it matters, and — where it helps — name the
concept or keyword they should go and look up. Quoting a line of theirs is fine.

WHAT TO WRITE, briefly, in this order:
1. Two or three sentences: what they did, and how it went overall.
2. "Checklist": one line per checklist item, using the numbers below — the number, one
   verdict word, and one sentence of why that points at the part of their file.
3. "Worth fixing": at most three things a senior reviewer would raise about idiom,
   structure, or where they are fighting the language. Leave it out if there is nothing
   real to say.

The verdict words, strictly: met = the file shows it; partial = started, or some of it is
there; missing = there is no sign of it; unclear = it cannot be judged from the file. Be
exact rather than generous — a "met" for something that is not there teaches the wrong thing.

END with one line and nothing after it:
[[ITEMS: 1=met, 2=partial, 3=unclear]]
— exactly one entry per checklist item, in order, using only those four words.

${NO_LATEX}`;
};

/** System prompt for reviewing a submission against `day`'s task and checklist. */
export function taskReviewPrompt(context: { week: Week; day: Day }): string {
  const { week, day } = context;
  const task = day.task;
  const list = (task?.checklist ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n');
  return [
    taskReviewer(week.track),
    '---',
    materialFor(context),
    task ? `\nThe task they were set:\n\n${task.markdown}` : '',
    task?.files.length ? `\nThe file they were asked to produce: ${task.files.join(', ')}` : '',
    `\nThe checklist to judge it against (${task?.checklist.length ?? 0} items):\n\n${list}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A fence longer than any run of backticks inside the code, so the code cannot close it. */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The message that carries the work itself. */
export function taskSubmission(opts: { file: string | null; code: string; lang: string; notes?: string }): string {
  const fence = fenceFor(opts.code);
  const parts = [
    `Their work${opts.file ? ` — the file \`${opts.file}\`` : ''}:`,
    `${fence}${opts.lang}\n${opts.code.trim()}\n${fence}`,
  ];
  if (opts.notes?.trim()) parts.push(`What they wrote as having confused them:\n\n${opts.notes.trim()}`);
  return parts.join('\n\n');
}

const ITEMS_RE = /\[\[ITEMS:([^\]]*)\]\]/gi;
const ITEM_RE = /(\d+)\s*=\s*(met|partial|missing|unclear)/gi;

/**
 * The reviewer's verdict per checklist item, or null if the line is missing or wrong.
 *
 * Strict on purpose: exactly one entry for each item, none out of range, none repeated.
 * A guess at a half-readable line would be a grade the reviewer never gave, and a grade
 * is the one thing here that should never be invented.
 */
export function parseItems(text: string, count: number): ItemVerdict[] | null {
  const body = [...text.matchAll(ITEMS_RE)].at(-1)?.[1];
  if (!body || count < 1) return null;
  const out: (ItemVerdict | undefined)[] = Array.from({ length: count }, () => undefined);
  for (const m of body.matchAll(ITEM_RE)) {
    const index = Number(m[1]) - 1;
    if (index < 0 || index >= count || out[index]) return null;
    out[index] = m[2].toLowerCase() as ItemVerdict;
  }
  return out.every((v) => v !== undefined) ? (out as ItemVerdict[]) : null;
}

/** The review with its machine-readable line removed, for display. */
export function stripItems(text: string): string {
  return text.replace(ITEMS_RE, '').trimEnd();
}

/**
 * The grade, worked out here from the verdicts and never asked of the model.
 *
 * - solid: every item is met.
 * - almost: nothing is missing, but something is partial or cannot be shown from the file.
 * - notyet: at least one item has no sign of it.
 *
 * Simple enough to say in one line under the result, so a grade is never a mystery: you
 * can see which item held it back.
 */
export function gradeOf(items: ItemVerdict[]): TaskGrade {
  if (items.includes('missing')) return 'notyet';
  return items.every((i) => i === 'met') ? 'solid' : 'almost';
}

/** What the mentor is told when they ask about a review, so it knows the file and the verdicts. */
export function reviewFocus(opts: {
  file: string | null;
  code: string;
  lang: string;
  checklist: string[];
  items: ItemVerdict[];
  grade: TaskGrade;
  review: string;
}): MentorFocus {
  const met = opts.items.filter((i) => i === 'met').length;
  const label = { solid: 'Solid', almost: 'Almost', notyet: 'Not yet' }[opts.grade];
  const shown = opts.code.length > FOLLOW_UP_FILE_CHARS ? `${opts.code.slice(0, FOLLOW_UP_FILE_CHARS)}\n… (the rest is cut off here)` : opts.code;
  const fence = fenceFor(shown);
  return {
    label: 'Check of your work',
    question: `The review of ${opts.file ? `\`${opts.file}\`` : 'your work'}`,
    outcome: [`${label} — ${met} of ${opts.items.length} items met`],
    brief: [
      `A review of their practice task work${opts.file ? ` (${opts.file})` : ''}, which you did not write and must not redo for them.`,
      `The checklist and how each item was judged:\n${opts.checklist.map((c, i) => `${i + 1}. [${opts.items[i]}] ${c}`).join('\n')}`,
      `The grade: ${label} (${met} of ${opts.items.length} met). It follows from the verdicts: any item missing means "not yet"; all met means "solid"; otherwise "almost".`,
      `The review they were shown:\n\n${stripItems(opts.review)}`,
      `Their file:\n${fence}${opts.lang}\n${shown.trim()}\n${fence}`,
    ].join('\n\n'),
  };
}

/** Run a stream to completion. The deck wants the whole challenge, not a typewriter. */
export async function collect(stream: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out.trim();
}
