/**
 * The in-app mentor: a direct browser → Anthropic Messages API call.
 *
 * No backend, per DESIGN.md §8. The API key is pasted in Settings and stays on the
 * device; `anthropic-dangerous-direct-browser-access` is the header that opts a
 * browser origin into the API, and the endpoint's CORS preflight allows it. The scary
 * name is aimed at people shipping a key to thousands of users — this is one person's
 * key on one person's phone, and the alternative is running a server to hold it.
 *
 * The system prompt below is the load-bearing part of this file. It carries the same
 * prime directive as the repo's CLAUDE.md, which means the mentor tab structurally
 * cannot become a cheat button: it will explain any concept you like and will not hand
 * over the milestone's implementation.
 */
import type { Day, MentorModel, Week } from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Set when a reply failed mid-flight, so the UI can offer a retry. */
  error?: string;
}

export const MODELS: { id: MentorModel; label: string; note: string }[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku', note: 'Fastest and cheapest. Fine for "what does this flag do".' },
  { id: 'claude-sonnet-5', label: 'Sonnet', note: 'The default. Good judgement on concepts, still cheap.' },
  { id: 'claude-opus-5', label: 'Opus', note: 'For the questions you have actually been stuck on.' },
];

/** Anything older than this is dropped from the request — a long thread is mostly cost. */
const HISTORY_LIMIT = 20;

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

function explain(status: number, message: string): string {
  if (status === 401) return 'Anthropic rejected that API key. Check it in Settings — keys start with "sk-ant-".';
  if (status === 400 && /credit/i.test(message)) return 'That account is out of credit. Top it up at console.anthropic.com.';
  if (status === 429) return 'Rate limited. Give it a few seconds.';
  if (status === 529 || status >= 500) return 'The API is overloaded right now. Try again in a moment.';
  return message || `The API said ${status}.`;
}

/**
 * Streams a reply, yielding text as it arrives. An async generator rather than a
 * callback because cancellation then falls out of the language: the caller stops
 * iterating, the `finally` runs, the reader is released.
 */
export async function* streamReply(opts: {
  key: string;
  model: MentorModel;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  // Drop empties, then trim the window — and then drop any leading assistant turn the
  // trim exposed. The API requires the first message to be `user`, so slicing a long
  // thread at an arbitrary point is a 400 waiting to happen.
  const history = opts.messages
    .filter((m) => m.content.trim())
    .slice(-HISTORY_LIMIT)
    .map(({ role, content }) => ({ role, content }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) throw new MentorError('Nothing to send.');

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1600,
        system: opts.system,
        messages: history,
        stream: true,
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return;
    throw new MentorError(navigator.onLine ? 'Could not reach the API.' : 'Offline — the mentor needs a connection.');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* not JSON; the raw body is the best we have */
    }
    throw new MentorError(explain(res.status, message));
  }
  if (!res.body) throw new MentorError('The API returned no body to stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a chunk can split one in half, so
      // the trailing partial frame stays in the buffer until the rest arrives.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!data || data === '[DONE]') continue;

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
  } finally {
    reader.cancel().catch(() => {});
  }
}
