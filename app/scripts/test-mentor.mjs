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
const { streamReply, looksComplete, withFocus, hasHint, stripMarkers, reviewStanding, reviewGraderPrompt, withStanding, MAX_HINTS, MAX_REVIEW_MESSAGES, listModels, systemPrompt, examinerPrompt, parseVerdict, stripVerdict, PROVIDERS, MentorError, BusyError, ModelGoneError, normalizeKey, taskReviewPrompt, taskSubmission, parseItems, stripItems, gradeOf, reviewFocus, MAX_SUBMISSION_CHARS, forgePrompt, forgeData } = await import(file);

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
stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'crlf ok' }] }, finishReason: 'STOP' }] }], '\r\n\r\n') });
ok(
  'CRLF-framed frames parse (this is what Google really sends)',
  (await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }))) === 'crlf ok',
);

stub({ body: sse([{ candidates: [{ content: { parts: [{ text: 'lf ok' }] }, finishReason: 'STOP' }] }], '\n\n') });
ok(
  'LF-framed frames still parse (this is what Anthropic sends)',
  (await collect(streamReply({ provider: 'gemini', key: 'k', model: 'm', system: 's', messages: thread }))) === 'lf ok',
);

// A last frame with no trailing blank line used to be dropped on the floor.
stub({ body: 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no trailer' }] }, finishReason: 'STOP' }] }) });
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
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
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

// A track is one long path now. The mentor is told the track and the topic, and only the
// next few days rather than every day to the end of a path that grows on request.
const path = {
  title: 'PostgreSQL',
  topics: [{ id: 'sql-02-queries', title: 'Queries That Look Right', intro: '' }],
  days: Array.from({ length: 20 }, (_, i) => ({ day: i + 1, title: `T${i + 1}`, topic: 'sql-02-queries' })),
};
const onPath = systemPrompt({ week: path, day: { ...day, day: 4, title: 'T4', topic: 'sql-02-queries' } });
ok('says where: track, topic and day', onPath.includes('PostgreSQL, Queries That Look Right, Day 4 — "T4"'));
ok('lists the next few days, not the whole path', onPath.includes('Day 10: T10') && !onPath.includes('Day 11: T11'));
ok('and never calls it a week', !/this week/i.test(onPath));

// Asked from the review deck, the mentor has to know which card is on screen — without
// it, a question about a quiz card got "how's the day's task going?" back.
const focus = { label: 'From the quiz', question: 'Q?', outcome: [], brief: 'CARD-BRIEF [THEIR PICK]' };
const onCard = systemPrompt({ week, day, focus });
ok('and says it is the review deck, not the lesson', /review deck, not the lesson/.test(onCard));
ok('tells the mentor to answer, not to narrate the setup back', /never describe the situation back/.test(onCard));
ok('and to stay inside the material rather than invent catalog names', /Do not introduce catalog tables/.test(onCard));
// The card itself travels with the message — right above the words it is about.
const wrapped = withFocus('Why is that the answer?', focus);
ok('the card is attached to the message it is asked with', wrapped.includes('CARD-BRIEF [THEIR PICK]') && wrapped.endsWith('Why is that the answer?'));
ok('and sits above the question, not after it', wrapped.indexOf('CARD-BRIEF') < wrapped.indexOf('Why is that'));
ok('no card, no change to the message', withFocus('hi', null) === 'hi' && withFocus('hi', undefined) === 'hi');
ok('the lesson prompt is unchanged without one', !/review deck/.test(prompt));
ok('the directive still travels with a card', /Never write the implementation for the day's task/.test(onCard));

// --- the review conversation ------------------------------------------------

console.log('\n— the review conversation: hints, then the answer —');
ok('a hint marker is recognised', hasHint('Think about the sort order.\n[[HINT]]') && !hasHint('no marker here'));
ok('a hint is not a ruling', parseVerdict('Think about it.\n[[HINT]]') === null);
ok('both markers are stripped for display', stripMarkers('Good.\n[[VERDICT: solid]]') === 'Good.' && stripMarkers('A nudge.\n[[HINT]]') === 'A nudge.');
ok('the ladder is two hints and a handful of messages', MAX_HINTS === 2 && MAX_REVIEW_MESSAGES === 4);

const said = (content) => ({ role: 'user', content });
const marker = (content) => ({ role: 'assistant', content });
let st = reviewStanding([said("I don't know.")]);
ok('first message, no hints yet', st.said === 1 && st.hints === 0 && !st.last && !st.hintsUsedUp, JSON.stringify(st));
st = reviewStanding([said("I don't know."), marker('Try thinking about sort order.\n[[HINT]]'), said('still nothing')]);
ok('one hint spent, second message', st.said === 2 && st.hints === 1 && !st.hintsUsedUp, JSON.stringify(st));
st = reviewStanding([said('idk'), marker('h1\n[[HINT]]'), said('idk'), marker('h2\n[[HINT]]'), said('idk')]);
ok('two hints spent means the next stuck reply gets the answer', st.hints === 2 && st.hintsUsedUp && st.said === 3, JSON.stringify(st));
st = reviewStanding([said('a'), marker('probe?'), said('b'), marker('probe?'), said('c'), marker('probe?'), said('d')]);
ok('a follow-up question is not a hint', st.hints === 0 && st.said === 4 && st.last, JSON.stringify(st));

const ctx = { week, day: { ...day, teachBack: 'Explain X.' } };
const first = reviewGraderPrompt(ctx, 'THE-QUESTION', [said("I don't know.")]);
ok('the challenge is in the prompt', first.includes('THE-QUESTION'));
ok('it describes the two-hint ladder before an answer', /at most two hints/.test(first) && /Once both hints are used/.test(first));
ok('an explicit request for the answer is honoured', /just tell me/.test(first));
ok('a card they only got with a hint still comes back sooner', /only got there\s+after you gave a hint, rule gaps/.test(first));
ok('and stays inside the material', /Do not introduce catalog tables/.test(first));
ok('message 1 of 4, no hints, no extra pressure', /message 1 of at most 4\. Hints given so far: 0 of 2\.$/.test(first), first.slice(-120));
const mid = reviewGraderPrompt(ctx, 'Q', [said('idk'), marker('h1\n[[HINT]]'), said('idk')]);
ok('after one hint it says so', /message 2 of at most 4\. Hints given so far: 1 of 2\.$/.test(mid));
const spent = reviewGraderPrompt(ctx, 'Q', [said('idk'), marker('h1\n[[HINT]]'), said('idk'), marker('h2\n[[HINT]]'), said('idk')]);
ok('once both are spent it tells the model to answer', /Both hints are used: if they are still stuck, give the answer/.test(spent));
const final = reviewGraderPrompt(ctx, 'Q', [said('a'), marker('?'), said('b'), marker('?'), said('c'), marker('?'), said('d')]);
ok('on the last message it must finish', /This is their last message: finish now/.test(final));
ok('with no history there is no state line', !/WHERE THE CONVERSATION STANDS/.test(reviewGraderPrompt(ctx, 'Q')));

// On the last message the model must end the card. Told only at the end of a 15,000
// character system prompt, it still finished with "Try again — what's the full statement?"
// on a card that was already closed, so the note rides on the message itself.
console.log('\n— the last message says so, next to the words —');
const four = [said('a'), marker('?'), said('b'), marker('?'), said('c'), marker('?'), said('the full statement')];
const noted = withStanding(four);
ok('the last message carries the note above their words', /^\[From the app, not from them: this is their message 4 of 4, the LAST one/.test(noted.at(-1).content) && noted.at(-1).content.endsWith('the full statement'));
ok('which forbids another question and "try again"', /Do not ask another question and do not say "try again"/.test(noted.at(-1).content));
ok('and says to give the answer if they have not got it', /give the answer now/.test(noted.at(-1).content));
ok('earlier turns are untouched', noted.slice(0, -1).every((m, i) => m.content === four[i].content));
ok('the original is not mutated', four.at(-1).content === 'the full statement');
ok('the first message gets no note', withStanding([said('hello')]).at(-1).content === 'hello');
ok('a middle message gets no note', withStanding([said('a'), marker('?'), said('b')]).at(-1).content === 'b');
const stuck = withStanding([said('idk'), marker('h1\n[[HINT]]'), said('idk'), marker('h2\n[[HINT]]'), said('idk')]);
ok('with both hints spent it says not to hint again', /both hints are already used/.test(stuck.at(-1).content) && stuck.at(-1).content.endsWith('idk'));
ok('and does not claim it is the last message', !/LAST one/.test(stuck.at(-1).content));
ok('the grader prompt itself forbids a question on the last message', /A question on a last message is a bug/.test(reviewGraderPrompt(ctx, 'Q', [said('x')])));
// On that turn it is a different, single-purpose prompt: close the card.
const closing = reviewGraderPrompt(ctx, 'THE-QUESTION', four);
ok('the last message gets a prompt whose only job is to close the card', /You are closing a spaced-repetition review card/.test(closing) && closing.includes('THE-QUESTION'));
ok('which bans questions and "try again" outright', /cannot ask a question/.test(closing) && /no "try again"/.test(closing));
ok('and carries no ladder to tempt another probe', !/at most two hints/.test(closing) && !/ask ONE\s+focused follow-up/.test(closing));
ok('but still rules, and never with a hint marker', /\[\[VERDICT: solid\]\] or \[\[VERDICT: gaps\]\]/.test(closing) && /Never\s+a hint marker/.test(closing));
ok('earlier messages still get the full ladder', /at most two hints/.test(reviewGraderPrompt(ctx, 'Q', four.slice(0, 5))) && !/closing a spaced-repetition/.test(reviewGraderPrompt(ctx, 'Q', four.slice(0, 5))));
ok('and it still stays inside the material', /Do not introduce catalog tables/.test(closing));

// --- checking the practice task -----------------------------------------------

console.log('\n— the reviewer\'s verdicts and the grade —');
ok('a well-formed line is read', JSON.stringify(parseItems('Fine.\n[[ITEMS: 1=met, 2=partial, 3=missing, 4=unclear]]', 4)) === '["met","partial","missing","unclear"]');
ok('case and spacing are forgiven', JSON.stringify(parseItems('[[items: 1 = MET,2=Partial]]', 2)) === '["met","partial"]');
ok('order does not matter, coverage does', JSON.stringify(parseItems('[[ITEMS: 2=met, 1=missing]]', 2)) === '["missing","met"]');
ok('a missing line gives no grade', parseItems('Looks good to me.', 3) === null);
ok('too few entries gives no grade', parseItems('[[ITEMS: 1=met, 2=met]]', 3) === null);
ok('an entry out of range gives no grade', parseItems('[[ITEMS: 1=met, 2=met, 3=met]]', 2) === null);
ok('a repeated entry gives no grade', parseItems('[[ITEMS: 1=met, 1=missing, 2=met]]', 2) === null);
ok('an invented word gives no grade', parseItems('[[ITEMS: 1=excellent, 2=met]]', 2) === null);
ok('a checklist of none cannot be graded', parseItems('[[ITEMS: ]]', 0) === null);
ok('the last line wins if there are two', JSON.stringify(parseItems('[[ITEMS: 1=missing]]\nActually:\n[[ITEMS: 1=met]]', 1)) === '["met"]');
ok('the machine line is removed for display', stripItems('Good work.\n\n[[ITEMS: 1=met]]') === 'Good work.');

ok('every item met is solid', gradeOf(['met', 'met', 'met']) === 'solid');
ok('a partial item is almost, not solid', gradeOf(['met', 'partial', 'met']) === 'almost');
ok('an unprovable item is almost, not a fail', gradeOf(['met', 'unclear']) === 'almost');
ok('any missing item is not yet, however much else is met', gradeOf(['met', 'met', 'missing', 'partial']) === 'notyet');
ok('all missing is not yet', gradeOf(['missing', 'missing']) === 'notyet');

console.log('\n— what the reviewer is told —');
const tday = { day: 2, title: 'An index is a sorted copy', theoryMarkdown: 'THEORY-TEXT', task: { markdown: 'TASK-TEXT', files: ['sql/day02.sql'], compile: null, checklist: ['plans recorded', 'index built'] } };
const trp = taskReviewPrompt({ week: { title: 'W', track: 'sql', days: [tday] }, day: tday });
ok('it carries the lesson, the task and the file', trp.includes('THEORY-TEXT') && trp.includes('TASK-TEXT') && trp.includes('sql/day02.sql'));
ok('the checklist is numbered so verdicts can point at items', trp.includes('1. plans recorded') && trp.includes('2. index built') && /2 items/.test(trp));
ok('it says it cannot run the code', /You cannot run it/.test(trp));
ok('unprovable is unclear, not met or missing', /"unclear": not "met", and not "missing"/.test(trp));
ok('it may not write the solution', /Never write the solution or\s+a corrected version of the file/.test(trp));
ok('it asks for the machine line in the format the parser reads', /\[\[ITEMS: 1=met, 2=partial, 3=unclear\]\]/.test(trp));
ok('it is told the track it is reviewing', /SQL/i.test(trp));

const plainSub = taskSubmission({ file: 'sql/day02.sql', code: 'SELECT 1;', lang: 'sql', notes: '' });
ok('the submission names the file and fences the code', plainSub.includes('`sql/day02.sql`') && plainSub.includes('```sql\nSELECT 1;\n```'));
ok('no notes means no notes section', !/confused/.test(plainSub));
ok('notes ride along when there are some', /confused them:\n\nthe cost part/.test(taskSubmission({ file: null, code: 'x', lang: 'sql', notes: ' the cost part ' })));
const nested = taskSubmission({ file: null, code: 'a\n```\nb\n```\nc', lang: 'sql' });
ok('code containing a fence cannot close the fence early', /^````sql\n[\s\S]*\n````$/m.test(nested) && nested.trimEnd().endsWith('````'));
ok('the size cap is generous but finite', MAX_SUBMISSION_CHARS >= 20000 && MAX_SUBMISSION_CHARS <= 200000);

const fx = reviewFocus({ file: 'sql/day02.sql', code: 'CREATE INDEX i ON t (a);', lang: 'sql', checklist: ['plans recorded', 'index built'], items: ['partial', 'met'], grade: 'almost', review: 'Decent.\n[[ITEMS: 1=partial, 2=met]]' });
ok('a follow-up sees the verdict beside each checklist item', fx.brief.includes('1. [partial] plans recorded') && fx.brief.includes('2. [met] index built'));
ok('and the grade with the rule behind it', fx.brief.includes('Almost (1 of 2 met)') && /any item missing means "not yet"/.test(fx.brief));
ok('and the review without its machine line, and their file', !fx.brief.includes('[[ITEMS') && fx.brief.includes('CREATE INDEX i ON t (a);'));
ok('and is told not to redo their work for them', /must not redo for them/.test(fx.brief));
ok('the header shows the grade and count', fx.outcome[0] === 'Almost — 1 of 2 items met');
const big = reviewFocus({ file: null, code: 'x'.repeat(30000), lang: 'sql', checklist: ['a'], items: ['met'], grade: 'solid', review: 'ok' });
ok('a long file is trimmed on follow-ups, not resent whole', big.brief.length < 12000 && /the rest is cut off/.test(big.brief), String(big.brief.length));

// --- the examiner ----------------------------------------------------------

console.log('\n— teach-back examiner —');

const exam = examinerPrompt({ week, day: { ...day, teachBack: 'Explain why accept() returns a new fd.' } });
ok('examiner is told to measure, not teach', /MEASURE, NOT TO TEACH/.test(exam));
// The whole point of the step: an examiner that answers its own question has destroyed
// the measurement, so this instruction is load-bearing in a way the mentor's isn't.
ok('examiner is forbidden from supplying the explanation', /Never supply the explanation you are asking (?:them|him) for/.test(exam));
ok('examiner names the gap rather than filling it', /Name\s+the gap, never fill it/.test(exam));
ok('examiner rejects jargon restated back at it', /restate(?:s)? jargon/.test(exam));
ok('examiner carries the question being graded', exam.includes('Explain why accept() returns a new fd.'));
ok("examiner carries the day's theory to grade against", exam.includes('THEORY'));
ok('examiner is told not to quote the theory back', /Do not quote it back at (?:them|him)/.test(exam));
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

// --- pasted keys ------------------------------------------------------------

console.log('\n— key normalisation —');
// Pasting the key is the one manual setup step, so it has to tolerate what a real
// paste drags along. Every one of these otherwise 400s and reads as "my key is wrong".
ok('a clean key is untouched', normalizeKey('AQ.Ab8dEf') === 'AQ.Ab8dEf');
ok('trailing newline from a code block is stripped', normalizeKey('AIzaSyAbc123\n') === 'AIzaSyAbc123');
ok('surrounding spaces go', normalizeKey('   AIzaSyAbc123  ') === 'AIzaSyAbc123');
ok('straight quotes go', normalizeKey('"AIzaSyAbc123"') === 'AIzaSyAbc123');
ok('smart quotes from a notes app go', normalizeKey('\u201cAIzaSyAbc123\u201d') === 'AIzaSyAbc123');
ok('a copied env line loses its prefix', normalizeKey('GEMINI_API_KEY=AIzaSyAbc123') === 'AIzaSyAbc123');
ok('an exported env line does too', normalizeKey('export API_KEY="AIzaSyAbc123"') === 'AIzaSyAbc123');
ok('an internal space (mobile line-wrap) is removed', normalizeKey('AIzaSy Abc123') === 'AIzaSyAbc123');
ok('an empty paste stays empty', normalizeKey('   ') === '');

// --- a busy provider should not become a dead end --------------------------

console.log('\n— retrying what the far end fumbled —');

/**
 * Replays a scripted sequence of responses, one per fetch, recording each attempt.
 * `body` on a 200 is the SSE stream; anything else is an error payload.
 */
function script(steps) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    const step = steps[Math.min(i++, steps.length - 1)];
    calls.push({ url: String(url), model: /models\/([^:]+):/.exec(String(url))?.[1] });
    // Mirror the simple stub, so assertions about the request body work either way.
    seen = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    const bytes = new TextEncoder().encode(step.body ?? '');
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? (step.retryAfter ?? null) : null) },
      json: async () => null,
      text: async () => step.text ?? '',
      body: { getReader() { let done = false; return {
        read: async () => (done ? { done: true } : ((done = true), { done: false, value: bytes })),
        cancel: async () => {} }; } },
    };
  };
  return calls;
}

