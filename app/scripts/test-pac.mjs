/**
 * test-pac.mjs — the PAC file decides which requests leave through a proxy. Getting it
 * wrong in one direction breaks the mentor; in the other it quietly sends traffic the
 * user never meant to route. Both directions are tested.
 *
 * Run: npm test
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../deploy/cpp-lab.pac', import.meta.url), 'utf8');
const pac = source.replace('PROXY_HERE', '203.0.113.7:1080');

// A PAC file runs in a bare JS sandbox with no module system — evaluate it the same way.
const ctx = vm.createContext({});
vm.runInContext(pac, ctx);
const route = (host) => ctx.FindProxyForURL(`https://${host}/`, host);

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

console.log('\n— the two APIs go through the proxy —');
for (const host of ['generativelanguage.googleapis.com', 'api.anthropic.com']) {
  ok(host, route(host) === 'SOCKS5 203.0.113.7:1080', route(host));
}
ok('case does not matter', route('GenerativeLanguage.GoogleAPIs.com') === 'SOCKS5 203.0.113.7:1080');

console.log('\n— everything else stays direct —');
for (const host of [
  'mahsum23.github.io',          // the app itself
  'api.github.com',              // progress sync
  'gist.githubusercontent.com',
  'www.google.com',
  'fonts.googleapis.com',        // same parent domain, different service
  'storage.googleapis.com',
]) {
  ok(host, route(host) === 'DIRECT', route(host));
}

console.log('\n— lookalikes are not routed —');
/** The case a suffix match gets wrong. */
for (const host of [
  'evilgoogleapis.com',
  'generativelanguage.googleapis.com.evil.example',
  'xgenerativelanguage.googleapis.com',
  'api.anthropic.com.evil.example',
  'notapi.anthropic.com',
]) {
  ok(host, route(host) === 'DIRECT', route(host));
}

console.log('\n— the template is not usable as shipped —');
/**
 * Exactly one placeholder, so any method of filling it in fills the setting. An earlier
 * version repeated the token in a usage comment, and a single replacement filled the
 * comment while leaving the actual proxy line untouched.
 */
ok('the placeholder appears exactly once', source.split('PROXY_HERE').length - 1 === 1,
  `found ${source.split('PROXY_HERE').length - 1}`);
/** Committed with a placeholder so no one's proxy address lands in a public repo. */
const raw = vm.createContext({});
vm.runInContext(source, raw);
ok('unfilled template returns the placeholder, which a browser rejects',
  raw.FindProxyForURL('https://api.anthropic.com/', 'api.anthropic.com').includes('PROXY_HERE'));
ok('and no real address is committed', !/\b(?:\d{1,3}\.){3}\d{1,3}:\d+/.test(source.replace(/203\.0\.113\.\d+:\d+/g, '')),
  'found something that looks like a real IP:port in the committed file');

console.log(fails ? `\n  ${fails} FAILING` : '\n  all pac cases pass');
process.exit(fails ? 1 : 0);
