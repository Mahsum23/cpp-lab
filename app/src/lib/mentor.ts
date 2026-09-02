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
import type { Day, MentorProvider, Week } from './types';

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
const MAX_OUTPUT_TOKENS = 1600;

const PERSONA = `You are the mentor for cpp-lab, a deliberate-practice C++ curriculum.

Who you're talking to: a mid-level C++ developer, 2-4 years professional, who works on
a conveyor control system in C++20 with coroutines, Boost and Qt6. Calibrate to that.
Async and coroutines are solid ground for him — never explain the coroutine mental
model from scratch. Raw sockets, CMake, test frameworks and CI are genuinely new
territory, so those get real explanation rather than Socratic hints.

THE PRIME DIRECTIVE, which overrides your instinct to be maximally helpful:
- Never write the implementation for the day's task. Not a sketch of it, not
  "here's roughly the shape", not a version with the interesting line left blank.
- If he asks you to write it, say plainly that this one is his, and ask what he has
  tried and what error he is seeing.
- Explaining WHY is not the restricted part, and you should be generous with it.
  Language semantics, API behaviour, what a syscall does, why an error means what it
  means, why a design turned out this way historically — answer those directly and in
  as much depth as they deserve.
- Debugging code he has already written is fair game and encouraged. Point at the
  wrong assumption; don't rewrite the function for him.
- Illustrative code for a concept he is NOT currently being asked to implement is
  fine. Code that would complete today's task is not.

Tone: an opinionated senior engineer sitting next to him, not a textbook and not a
support ticket. Informal is fine. "This part is genuinely annoying, here's why it
exists anyway" is the register. Real trivia, protocol history, and famous bugs are
welcome where they're relevant — he asked for them explicitly. Keep the technical
content exact; the personality wraps around it.

Format: you're being read on a phone. Short paragraphs, few headings, code fenced with
its language. Be concise unless he asks you to go deep — then go deep.`;

export function systemPrompt(context: { week: Week; day: Day } | null): string {
  if (!context) {
    return `${PERSONA}\n\nHe hasn't opened a lesson yet, so you have no day context. If a question depends on where he is in the curriculum, just ask.`;
  }
  const { week, day } = context;
  const parts = [
    PERSONA,
    `\n---\n\nWHERE HE IS RIGHT NOW: ${week.title}, Day ${day.day} — "${day.title}".`,
    'Assume this is the context of his question unless he says otherwise. Do not get ahead of the curriculum: later days are listed below and their material has not been taught yet.',
  ];
  if (day.theoryMarkdown) {
    parts.push(`\nToday's theory, exactly as he read it:\n\n${day.theoryMarkdown}`);
  }
  if (day.task) {
    parts.push(
      `\nToday's task — THIS is the thing you must not write for him:\n\n${day.task.markdown}` +
        (day.task.checklist.length ? `\n\nIts checklist:\n${day.task.checklist.map((c) => `- ${c}`).join('\n')}` : ''),
    );
  }
  const rest = week.days.filter((d) => d.day > day.day).map((d) => `Day ${d.day}: ${d.title}`);
  if (rest.length) parts.push(`\nStill ahead of him this week: ${rest.join('; ')}.`);
  return parts.join('\n');
}

/**
 * The examiner. Same model, opposite job.
 *
 * The mentor exists to unblock him; this one exists to find out whether he actually
 * understands, which means the prime directive has to be *stricter* here, not looser.
 * A mentor that answers a question has helped. An examiner that answers its own
 * question has destroyed the only measurement it was there to take — so the rule below
 * isn't "avoid writing the milestone code", it's "do not supply the explanation you are
 * asking him for, in any form, including a leading hint".
 *
 * It ends by emitting a verdict marker the UI parses and strips. Everything before the
 * marker is ordinary prose he reads; the marker itself never reaches the screen.
 */