const say = (t) => sse([{ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }]);
const drain = async (gen) => { let out = ''; for await (const c of gen) out += c; return out; };
const ask = (over = {}) => streamReply({
  provider: 'gemini', key: 'AIzaTEST', model: 'gemini-flash-latest',
  system: 'SYS', messages: [{ role: 'user', content: 'hi' }], ...over,
});

// A 503 that clears on the second attempt should be completely invisible.
let calls = script([{ status: 503 }, { status: 200, body: say('recovered') }]);
ok('a 503 is retried rather than surfaced', (await drain(ask())) === 'recovered');
ok('and it took two attempts', calls.length === 2, String(calls.length));

// Three 503s in a row is a real outage, and the message should admit we already tried.
calls = script([{ status: 503 }]);
const dead = await drain(ask()).then(() => null, (e) => e);
ok('a persistent 503 gives up eventually', dead instanceof Error, String(dead));
ok('and says it already retried', /already retried/i.test(dead?.message ?? ''), dead?.message);
ok('it is typed as busy, not as a plain failure', dead instanceof BusyError);
ok('after exactly MAX_ATTEMPTS tries', calls.length === 3, String(calls.length));

// A 400 is our fault, not theirs: retrying it just wastes the user's time.
calls = script([{ status: 400, text: JSON.stringify({ error: { message: 'bad request' } }) }]);
await drain(ask()).catch(() => {});
ok('a 400 is not retried', calls.length === 1, String(calls.length));

