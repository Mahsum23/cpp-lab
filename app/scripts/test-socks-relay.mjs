/**
 * test-socks-relay.mjs — the local relay that logs in to a SOCKS5 proxy on the app's
 * behalf. Everything here runs on loopback: an authenticating SOCKS5 server and a mock
 * API both live inside this file, so the test needs no network and no Go.
 *
 * What must hold: the login happens and a wrong one is reported as a wrong login; DNS is
 * left to the proxy; streams arrive as they are produced; other sites cannot use it; and
 * the password never reaches a log.
 *
 * Run: npm test
 */
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

const { createRelay, socksConnect, parseConfig } = await import(new URL('../../tools/socks-relay.mjs', import.meta.url));

let fails = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fails++; console.log(`  FAIL  ${label}${extra ? `\n        ${extra}` : ''}`); }
  else console.log(`  PASS  ${label}`);
};

// --- an authenticating SOCKS5 server ---------------------------------------
const USER = 'lab', PASS = 'p@ss:w/rd';   // characters a URL would need escaped
const connects = [];
const socks = net.createServer((c) => {
  c.once('data', (greet) => {
    const methods = [...greet.subarray(2)];
    if (!methods.includes(2)) { c.end(Buffer.from([5, 0xff])); return; }   // login required
    c.write(Buffer.from([5, 2]));
    c.once('data', (a) => {
      const ul = a[1], u = a.subarray(2, 2 + ul).toString();
      const pl = a[2 + ul], p = a.subarray(3 + ul, 3 + ul + pl).toString();
      if (u !== USER || p !== PASS) { c.end(Buffer.from([1, 1])); return; }
      c.write(Buffer.from([1, 0]));
      c.once('data', (req) => {
        const atyp = req[3];
        const host = atyp === 3 ? req.subarray(5, 5 + req[4]).toString() : '(an address)';
        const port = req.readUInt16BE(req.length - 2);
        connects.push({ atyp, host, port });
        const up = net.connect(port, '127.0.0.1', () => {
          c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, port >> 8, port & 0xff]));
          c.pipe(up); up.pipe(c);
        });
        up.on('error', () => c.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
      });
    });
  });
});
socks.listen(0, '127.0.0.1'); await once(socks, 'listening');
const socksPort = socks.address().port;

// --- a mock API -------------------------------------------------------------
let lastUp = null, upstreamClosed = false;
const api = http.createServer((req, res) => {
  lastUp = { url: req.url, headers: req.headers };
  if (req.url.includes(':stream')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
    let i = 0;
    const t = setInterval(() => {
      if (i === 3) { clearInterval(t); res.end(); return; }
      res.write(`data: chunk${i++}\n\n`);
    }, 200);
    req.on('close', () => { clearInterval(t); upstreamClosed = true; });
    return;
  }
  if (req.url.includes(':forever')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
    res.on('close', () => { upstreamClosed = true; });
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'leak=1' });
  res.end(JSON.stringify({ ok: true }));
});
api.listen(0, '127.0.0.1'); await once(api, 'listening');
const apiPort = api.address().port;

const APP = 'https://app.example';
const logs = [];
const upstreams = {
  gemini: { host: 'generativelanguage.googleapis.com', port: apiPort },
  anthropic: { host: 'api.anthropic.com', port: apiPort },
};
const start = (proxy) => {
  const s = createRelay({ proxy, origins: [APP], upstreams, tlsUpstream: false, log: (m) => logs.push(m) });
  s.listen(0, '127.0.0.1');
  return s;
};

const good = start({ host: '127.0.0.1', port: socksPort, user: USER, pass: PASS });
await once(good, 'listening');
const base = `http://127.0.0.1:${good.address().port}`;

console.log('\n— the login, and where DNS happens —');
let r = await fetch(`${base}/gemini/v1beta/models?pageSize=1`, { headers: { origin: APP, 'x-goog-api-key': 'KEY' } });
ok('a request goes through with the right login', r.status === 200, String(r.status));
ok('the path arrives with its prefix stripped and its query intact', lastUp?.url === '/v1beta/models?pageSize=1', lastUp?.url);
ok('the API key header is forwarded', lastUp?.headers['x-goog-api-key'] === 'KEY');
ok('the upstream sees the real API hostname', lastUp?.headers.host === 'generativelanguage.googleapis.com', lastUp?.headers.host);
ok('the proxy was asked for a domain name, not an address — DNS is its job',
  connects.at(-1)?.atyp === 3 && connects.at(-1)?.host === 'generativelanguage.googleapis.com', JSON.stringify(connects.at(-1)));
