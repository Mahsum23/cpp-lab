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
const { streamReply, listModels, systemPrompt, PROVIDERS, MentorError } = await import(file);

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `  << ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

// --- a fetch stub that records the request and replays a canned stream ------

let seen = null;
const sse = (frames) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');

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

console.log('\n— gemini failure modes —');
stub({ status: 429, body: { error: { message: 'Resource has been exhausted' } } });
let err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('429 explains the free-tier limit in plain words', err instanceof MentorError && /free tier is rate-limited/i.test(err.message), err.message);

stub({ status: 404, body: { error: { message: 'models/gone is not found' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'gone', system: 's', messages: thread })).catch((e) => e);
ok('404 on a listed model points at regenerating the key first', /aistudio\.google\.com\/apikey/i.test(err.message), err.message);
ok('404 still offers the model picker as a fallback', /pick a different one in Settings/i.test(err.message), err.message);

stub({ status: 401, body: { error: { message: 'API_KEY_SERVICE_BLOCKED' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('401 explains the Standard-key rejection, not a garbled passthrough', /aistudio\.google\.com\/apikey/i.test(err.message), err.message);

stub({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } });
err = await collect(streamReply({ provider: 'gemini', key: 'bad', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('400 on a bad key says so', /rejected that key/i.test(err.message), err.message);

// A safety stop with no text emitted must not look like a silent hang.
stub({ body: sse([{ candidates: [{ finishReason: 'SAFETY' }] }]) });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok('a silent safety stop surfaces as an error', err instanceof MentorError && /SAFETY/.test(err.message), String(err?.message));

// Google's 2.5 models regularly complete a stream with finishReason STOP (or none at
// all) and zero content parts — an upstream hiccup, not a real stop. Nothing has been
// shown on screen yet in that case, so a silent retry should be invisible if it works.
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
  err instanceof MentorError && /known hiccup/i.test(err.message),
  String(err?.message),
);

// A stream that just ends with no finishReason at all is the same "empty" pattern.
stub({ body: sse([{ candidates: [{}] }]) });
err = await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread })).catch((e) => e);
ok(
  'a stream with no finish reason at all gets the same treatment as an empty STOP',
  err instanceof MentorError && /known hiccup/i.test(err.message),
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
stub({ json: { models: [
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Strong. Slow.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Fast. Cheap.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/imagen-3.0', displayName: 'Imagen', supportedGenerationMethods: ['generateContent'] },
] } });
const models = await listModels('gemini', 'k');
ok('only chat-capable models are offered', models.every((m) => !/embedding|imagen/.test(m.id)), JSON.stringify(models.map((m) => m.id)));
ok('flash is listed first for the free tier', models[0].id.includes('flash'), models[0].id);
ok('the note comes from the API description', models[0].note === 'Fast');

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

console.log(fails ? `\n  ${fails} FAILING` : '\n  all mentor cases pass');
process.exit(fails ? 1 : 0);
