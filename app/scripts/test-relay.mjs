/**
 * test-relay.mjs — Google geo-blocks the Generative Language API in some countries, so
 * the app can be pointed at a relay the user runs. What must hold: with one configured
 * every call goes through it, without one nothing changes, and the path the relay
 * receives is the one its config knows how to rewrite.
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
const file = join(tmpdir(), 'cpp-lab-relay.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { setRelay, relay, listModels } = await import(file);

Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

/** Capture the URL the app would actually request, without making a request. */
let seen = [];
globalThis.fetch = async (url) => {
  seen.push(String(url));
  return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const urlFor = async (base) => {
  setRelay(base);
  seen = [];
  await listModels('gemini', 'KEY').catch(() => {});
  return seen[0] ?? '';
};

console.log('\n— unset means nothing changes —');
let u = await urlFor(null);
ok('goes straight to Google', u.startsWith('https://generativelanguage.googleapis.com/v1beta/'), u);
ok('and relay() reports none', relay() === null);

for (const empty of ['', '   ', null, undefined]) {
  setRelay(empty);
  ok(`${JSON.stringify(empty)} counts as unset`, relay() === null);
}

console.log('\n— configured —');
u = await urlFor('https://host.example/tok3n');
ok('routes through the relay', u.startsWith('https://host.example/tok3n/gemini/v1beta/'), u);
ok('keeps the path the Caddyfile strips', u.includes('/tok3n/gemini/v1beta/models'), u);
ok('and the query survives', u.includes('pageSize=200'), u);

console.log('\n— trailing slashes —');
/** A pasted URL very often ends in one, and two joined would 404 on a path matcher. */
for (const base of ['https://host.example/tok3n/', 'https://host.example/tok3n//']) {
  u = await urlFor(base);
  ok(`${base} does not produce a double slash`, !u.includes('/tok3n//gemini'), u);
}

console.log('\n— switching back —');
await urlFor('https://host.example/tok3n');
u = await urlFor(null);
ok('clearing it returns to direct calls', u.startsWith('https://generativelanguage.googleapis.com/'), u);

console.log('\n— a geo-block is named as one —');
/**
 * Google answers a blocked location with 400 FAILED_PRECONDITION. The branches that
 * handle other 400s talk about the key, and a geo-block is the one failure where the key
 * is certainly fine — so this must be caught before them, and by its text.
 */
const geo = JSON.stringify({ error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } });
globalThis.fetch = async () => new Response(geo, { status: 400, headers: { 'content-type': 'application/json' } });
setRelay(null);
let caught = '';
try { await listModels('gemini', 'KEY'); } catch (e) { caught = String(e?.message ?? e); }
ok('it is reported as a location problem', /location/i.test(caught), caught);
ok('and explicitly not as a key problem', /not a problem with your key/i.test(caught), caught);
ok('and it names a way out', /proxy|relay/i.test(caught), caught);

const badKey = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
globalThis.fetch = async () => new Response(badKey, { status: 400, headers: { 'content-type': 'application/json' } });
caught = '';
try { await listModels('gemini', 'KEY'); } catch (e) { caught = String(e?.message ?? e); }
ok('a real bad-key 400 still gets the key advice', /key/i.test(caught) && !/location/i.test(caught), caught);

console.log(fails ? `\n  ${fails} FAILING` : '\n  all relay cases pass');
process.exit(fails ? 1 : 0);
