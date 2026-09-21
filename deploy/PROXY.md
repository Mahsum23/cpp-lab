# Reaching the model APIs from a blocked country

Google geo-blocks the Generative Language API in a number of countries. The block is on
the **network path**, not on your key — a perfectly good key fails, usually as a 403 or a
connection that never completes. Anthropic applies its own regional restrictions.

This app is a static site: it calls the provider straight from your browser, so there is
no server of ours in the middle to route around it. The fix is a relay you run yourself —
a small reverse proxy on a VPS in a region the provider serves, forwarding two exact
paths and nothing else.

---

## Before anything else: check the VPS can reach it

This is the whole plan's load-bearing assumption, and a VPS in the same blocked country
fails it. On the box:

```
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'x-goog-api-key: YOUR_KEY' \
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
```

- **200** — good, carry on.
- **403** with `User location is not supported` — this box is blocked too. A relay on it
  changes nothing; you need one somewhere else.
- **Hangs or connection refused** — the box cannot reach Google at all.

## You need a hostname, not a bare IP

The app is served over HTTPS, and a page on HTTPS cannot call `http://` — the browser
blocks it as mixed content before the request leaves. So the relay needs a certificate,
and a certificate needs a name.

Let's Encrypt does issue certificates for bare IP addresses now (generally available
since January 2026, on a six-day lifetime via the `shortlived` ACME profile), but Caddy's
support for that specific path still has open bugs, so it is not the road to take today.

The zero-effort option is wildcard DNS. These already resolve, with no signup:

```
62-60-149-143.sslip.io   ->  62.60.149.143
62-60-149-143.nip.io     ->  62.60.149.143
```

Use `sslip.io`. If Let's Encrypt rate-limits it, register a free name at
[duckdns.org](https://duckdns.org) and point it at the IP instead — same everything else.

## Set it up

```
git clone <this repo> && cd cpp-lab/deploy

RELAY_HOST=62-60-149-143.sslip.io \
APP_ORIGIN=https://YOURNAME.github.io \
sudo -E sh setup-relay.sh
```

`APP_ORIGIN` must be the **exact** origin the app is served from — scheme and host, no
path, no trailing slash. It is the only origin the relay will answer, which is what keeps
it from being a relay for the whole internet.

The script installs Caddy, generates a token, writes the config, and prints the URL to
paste into the app: **Settings → Mentor chat → "Reach the API through a relay"**. Saving
it there immediately asks the provider for its model list through the relay, which
exercises DNS, TLS, CORS, the token and the upstream hop in one round trip.

Re-running the script keeps the existing token, so the URL already on your phone
continues to work.

## Things that will bite

**Port 443 may already be taken.** Check before you start:

```
ss -tlnp | grep ':443'
```

AmneziaWG itself is UDP and will not conflict, but Amnezia's censorship-resistant modes
(XRay, Cloak, and similar) do listen on TCP 443 to look like ordinary HTTPS. If something
is there, either move it or serve the relay on another port — add `:8443` to the host
line in the Caddyfile and put the same port in the URL you paste into the app.

**Your API key travels through the box.** The relay forwards the `x-goog-api-key` and
`x-api-key` headers as they arrive; it does not store them and access logs are turned off
in the config, partly for this reason and partly because the token is in the URL path and
would otherwise be written to disk on every request. It is your server, but it is worth
knowing rather than discovering.

**The token is the entire access control.** Anyone with the URL can use the relay to
reach the providers. Losing it is not catastrophic — they would still need their own API
key, and the origin check blocks browser use from anywhere else — but rotate it by
deleting `/etc/caddy/relay.token` and re-running the script.

**The relay is per-device.** It lives beside the API keys, in the half of local storage
that deliberately never rides along in the gist sync — a relay URL in a synced payload
would be an open relay for anyone who found the gist. Paste it once per device.

## Checking it

`check-relay.sh` works out *which* layer is broken rather than that something is. It is
safe to run before `setup-relay.sh` — it checks the preconditions — and again after, when
it also exercises the relay. It needs no API key: an unauthenticated request still proves
whether the provider answered, which is the only thing being asked.

```
sh deploy/check-relay.sh

RELAY_HOST=62-60-149-143.sslip.io sudo -E sh deploy/check-relay.sh
```

It checks, in order, so the first failure is the one to fix:

1. **Outbound reach.** Whether this box can get an answer out of Gemini and Anthropic at
   all. A 403 saying `unregistered callers` is a pass — that is Google replying. A 403
   saying `User location is not supported` means the box is blocked too, and a relay here
   would only relay the block.
2. **Ports 80 and 443.** Caddy needs 443 to serve and 80 for the Let's Encrypt challenge.
   It names whatever is holding one.
3. **DNS.** That `RELAY_HOST` resolves to *this* box. If it points elsewhere, certificate
   issuance fails, because the challenge goes to the other address.
4. **The relay.** That a good token forwards and TLS works, that a wrong token gets a
   404, and that the CORS preflight returns an allow-origin header.

## Checking it by hand

```
# Should be 200, and prove the path rewriting works.
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'x-goog-api-key: YOUR_KEY' \
  'https://RELAY_HOST/TOKEN/gemini/v1beta/models?pageSize=1'

# Should be 404 — a wrong token is indistinguishable from nothing being there.
curl -sS -o /dev/null -w '%{http_code}\n' 'https://RELAY_HOST/wrong/gemini/v1beta/models'
```

If streaming replies arrive all at once instead of word by word, something in front of
Caddy is buffering — a CDN, or another proxy. The shipped config sets `flush_interval -1`
and was measured delivering chunks at their original spacing with compression negotiated,
so Caddy itself is not the cause.
