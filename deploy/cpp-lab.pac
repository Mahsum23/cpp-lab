// Route the two model APIs through a SOCKS5 proxy, and nothing else.
//
// A proxy auto-config file: the browser calls FindProxyForURL for every request and
// does whatever it returns. This one sends exactly two hostnames through the proxy and
// everything else — including the app itself on GitHub Pages — out the normal way.
//
// Why a browser-level proxy rather than something in the app: JavaScript's fetch() has
// no proxy option at all. A proxy has to be applied beneath the page — by the OS, the
// browser, or a server in the middle — and this is the one that needs no server.
//
// SOCKS5 carries the TLS connection through untouched, so the proxy sees only which
// host you are talking to, never the request — your API key stays inside the
// encryption end to end.
//
// Make a local copy with your proxy's host:port filled in below. Do not commit that
// copy. The placeholder appears exactly once in this file, on the next line, so any
// way of filling it in — sed, an editor, a script — fills the right thing. See
// deploy/BROWSER-PROXY.md for the one-line command.

var PROXY = "SOCKS5 PROXY_HERE";

// Exact hostnames only. A suffix match like dnsDomainIs(host, "googleapis.com") would
// also send every other Google API through the proxy, and a careless one would match
// a lookalike such as "evilgoogleapis.com".
var ROUTED = {
  "generativelanguage.googleapis.com": true,
  "api.anthropic.com": true
};

function FindProxyForURL(url, host) {
  // No DIRECT fallback on purpose. If the proxy is down, falling back would send the
  // request from a blocked location and surface as Google's own location error — which
  // points you at your key or your model instead of at the proxy. Failing as a network
  // error keeps the cause visible.
  if (ROUTED[host.toLowerCase()]) return PROXY;
  return "DIRECT";
}