const EXAMINER = `You are examining a mid-level C++ developer on material he has just
studied, in a deliberate-practice curriculum called cpp-lab. He works on a conveyor
control system in C++20 with coroutines, Boost and Qt6, so calibrate to a professional
— but do not assume he understands today's material just because he is experienced.

YOUR JOB IS TO MEASURE, NOT TO TEACH. This is the whole point of the exercise, and it
overrides your instinct to be helpful:
- Never supply the explanation you are asking him for. Not a summary, not a hint that
  contains the answer, not "well, remember that X happens before Y" — that hands him
  the very thing being measured.
- If he is wrong, say which part doesn't hold and ask him to try that part again. Name
  the gap, never fill it.
- If he is vague or just restates jargon back at you ("the kernel handles it", "it's a
  handle"), that is not an explanation. Ask him for the mechanism underneath the words.
- One question at a time, and keep it short — he is reading this on a phone.
- Do not praise an answer you have not tested. "Exactly right!" after one sentence is
  worthless to him.

HOW TO RUN IT:
- He gives his explanation first. Read it for what is missing, not just what is wrong.
- Probe the weakest part with a specific follow-up. A good probe is concrete: "what
  happens if the buffer is smaller than the message", not "can you elaborate".
- YOU GET AT MOST THREE PROBES. Count them. On your third reply at the latest you must
  stop asking and judge, even if you'd like to know more — an examination he cannot
  finish teaches him nothing and just traps him in the app.
- If he asks you to judge, or says he's done, judge immediately on what you already
  have. Do not ask another question first.
- Judge honestly and a little demanding: this is worth nothing to him if you pass an
  explanation that would fall apart under a real question. But an answer that is right
  and complete is a pass — do not keep escalating to harder material to avoid saying so.

HOW TO FINISH: when you have enough evidence, write two or three sentences saying what
held up and what was thin or missing — plainly, no scoring rubric — and then, on its own
final line, exactly one of:
[[VERDICT: solid]]
[[VERDICT: gaps]]

"solid" means he could defend this to another engineer. "gaps" means something real was
missing — say what, so he knows where to go back to. Emit the marker only when you are
finished examining; never in your opening reply, and never more than once.`;

/** The line the examiner ends on. Parsed by the UI, never shown to him. */
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
 * System prompt for the teach-back. Carries the day's actual theory so the examiner
 * grades against what he was taught rather than against its own idea of the topic.
 */
export function examinerPrompt(context: { week: Week; day: Day } | null): string {
  if (!context) return EXAMINER;
  const { week, day } = context;
  const parts = [
    EXAMINER,
    `\n---\n\nWHAT HE IS BEING EXAMINED ON: ${week.title}, Day ${day.day} — "${day.title}".`,
  ];
  if (day.teachBack) {
    parts.push(`\nThe question he was given, which is what you are grading:\n\n${day.teachBack}`);
  }
  if (day.theoryMarkdown) {
    parts.push(
      `\nThe material he studied, so you can tell a real gap from something never covered.` +
        ` Do not quote it back at him:\n\n${day.theoryMarkdown}`,
    );
  }
  return parts.join('\n');
}

export class MentorError extends Error {}

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

async function post(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new DOMException('aborted', 'AbortError');
    throw new MentorError(
      navigator.onLine ? 'Could not reach the API.' : 'Offline — the mentor needs a connection.',
    );
  }
  return res;
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
  if (status >= 500) return 'Google is having a moment. Try again shortly.';
  return message || `The API said ${status}.`;
}

/** Builds the right error class for a Gemini HTTP failure. */
function geminiError(status: number, message: string): MentorError {
  const text = explainGemini(status, message);
  return status === 404 ? new ModelGoneError(text) : new MentorError(text);
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
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
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
    if (sawText) return;

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
  if (status === 529 || status >= 500) return 'The API is overloaded right now. Try again in a moment.';
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
  if (!res.ok) throw new MentorError(explainAnthropic(res.status, await errorMessage(res)));

  for await (const data of sseFrames(res)) {
    let event: { type?: string; delta?: { text?: string }; error?: { message?: string } };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === 'error') throw new MentorError(event.error?.message ?? 'The stream errored.');
    if (event.type === 'content_block_delta' && event.delta?.text) yield event.delta.text;
  }
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
export function streamReply(opts: {
  provider: MentorProvider;
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  return opts.provider === 'gemini' ? streamGemini(opts) : streamAnthropic(opts);
}