// 429 is a quota on the free tier — only retried when the server names a delay.
calls = script([{ status: 429 }]);
await drain(ask()).catch(() => {});
ok('a bare 429 is not retried into its own quota', calls.length === 1, String(calls.length));
calls = script([{ status: 429, retryAfter: '0' }, { status: 200, body: say('ok now') }]);
ok('a 429 with Retry-After is honoured', (await drain(ask())) === 'ok now');
ok('and that took two attempts', calls.length === 2, String(calls.length));

console.log('\n— falling through to another model —');

// Google overloads its newest models most, so a busy one is a reason to try the next.
calls = script([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200, body: say('older model answered') }]);
ok(
  'a busy model falls through to an alternate',
  (await drain(ask({ alternates: ['gemini-2.5-flash'] }))) === 'older model answered',
);
ok('the alternate is actually a different model', calls.at(-1).model === 'gemini-2.5-flash', calls.at(-1).model);
ok('the first model was retried before giving up on it', calls.filter((c) => c.model === 'gemini-flash-latest').length === 3);

// A retired model is at least as good a reason to move on as a busy one.
calls = script([{ status: 404, text: JSON.stringify({ error: { message: 'gone' } }) }, { status: 200, body: say('fallback') }]);
ok('a 404 also falls through', (await drain(ask({ alternates: ['gemini-2.5-flash'] }))) === 'fallback');
ok('a gone model is not retried, only replaced', calls.length === 2, String(calls.length));