ok('a password full of URL-special characters works as written', r.status === 200);

const bad = start({ host: '127.0.0.1', port: socksPort, user: USER, pass: 'wrong' });
await once(bad, 'listening');
r = await fetch(`http://127.0.0.1:${bad.address().port}/gemini/v1beta/models`, { headers: { origin: APP } });
let t = await r.text();
ok('a wrong password is a 502', r.status === 502, String(r.status));
ok('and says it was the login, not something vaguer', /username\/password/.test(t), t);
ok('and still carries CORS, so the app can read why', r.headers.get('access-control-allow-origin') === APP);

const anon = start({ host: '127.0.0.1', port: socksPort, user: null, pass: null });
await once(anon, 'listening');
r = await fetch(`http://127.0.0.1:${anon.address().port}/gemini/v1beta/models`, { headers: { origin: APP } });
t = await r.text();
ok('no login configured, proxy wants one: says to set it', /SOCKS_USER/.test(t), t);

const dead = start({ host: '127.0.0.1', port: 1, user: USER, pass: PASS });
await once(dead, 'listening');
r = await fetch(`http://127.0.0.1:${dead.address().port}/gemini/v1beta/models`, { headers: { origin: APP } });
t = await r.text();
ok('an unreachable proxy is named as the problem', /cannot reach the proxy/.test(t), t);

console.log('\n— streaming —');
const started = Date.now();
r = await fetch(`${base}/gemini/v1beta/models/x:streamGenerateContent?alt=sse`, { headers: { origin: APP } });
const stamps = [];
const reader = r.body.getReader();
const dec = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const m of dec.decode(value).matchAll(/chunk\d/g)) stamps.push([m[0], Date.now() - started]);
}
ok('all three chunks arrive', stamps.length === 3, JSON.stringify(stamps));
ok('spread out as produced, not delivered together at the end',
  stamps.length === 3 && stamps[2][1] - stamps[0][1] >= 300, JSON.stringify(stamps));

console.log('\n— stopping a reply stops the upstream —');
upstreamClosed = false;
const ac = new AbortController();
r = await fetch(`${base}/gemini/v1beta/models/x:forever`, { headers: { origin: APP }, signal: ac.signal });
await r.body.getReader().read();
ac.abort();
await new Promise((res) => setTimeout(res, 300));
ok('aborting in the app closes the upstream connection', upstreamClosed === true);

console.log('\n— other sites cannot use it —');
r = await fetch(`${base}/gemini/v1beta/models`, { headers: { origin: 'https://evil.example' } });
ok('a request from another origin is refused outright', r.status === 403, String(r.status));
ok('before it reaches the proxy', !connects.some((c) => c.host === 'evil'));
r = await fetch(`${base}/gemini/v1beta/models`);
ok('no Origin at all (curl, a local script) is allowed', r.status === 200, String(r.status));

r = await fetch(`${base}/gemini/v1beta/models`, {
  method: 'OPTIONS',
  headers: { origin: APP, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-goog-api-key', 'access-control-request-private-network': 'true' },
});
ok('preflight answers 204', r.status === 204, String(r.status));
ok('allowing the key header', (r.headers.get('access-control-allow-headers') ?? '').includes('x-goog-api-key'));
ok('and the private-network preflight', r.headers.get('access-control-allow-private-network') === 'true');

r = await fetch(`${base}/gemini/v1beta/models`, { headers: { origin: APP } });
ok('upstream cookies are not passed to the page', r.headers.get('set-cookie') === null);
ok('upstream CORS is replaced by ours, not duplicated', r.headers.get('access-control-allow-origin') === APP);

r = await fetch(`${base}/elsewhere/x`, { headers: { origin: APP } });
ok('an unknown service is a 404', r.status === 404);

console.log('\n— the password stays out of the logs —');
ok('no log line contains it', !logs.some((l) => l.includes(PASS) || l.includes('wrong')), logs.join(' | '));

console.log('\n— config parsing —');
const cfg = parseConfig('# comment\nSOCKS=1.2.3.4:8000\nSOCKS_PASS= a=b#c \n  # SOCKS_USER=ignored\n');
ok('reads KEY=VALUE', cfg.SOCKS === '1.2.3.4:8000');
ok('keeps = and # inside a value', cfg.SOCKS_PASS === 'a=b#c', JSON.stringify(cfg.SOCKS_PASS));
ok('ignores commented lines', !('SOCKS_USER' in cfg));

for (const s of [good, bad, anon, dead, socks, api]) s.close();
console.log(fails ? `\n  ${fails} FAILING` : '\n  all socks-relay cases pass');
process.exit(fails ? 1 : 0);
