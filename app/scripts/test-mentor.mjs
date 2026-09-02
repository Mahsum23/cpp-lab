/**
 * test-mentor.mjs — the two providers want the same conversation in two different
 * shapes, and every difference is the kind that fails at runtime with a 400 rather
 * than at compile time. Roles, envelope keys, where the system prompt goes, how the
 * key is passed, and which field the streamed text hides in.
 *
 * Run: npm test
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = await build({
  entryPoints: [new URL('../src/lib/mentor.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', write: false,
});
const file = join(tmpdir(), 'cpp-lab-mentor.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { streamReply, listModels, systemPrompt, examinerPrompt, parseVerdict, stripVerdict, PROVIDERS, MentorError, ModelGoneError } = await import(file);

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `  << ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

// --- a fetch stub that records the request and replays a canned stream ------

let seen = null;
// CRLF, because that is what generativelanguage.googleapis.com actually sends. The
// old stub used bare LF, which is why a parser that could not read a single real
// Gemini frame sailed through this entire suite.
const sse = (frames, eol = '\r\n\r\n') =>
  frames.map((f) => `data: ${JSON.stringify(f)}${eol}`).join('');

function stub({ status = 200, body = '', json = null } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    seen = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      body: {
        getReader() {
          const bytes = new TextEncoder().encode(typeof body === 'string' ? body : '');
          let done = false;
          return {
            read: async () => (done ? { done: true } : ((done = true), { done: false, value: bytes })),
            cancel: async () => {},
          };
        },
      },
    };
  };
}
// Node ships a read-only `navigator`; the client reads `.onLine` on the offline path.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const collect = async (gen) => {
  let text = '';
  for await (const chunk of gen) text += chunk;
  return text;
};

const thread = [
  { role: 'user', content: 'why does recv return 0?' },
  { role: 'assistant', content: 'FIN.' },
  { role: 'user', content: 'and -1?' },
];

// --- Gemini ----------------------------------------------------------------

console.log('\n— gemini request shape —');
stub({ body: sse([
  { candidates: [{ content: { parts: [{ text: 'errno ' }] } }] },
  { candidates: [{ content: { parts: [{ text: 'says why.' }] }, finishReason: 'STOP' }] },
]) });

const geminiText = await collect(
  streamReply({ provider: 'gemini', key: 'AIzaTEST', model: 'gemini-2.5-flash', system: 'SYS', messages: thread }),
);
ok('streams text out of candidates[].content.parts[].text', geminiText === 'errno says why.', geminiText);

const g = JSON.parse(seen.body);
ok('hits streamGenerateContent with alt=sse', /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/.test(seen.url), seen.url);
ok('key travels in the header, not the URL', seen.headers['x-goog-api-key'] === 'AIzaTEST' && !seen.url.includes('AIzaTEST'));
ok('system prompt goes in systemInstruction', g.systemInstruction.parts[0].text === 'SYS');
ok('assistant turns are renamed to "model"', g.contents.map((c) => c.role).join(',') === 'user,model,user', JSON.stringify(g.contents.map((c) => c.role)));
ok('text is wrapped in parts[]', g.contents[0].parts[0].text === 'why does recv return 0?');
ok('output is capped', g.generationConfig.maxOutputTokens > 0);

// Both line endings are legal per the SSE spec and both are in use, so parse both.
stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'crlf ok' }] } }] }], '\r\n\r\n') });
ok(
  'CRLF-framed frames parse (this is what Google really sends)',
  (await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }))) === 'crlf ok',
);

stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'lf ok' }] } }] }], '\n\n') });
ok(
  'LF-framed frames still parse (this is what Anthropic sends)',
  (await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }))) === 'lf ok',
);

// A last frame with no trailing blank line used to be dropped on the floor.
stub({ body: 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no trailer' }] } }] }) });
ok(
  'a final frame without its trailing blank line is not lost',
  (await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }))) === 'no trailer',
);

console.log('\n— gemini failure modes —');
stub({ status: 429, body: { error: { message: 'Resource has been exhausted' } } });
let err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('429 explains the free-tier limit in plain words', err instanceof MentorError && /free tier is rate-limited/i.test(err.message), err.message);

// Google's 404 body names the replacement model; passing it through beats paraphrase.
stub({ status: 404, body: { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash', system: 's', messages: thread })).catch((e) => e);
ok("404 passes through Google's own explanation", /no longer available to new users/i.test(err.message), err.message);
ok('404 names the successor Google suggests', /gemini-3\.6-flash/.test(err.message), err.message);
// The caller needs to tell "this model is dead" apart from "this request failed", so
// it can retire the stored choice instead of retrying into the same wall.
ok('a 404 is typed as ModelGoneError', err instanceof ModelGoneError, err.constructor.name);
ok('ModelGoneError is still a MentorError', err instanceof MentorError);

stub({ status: 401, body: { error: { message: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('401 is reported as an auth rejection, not a garbled passthrough', /rejected that key/i.test(err.message), err.message);
ok('a 401 is NOT treated as a dead model', !(err instanceof ModelGoneError));

stub({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'bad', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('400 on a bad key says so', /rejected that key/i.test(err.message), err.message);

// A safety stop with no text emitted must not look like a silent hang.
stub({ body: sse([{ candidates: [{ finishReason: 'SAFETY' }] }]) });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('a silent safety stop surfaces as an error', err instanceof MentorError && /SAFETY/.test(err.message), String(err?.message));

// A stream that completes with finishReason STOP (or none at all) and zero content
// parts must not read as success. Nothing has been shown on screen yet in that case,
// so a silent retry is invisible if it works.
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const body =
      calls === 1
        ? sse([{ candidates: [{ finishReason: 'STOP' }] }])
        : sse([{ candidates: [{ content: { parts: [{ text: 'here you go' }] }, finishReason: 'STOP' }] }]);
    return {
      ok: true, status: 200, json: async () => null, text: async () => body,
      body: {
        getReader() {
          const bytes = new TextEncoder().encode(body);
          let done = false;
          return {
            read: async () => (done ? { done: true } : ((done = true), { done: false, value: bytes })),
            cancel: async () => {},
          };
        },
      },
    };
  };
  const text = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }));
  ok('an empty STOP stream retries once, silently, and returns the real text', text === 'here you go', text);
  ok('the retry made a second request rather than reusing the first', calls === 2, String(calls));
}

// Empty twice in a row is no longer a silent hang — it surfaces as an error.
stub({ body: sse([{ candidates: [{ finishReason: 'STOP' }] }]) });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok(
  'two empty STOP streams in a row surface an error instead of hanging forever',
  err instanceof MentorError && /empty answer twice in a row/i.test(err.message),
  String(err?.message),
);

// A stream that just ends with no finishReason at all is the same "empty" pattern.
stub({ body: sse([{ candidates: [{}] }]) });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok(
  'a stream with no finish reason at all gets the same treatment as an empty STOP',
  err instanceof MentorError && /empty answer twice in a row/i.test(err.message),
  String(err?.message),
);

// --- Anthropic -------------------------------------------------------------

console.log('\n— anthropic request shape —');
stub({ body: sse([
  { type: 'content_block_delta', delta: { text: 'errno ' } },
  { type: 'content_block_delta', delta: { text: 'says why.' } },
]) });

const claudeText = await collect(
  streamReply({ provider: 'anthropic', key: 'sk-ant-TEST', model: 'claude-sonnet-5', system: 'SYS', messages: thread }),
);
ok('streams text out of content_block_delta', claudeText === 'errno says why.', claudeText);

const a = JSON.parse(seen.body);
ok('hits the messages endpoint', seen.url === 'https://api.anthropic.com/v1/messages', seen.url);
ok('sends the browser opt-in header', seen.headers['anthropic-dangerous-direct-browser-access'] === 'true');
ok('system prompt is a top-level string', a.system === 'SYS');
ok('roles stay user/assistant', a.messages.map((m) => m.role).join(',') === 'user,assistant,user');

stub({ status: 400, body: { error: { message: 'Your credit balance is too low' } } });
err = await collect(streamReply({ provider: 'anthropic', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('the no-credit error explains that a subscription is separate', /prepaid and separate from a Claude subscription/i.test(err.message), err.message);

// --- shared: the history window --------------------------------------------

console.log('\n— shared plumbing —');
stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'x' }] } }] }]) });
await collect(streamReply({
  provider: 'gemini', key: 'k', model: 'm', system: 's',
  // A window that would otherwise open on an assistant turn — both APIs reject that.
  messages: [{ role: 'assistant', content: 'stale' }, ...thread],
}));
ok('a trimmed thread still opens on a user turn', JSON.parse(seen.body).contents[0].role === 'user');

stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'x' }] } }] }]) });
await collect(streamReply({
  provider: 'anthropic', key: 'k', model: 'm', system: 's',
  messages: [{ role: 'user', content: 'real' }, { role: 'assistant', content: '   ' }],
}));
ok('empty turns are dropped rather than sent', JSON.parse(seen.body).messages.length === 1);

// --- model discovery -------------------------------------------------------

console.log('\n— model discovery —');
// Shaped after the real catalogue: retired snapshots still listed as healthy, the
// current generations, the `-latest` aliases, and a pile of non-chat neighbours.
stub({ json: { models: [
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Fast. Cheap.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Strong. Slow.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', description: 'Latest release of Gemini Flash.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-pro-latest', displayName: 'Gemini Pro Latest', description: 'Latest release of Gemini Pro.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', description: 'Newest flash.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/imagen-3.0', displayName: 'Imagen', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-image', displayName: 'Flash Image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/lyria-3-pro-preview', displayName: 'Lyria', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-transcribe', displayName: 'Transcribe', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/deep-research-preview-04-2026', displayName: 'Deep Research', supportedGenerationMethods: ['generateContent'] },
] } });
const models = await listModels('gemini', 'k');
const ids = models.map((m) => m.id);
ok('only chat-capable models are offered', ids.every((id) => !/embedding|imagen|image|lyria|transcribe|deep-research/.test(id)), JSON.stringify(ids));
// models[0] is what the app falls back to when the stored choice dies, so it has to
// be an alias that tracks the current model rather than a dated snapshot that retires.
ok('the default pick is the flash alias, not a dated snapshot', models[0].id === 'gemini-flash-latest', models[0].id);
ok('a retired snapshot sinks below the current generation', ids.indexOf('gemini-3.8-flash') < ids.indexOf('gemini-2.5-flash'), JSON.stringify(ids));
ok("flash outranks pro, for the free tier's sake", ids.indexOf('gemini-flash-latest') < ids.indexOf('gemini-pro-latest'), JSON.stringify(ids));
ok('the note comes from the API description', models[0].note === 'Latest release of Gemini Flash.');

stub({ json: { models: [] } });
ok('an empty list falls back to the curated one', (await listModels('gemini', 'k')).length === PROVIDERS.gemini.models.length);
ok('anthropic keeps its hand-written list', (await listModels('anthropic', 'k')) === PROVIDERS.anthropic.models);

// --- the prime directive travels with every request ------------------------

const week = { title: 'Raw Sockets', days: [{ day: 1, title: 'A socket is a file descriptor' }, { day: 2, title: 'Addresses' }] };
const day = { day: 1, title: 'A socket is a file descriptor', theoryMarkdown: 'THEORY', task: { markdown: 'TASK', checklist: ['check one'] } };
const prompt = systemPrompt({ week, day });
ok('system prompt still forbids writing the task', /Never write the implementation for the day's task/.test(prompt));
ok("system prompt carries today's theory and task", prompt.includes('THEORY') && prompt.includes('TASK'));
ok('system prompt names the days still ahead', prompt.includes('Day 2: Addresses'));
ok('no-context prompt still carries the directive', /prime directive/i.test(systemPrompt(null)));

// --- the examiner ----------------------------------------------------------

console.log('\n— teach-back examiner —');

const exam = examinerPrompt({ week, day: { ...day, teachBack: 'Explain why accept() returns a new fd.' } });
ok('examiner is told to measure, not teach', /MEASURE, NOT TO TEACH/.test(exam));
// The whole point of the step: an examiner that answers its own question has destroyed
// the measurement, so this instruction is load-bearing in a way the mentor's isn't.
ok('examiner is forbidden from supplying the explanation', /Never supply the explanation you are asking him for/.test(exam));
ok('examiner names the gap rather than filling it', /Name\s+the gap, never fill it/.test(exam));
ok('examiner rejects jargon restated back at it', /restates jargon/.test(exam));
ok('examiner carries the question being graded', exam.includes('Explain why accept() returns a new fd.'));
ok("examiner carries the day's theory to grade against", exam.includes('THEORY'));
ok('examiner is told not to quote the theory back at him', /Do not quote it back at him/.test(exam));
ok('examiner with no day context still refuses to teach', /MEASURE, NOT TO TEACH/.test(examinerPrompt(null)));

// The verdict is a machine-readable line the UI acts on; the learner never sees it.
ok('a solid verdict parses', parseVerdict('Held up well.\n[[VERDICT: solid]]') === 'solid');
ok('a gaps verdict parses', parseVerdict('You never said where the bytes live.\n[[VERDICT: gaps]]') === 'gaps');
ok('no marker means still examining', parseVerdict('So what happens when the buffer is full?') === null);
// A re-examination after "gaps" has to be able to overturn the earlier ruling.
ok('the last verdict wins, so a retry can overturn a fail', parseVerdict('[[VERDICT: gaps]] ... later ... [[VERDICT: solid]]') === 'solid');
ok('case and spacing in the marker are tolerated', parseVerdict('[[verdict:  Solid ]]') === 'solid');
ok('an invented verdict is not accepted', parseVerdict('[[VERDICT: brilliant]]') === null);

ok('the marker is stripped before display', stripVerdict('Nice.\n[[VERDICT: solid]]') === 'Nice.');
ok('stripping leaves ordinary prose alone', stripVerdict('No marker here.') === 'No marker here.');

console.log(fails ? `\n  ${fails} FAILING` : '\n  all mentor cases pass');
process.exit(fails ? 1 : 0);