console.log('\n— a reply that was cut short says so —');

// Gemini 2.5+ spends thinking tokens out of maxOutputTokens, so a reply can stop
// mid-sentence with text already on screen. That used to be indistinguishable from a
// finished answer.
script([{ status: 200, body: sse([
  { candidates: [{ content: { parts: [{ text: 'This part is yours to run, but here is how' }] } }] },
  { candidates: [{ finishReason: 'MAX_TOKENS' }] },
]) }]);
let cut = await drain(ask());
ok('the text that did arrive is kept', cut.startsWith('This part is yours to run'), cut);
ok('and the reply admits it was cut off', /cut off/i.test(cut), cut);
ok('naming the length limit specifically', /length limit/i.test(cut), cut);

// Any other early stop is worth naming too.
script([{ status: 200, body: sse([
  { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
  { candidates: [{ finishReason: 'SAFETY' }] },
]) }]);
cut = await drain(ask());
ok('another early stop names its reason', /cut off .*SAFETY/i.test(cut), cut);

// A normal reply must stay clean — no footnote on every message.
script([{ status: 200, body: sse([
  { candidates: [{ content: { parts: [{ text: 'a complete answer' }] }, finishReason: 'STOP' }] },
]) }]);
ok('a finished reply gets no note', (await drain(ask())) === 'a complete answer');

// Every real reply ends on a frame carrying a finish reason. One that just stops was
// cut in transit, and used to pass for a finished answer.
script([{ status: 200, body: sse([
  { candidates: [{ content: { parts: [{ text: 'A table has a live row whose `ctid` is `(0, 5' }] } }] },
]) }]);
cut = await drain(ask());
ok('a stream with no finish reason is flagged as cut off', /cut off .*connection ended/i.test(cut), cut);

const claude = (frames) => { stub({ body: sse(frames) }); return collect(streamReply({ provider: 'anthropic', key: 'k', model: 'm', system: 's', messages: thread })); };
cut = await claude([
  { type: 'content_block_delta', delta: { text: 'half' } },
  { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
  { type: 'message_stop' },
]);
ok('anthropic: max_tokens names the length limit', /length limit/i.test(cut), cut);
cut = await claude([{ type: 'content_block_delta', delta: { text: 'half' } }]);
ok('anthropic: no message_stop is flagged as cut off', /connection ended/i.test(cut), cut);
cut = await claude([
  { type: 'content_block_delta', delta: { text: 'done.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
]);
ok('anthropic: a finished reply gets no note', cut === 'done.', cut);

console.log('\n— is a challenge finished? —');
// The screenshot case: Gemini can stop mid-sentence and still report STOP, so the text
// itself is the only evidence left.
const complete = [
  'A row has `ctid` `(0, 5)`. After one `UPDATE`, what is its new `ctid`?',
  'What does this print?\n\n```cpp\nint x = 1; // `odd` backtick in code is fine\nstd::cout << x;\n```',
  'Name the call that fills the backlog.',
  'Which `errno` does `recv()` set when the peer resets?',
];
const unfinished = [
  'A table has a live row whose `ctid` is `(0, 5',
  'What does this print?\n\n```cpp\nint x = 1;',
  'After the second insert the page holds',
  'What is the value of `x',
  'A reply.\n\n_(cut off — the connection ended before the model said it was done. Ask again.)_',
  '',
];
for (const t of complete) ok(`complete: ${JSON.stringify(t.slice(0, 40))}`, looksComplete(t));
for (const t of unfinished) ok(`unfinished: ${JSON.stringify(t.slice(0, 40))}`, !looksComplete(t));

console.log('\n— thinking must not eat the whole budget —');
script([{ status: 200, body: sse([{ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }]) }]);
await drain(ask({ model: 'gemini-flash-latest' }));
let cfg = JSON.parse(seen.body).generationConfig;
ok('the output budget leaves room after thinking', cfg.maxOutputTokens >= 4096, String(cfg.maxOutputTokens));
ok('a Flash model is given a bounded thinking budget', cfg.thinkingConfig?.thinkingBudget > 0, JSON.stringify(cfg));
ok('and that budget is well under the total', cfg.thinkingConfig.thinkingBudget < cfg.maxOutputTokens / 2);

// Other families reject the field or have their own floor; a 400 would break the chat.
script([{ status: 200, body: sse([{ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }]) }]);
await drain(ask({ model: 'gemini-2.5-pro' }));
cfg = JSON.parse(seen.body).generationConfig;
ok('a non-Flash model is not sent thinkingConfig', cfg.thinkingConfig === undefined, JSON.stringify(cfg));

console.log('\n— a generated challenge must be answerable from what is on screen —');
const sqlDay = { id: 'sql-day-04', title: 'Order', theoryMarkdown: 'x', write: { lang: 'sql', setup: 'CREATE TABLE orders (id int);\nINSERT INTO orders VALUES (1);', defs: {}, challenges: [] } };
const sqlWeek = { id: 'track-sql', track: 'sql', title: 'SQL' };
ok('a SQL day with data tells the model which tables exist', forgePrompt({ week: sqlWeek, day: sqlDay }).includes('CREATE TABLE orders'));
ok('...and that the reader is shown them', /shows exactly this to the reader/.test(forgePrompt({ week: sqlWeek, day: sqlDay })));
ok('the practice bank\'s data is preferred when it has its own', forgeData('sql', { ...sqlDay, practice: { write: { setup: 'CREATE TABLE users (id int);' } } }) === 'CREATE TABLE users (id int);');
ok('a SQL day with no data offers none (the challenge must carry its own)', forgeData('sql', { ...sqlDay, write: null }) === null);
ok('Go and C++ never get a DATA block', forgeData('go', sqlDay) === null && !/DATA —/.test(forgePrompt({ week: { track: 'cpp', title: 'C++' }, day: sqlDay })));
ok('the rule against unseen tables is in the prompt', /ON THE SCREEN/.test(forgePrompt({ week: sqlWeek, day: sqlDay })) && /Do not invent a\s+table/.test(forgePrompt({ week: sqlWeek, day: sqlDay })));
ok('a Go challenge is about Go, not C++', /Go language/.test(forgePrompt({ week: { track: 'go', title: 'Go' }, day: sqlDay })));

console.log(fails ? `\n  ${fails} FAILING` : '\n  all mentor cases pass');
process.exit(fails ? 1 : 0);
