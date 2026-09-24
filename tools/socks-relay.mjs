#!/usr/bin/env node
/**
 * socks-relay — reach the model APIs through a SOCKS5 proxy that needs a login, from
 * any browser, by running this on your own machine.
 *
 * Why this exists. A web page cannot speak SOCKS5: page JavaScript has no raw TCP
 * sockets, and fetch() has no proxy option. Browsers can apply a SOCKS proxy beneath
 * the page, but Chrome cannot log in to one at all, and a PAC file cannot carry
 * credentials. So the login has to happen somewhere that is not the page.
 *
 * This is that somewhere. It listens on 127.0.0.1, takes the same two paths as the
 * server relay in deploy/ (`/gemini/...` and `/anthropic/...`), and forwards each
 * request to the real API through the SOCKS5 proxy, doing the username/password
 * handshake itself. In the app: Settings → Mentor chat → relay → http://127.0.0.1:8787
 *
 * The TLS connection to the API is opened *through* the SOCKS tunnel, so the proxy sees
 * only which host you connect to; your API key stays encrypted until it reaches Google
 * or Anthropic. The proxy password never enters the browser, the repo or the gist sync —
 * it lives in one file in your home directory.
 *
 *   node tools/socks-relay.mjs            run it (writes a config template on first run)
 *   node tools/socks-relay.mjs --check    one request to Gemini through the proxy, and exit
 *
 * Zero dependencies. Runs anywhere Node does, Windows included.
 */
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const UPSTREAMS = {
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 },
  anthropic: { host: 'api.anthropic.com', port: 443 },
};

/** Request headers worth sending on. Everything else — cookies, the browser's own
 *  fingerprint — stays behind. accept-encoding is dropped on purpose: an identity
 *  response streams byte-for-byte, and bandwidth on localhost is free. */
const FORWARD_UP = new Set([
  'content-type', 'accept', 'x-goog-api-key', 'x-api-key', 'anthropic-version',
  'anthropic-beta', 'anthropic-dangerous-direct-browser-access',
]);
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'set-cookie',
]);

// --- SOCKS5 (RFC 1928) with username/password auth (RFC 1929) ----------------

const SOCKS_REPLIES = {
  1: 'general failure', 2: 'connection not allowed by the proxy', 3: 'network unreachable',
  4: 'host unreachable', 5: 'connection refused', 6: 'TTL expired',
  7: 'command not supported', 8: 'address type not supported',
};

/** Reads exact byte counts from a socket, keeping anything past them for later. */
function byteReader(sock) {
  let buf = Buffer.alloc(0);
  let waiting = null;
  const pump = () => {
    if (waiting && buf.length >= waiting.n) {
      const out = buf.subarray(0, waiting.n);
      buf = buf.subarray(waiting.n);
      const w = waiting;
      waiting = null;
      w.resolve(out);
    }
  };
  const onData = (d) => { buf = Buffer.concat([buf, d]); pump(); };
  const onEnd = () => { if (waiting) { waiting.reject(new Error('the proxy closed the connection mid-handshake')); waiting = null; } };
  sock.on('data', onData);
  sock.on('end', onEnd);
  sock.on('error', (e) => { if (waiting) { waiting.reject(e); waiting = null; } });
  return {
    read: (n) => new Promise((resolve, reject) => { waiting = { n, resolve, reject }; pump(); }),
    /** Stop listening and hand back any bytes that arrived past the handshake. */
    release: () => { sock.off('data', onData); sock.off('end', onEnd); return buf; },
  };
}

export class SocksError extends Error {}

/**
 * Open a TCP tunnel to host:port through a SOCKS5 proxy.
 *
 * The target is sent as a *domain name* (address type 3), never resolved here, so DNS
 * happens at the proxy. That matters where DNS itself is interfered with, and it means
 * the request looks, to anything watching locally, like a connection to the proxy.
 */
