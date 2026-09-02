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
    placeholder: 'AIza…',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleLabel: 'aistudio.google.com/apikey',
    cost: 'Free tier, rate-limited rather than metered. No card, no credits.',
    free: true,
    // Seeds only. The real list is fetched from the API the moment a key is saved,
    // which is the point: model names get retired, and a hardcoded one eventually 404s.
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Fast, and the free tier is generous with it.' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Stronger, with a much tighter free-tier limit.' },
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

export class MentorError extends Error {}

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
 * Yields the `data:` payload of each complete SSE frame.
 *
 * Frames are separated by a blank line, and a network chunk can split one down the
 * middle, so the trailing partial frame stays buffered until the rest arrives.
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
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (data && data !== '[DONE]') yield data;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// --- Gemini ----------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Google spent 2026 retiring "Standard" API keys in favour of "Authorization" keys
// (bound to a Cloud service account), rejecting Standard keys on generateContent
// outright from September 2026. listModels stays a lighter, less-gated call that
// still answers for an old key, so the failure only shows up once you actually try
// to talk to it — as a 401 (API_KEY_SERVICE_BLOCKED / ACCESS_TOKEN_TYPE_UNSUPPORTED)
// or, confusingly, as a 404 on a model that was just in the fetched list. New keys
// minted from AI Studio are auto-issued as the working type, so regenerating one is
// the actual fix far more often than it looks like from the error text alone.
const REGEN_KEY_HINT =
  'Generate a fresh key at aistudio.google.com/apikey rather than reusing an old one — Google phased out the old "Standard" key type for this call during 2026, and new keys are issued as the type that still works.';

function explainGemini(status: number, message: string): string {
  if (status === 400 && /api.?key/i.test(message)) {
    return 'Google rejected that key. Copy it again from aistudio.google.com/apikey — it starts with "AIza".';
  }
  if (status === 401) {
    return `Google is blocking that key at the auth layer, before it even looks at the model. ${REGEN_KEY_HINT}`;
  }
  if (status === 403) {
    return message.includes('SERVICE_DISABLED') || /not been used|disabled/i.test(message)
      ? "The Generative Language API isn't enabled for that key's Google Cloud project. Making the key from AI Studio rather than the Cloud console avoids this."
      : 'Google refused the request. Check the key is still active.';
  }
  if (status === 404) {
    // The model came from Google's own list a moment ago, so a 404 here is more often
    // the key than a genuinely missing model — but it can be either, so say both.
    return (
      "Google says that model doesn't exist for this key — odd, since it was just in the fetched list. That combination usually means the key, not the model: " +
      `${REGEN_KEY_HINT} If a fresh key still 404s on this exact model, then pick a different one in Settings.`
    );
  }
  if (status === 429) {
    return "Gemini's free tier is rate-limited, and you've hit it. Wait a minute, or switch to a Flash model — its limits are much higher.";
  }
  if (status >= 500) return 'Google is having a moment. Try again shortly.';
  return message || `The API said ${status}.`;
}

interface GeminiModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/** Models that answer chat turns. Excludes embeddings, image/video/audio and the rest. */
const NOT_CHAT = /embedding|aqa|imagen|veo|image-generation|tts|audio|learnlm|gemma/i;

async function listGeminiModels(key: string): Promise<ModelChoice[]> {
  const res = await post(`${GEMINI_BASE}/models?pageSize=200`, {
    method: 'GET',
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) throw new MentorError(explainGemini(res.status, await errorMessage(res)));

  const body = (await res.json()) as { models?: GeminiModel[] };
  const choices = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      label: m.displayName || m.name.replace(/^models\//, ''),
      note: (m.description ?? '').split('. ')[0].slice(0, 110),
    }))
    .filter((m) => !NOT_CHAT.test(m.id));

  // Flash first: on the free tier the limit that bites is requests per minute, and
  // Flash gets several times the allowance Pro does.
  choices.sort((a, b) => Number(b.id.includes('flash')) - Number(a.id.includes('flash')));
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
  if (!res.ok) throw new MentorError(explainGemini(res.status, await errorMessage(res)));

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
 * Google's 2.5 models have a well-documented habit of completing a stream with
 * `finishReason: "STOP"` (or no finish reason at all) and zero content parts —
 * reported at up to ~50% of first-turn requests in the wild. Nothing is wrong with
 * the question; it's an upstream hiccup. The old code only distinguished "stopped
 * for a real reason" (SAFETY, RECITATION, …) from everything else, so this exact
 * pattern — no text, an innocuous finish reason — fell through both checks and the
 * request just ended with nothing said and nothing thrown: a silent hang from the
 * user's seat, cursor blinking forever.
 *
 * Since nothing will have been shown on screen yet when this happens, one transparent
 * retry is invisible if it works and costs one extra round trip if it doesn't — far
 * better than surfacing a Google flake as "the mentor is broken."
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
        "Gemini finished without sending any text, twice in a row — a known hiccup with this model, not your question. Try again in a moment, or switch models in Settings.",
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