export function socksConnect(proxy, host, port, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.port, proxy.host);
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.setTimeout(timeoutMs, () => fail(new SocksError(`no answer from the proxy at ${proxy.host}:${proxy.port} within ${timeoutMs / 1000}s`)));
    sock.once('error', (e) => fail(new SocksError(`cannot reach the proxy at ${proxy.host}:${proxy.port}: ${e.message}`)));

    sock.once('connect', async () => {
      const r = byteReader(sock);
      try {
        const auth = proxy.user != null;
        sock.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]));
        const [ver, method] = await r.read(2);
        if (ver !== 5) throw new SocksError('that is not a SOCKS5 proxy');
        if (method === 0xff) {
          throw new SocksError(auth
            ? 'the proxy refused every login method offered'
            : 'the proxy wants a username and password — set SOCKS_USER and SOCKS_PASS');
        }
        if (method === 2) {
          if (!auth) throw new SocksError('the proxy wants a username and password — set SOCKS_USER and SOCKS_PASS');
          const u = Buffer.from(proxy.user);
          const p = Buffer.from(proxy.pass ?? '');
          if (u.length > 255 || p.length > 255) throw new SocksError('SOCKS5 usernames and passwords are limited to 255 bytes');
          sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
          const [, status] = await r.read(2);
          if (status !== 0) throw new SocksError('the proxy rejected the username/password');
        }

        const h = Buffer.from(host);
        sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 0xff])]));
        const [, rep, , atyp] = await r.read(4);
        if (rep !== 0) throw new SocksError(`the proxy could not reach ${host}: ${SOCKS_REPLIES[rep] ?? `code ${rep}`}`);
        const addrLen = atyp === 1 ? 4 : atyp === 4 ? 16 : (await r.read(1))[0];
        await r.read(addrLen + 2);

        const leftover = r.release();
        sock.setTimeout(0);
        if (leftover.length) sock.unshift(leftover);
        resolve(sock);
      } catch (e) {
        fail(e instanceof SocksError ? e : new SocksError(e.message));
      }
    });
  });
}

// --- the relay --------------------------------------------------------------

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': [...FORWARD_UP].join(', '),
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/**
 * Build the relay server. The CLI below is a thin wrapper; the tests drive this
 * directly, which is also the only way to switch TLS off (for a plain-HTTP mock
 * upstream). Nothing reachable from the command line or the environment can do that.
 */
export function createRelay({ proxy, origins, upstreams = UPSTREAMS, tlsUpstream = true, log = () => {} }) {
  const allowed = new Set(origins);

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    // A browser always sends Origin on a cross-origin request and a page cannot forge
    // it. So a request from any other site open in this browser is refused here, before
    // it can spend your proxy — CORS alone would only stop it *reading* the reply.
    // No Origin at all means curl or a script on this machine, which already has access
    // to the config file, so there is nothing to protect by refusing it.
    if (origin && !allowed.has(origin)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end(`origin ${origin} is not allowed — add it to ORIGIN in the config\n`);
      log(`refused origin ${origin}`);
      return;
    }

    if (req.method === 'OPTIONS') {
      const h = origin ? corsHeaders(origin) : {};
      // Older Chrome sent a Private Network Access preflight for public -> localhost.
      if (req.headers['access-control-request-private-network']) h['access-control-allow-private-network'] = 'true';
      res.writeHead(204, h);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://relay.local');
    const [, service, ...rest] = url.pathname.split('/');
    const up = upstreams[service];
    if (!up) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found — this relay serves /gemini/... and /anthropic/...\n');
      return;
    }

    const path = `/${rest.join('/')}${url.search}`;
    const headers = { host: up.host };
    for (const [k, v] of Object.entries(req.headers)) if (FORWARD_UP.has(k)) headers[k] = v;

    let upstreamReq;
    try {
      const raw = await socksConnect(proxy, up.host, up.port);
      const sock = tlsUpstream
        ? await new Promise((resolve, reject) => {
            const t = tls.connect({ socket: raw, servername: up.host, ALPNProtocols: ['http/1.1'] });
            t.once('secureConnect', () => resolve(t));
            t.once('error', reject);
          })
        : raw;

      upstreamReq = http.request({ method: req.method, path, headers, createConnection: () => sock });
      upstreamReq.on('response', (upRes) => {
        const out = origin ? corsHeaders(origin) : {};
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (!HOP_BY_HOP.has(k) && !k.startsWith('access-control-')) out[k] = v;
        }
        res.writeHead(upRes.statusCode ?? 502, out);
        // Piped, never collected: a streamed reply has to reach the page as it arrives,
        // or the mentor sits silent and then dumps the whole answer at once.
        upRes.pipe(res);
        log(`${req.method} ${service}${path.split('?')[0]} -> ${upRes.statusCode}`);
      });
      upstreamReq.on('error', (e) => {
        if (!res.headersSent) {
          res.writeHead(502, { ...(origin ? corsHeaders(origin) : {}), 'content-type': 'text/plain' });
          res.end(`upstream error: ${e.message}\n`);
        } else res.destroy();
      });
      // Stopping a reply in the app aborts the fetch; pass that on so the model stops
      // generating instead of streaming into a closed socket.
      res.on('close', () => { if (!res.writableFinished) upstreamReq.destroy(); });
      req.pipe(upstreamReq);
    } catch (e) {
      const msg = e instanceof SocksError ? `proxy: ${e.message}` : `relay: ${e.message}`;
      log(msg);
      res.writeHead(502, { ...(origin ? corsHeaders(origin) : {}), 'content-type': 'text/plain' });
      res.end(`${msg}\n`);
    }
  });
}

// --- configuration ----------------------------------------------------------

export const CONFIG_PATH = join(os.homedir(), '.config', 'cpp-lab', 'socks-relay.env');

const TEMPLATE = `# socks-relay configuration. Lives here, in your home directory, and nowhere else:
# not in the repo, not in the browser, not in the app's sync.

# The SOCKS5 proxy, as host:port.
SOCKS=host:port

# Its login. Written as-is — no URL-encoding needed, whatever characters it contains.
# Delete both lines if the proxy needs no login.
SOCKS_USER=
SOCKS_PASS=

# Where the app is served from, exactly: scheme and host, no path, no trailing slash.
# Requests from any other site open in your browser are refused. Comma-separate several.
ORIGIN=https://your-name.github.io

# Where this listens. Put http://127.0.0.1:PORT into the app's relay setting.
PORT=8787
`;

export function parseConfig(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

function loadConfig() {
  const file = existsSync(CONFIG_PATH) ? parseConfig(readFileSync(CONFIG_PATH, 'utf8')) : null;
  const env = process.env;
  const pick = (k) => env[`CPP_LAB_${k}`] ?? file?.[k] ?? '';
  return { fromFile: Boolean(file), SOCKS: pick('SOCKS'), SOCKS_USER: pick('SOCKS_USER'), SOCKS_PASS: pick('SOCKS_PASS'), ORIGIN: pick('ORIGIN'), PORT: pick('PORT') || '8787' };
}

function parseProxy(spec, user, pass) {
  const m = /^(?:socks5h?:\/\/)?([^:/\s]+):(\d+)\/?$/.exec(spec.trim());
  if (!m || spec.includes('host:port')) return null;
  return { host: m[1], port: Number(m[2]), user: user ? user : null, pass: user ? pass : null };
}

/** How the proxy is shown in logs: never with the password. */
const describe = (p) => `${p.user ? `${p.user}:***@` : ''}${p.host}:${p.port}`;

// --- CLI --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const cfg = loadConfig();

  if (!cfg.fromFile && !cfg.SOCKS) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, TEMPLATE);
    try { chmodSync(CONFIG_PATH, 0o600); } catch { /* not meaningful on Windows */ }
    console.log(`\n  Wrote a config template to\n\n    ${CONFIG_PATH}\n\n  Fill in the proxy, its login and ORIGIN, then run this again.\n`);
    process.exit(1);
  }

  const proxy = parseProxy(cfg.SOCKS, cfg.SOCKS_USER, cfg.SOCKS_PASS);
  if (!proxy) {
    console.error(`\n  SOCKS is not set to host:port in ${CONFIG_PATH}\n`);
    process.exit(1);
  }

  if (args.includes('--check')) {
    // The same keyless probe as the curl test: Google answering 403 "unregistered
    // callers" proves the whole path — proxy login, tunnel, TLS — without an API key.
    process.stdout.write(`\n  Gemini through ${describe(proxy)} ... `);
    try {
      const raw = await socksConnect(proxy, UPSTREAMS.gemini.host, 443);
      const sock = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: raw, servername: UPSTREAMS.gemini.host, ALPNProtocols: ['http/1.1'] });
        t.once('secureConnect', () => resolve(t));
        t.once('error', reject);
      });
      const body = await new Promise((resolve, reject) => {
        const r = http.request({ path: '/v1beta/models?pageSize=1', headers: { host: UPSTREAMS.gemini.host }, createConnection: () => sock }, (res) => {
          let b = '';
          res.on('data', (d) => (b += d));
          res.on('end', () => resolve({ status: res.statusCode, text: b }));
        });
        r.on('error', reject);
        r.end();
      });
      if (/unregistered callers/.test(body.text)) console.log('works.\n\n  Google answered, which proves the login, the tunnel and TLS.\n');
      else if (/location is not supported/i.test(body.text)) console.log('reached Google, but the proxy is in a blocked location.\n');
      else console.log(`answered ${body.status}: ${body.text.slice(0, 160)}\n`);
      process.exit(0);
    } catch (e) {
      console.log(`failed.\n\n  ${e.message}\n`);
      process.exit(1);
    }
  }

  const origins = cfg.ORIGIN.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!origins.length || origins.some((o) => o.includes('your-name'))) {
    console.error(`\n  ORIGIN is not set in ${CONFIG_PATH} — it must be where the app is served from.\n`);
    process.exit(1);
  }

  const port = Number(cfg.PORT);
  const server = createRelay({ proxy, origins, log: (m) => console.log(`  ${new Date().toTimeString().slice(0, 8)}  ${m}`) });
  server.on('error', (e) => {
    console.error(`\n  cannot listen on 127.0.0.1:${port}: ${e.message}\n`);
    process.exit(1);
  });
  // Loopback only. Nothing on your network — let alone the internet — can reach it.
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  socks-relay on http://127.0.0.1:${port}`);
    console.log(`  via ${describe(proxy)}, for ${origins.join(', ')}`);
    console.log(`\n  In the app: Settings → Mentor chat → relay → http://127.0.0.1:${port}\n`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
