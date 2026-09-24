# Reaching the model APIs through a SOCKS5 proxy in your browser

For when you have a SOCKS5 proxy but no server of your own to run a relay on.

JavaScript's `fetch()` has no proxy option, so the app cannot use a proxy itself. The
proxy has to be applied beneath the page — and the browser can do that for exactly two
hostnames, leaving everything else alone. No server, no change to the app: its requests
simply leave through the proxy.

It is also the more private option. SOCKS5 carries the TLS connection through untouched,
so the proxy sees only which host you connect to. Your API key stays inside the
encryption end to end — a relay, by contrast, has to decrypt the request to forward it.

## First: does the proxy reach Google?

From any machine that can reach the proxy:

```
curl -sS --socks5-hostname HOST:PORT -o /dev/null -w '%{http_code}\n' \
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
```

- **403** — it works. That is Google refusing a request that carries no key, which
  proves the request arrived. The app supplies the key.
- **400** with `User location is not supported` — the proxy is itself in a blocked
  location. It cannot help.
- **A timeout, or a SOCKS error** — the proxy is unreachable from where you are, or it
  needs a username and password (add `--proxy-user USER:PASS` to check).

If it needs a login, skip to FoxyProxy below — a PAC file cannot carry credentials.

## Without a login: Firefox and the PAC file

`deploy/cpp-lab.pac` routes `generativelanguage.googleapis.com` and `api.anthropic.com`
through the proxy by exact hostname, and everything else directly. Make a local copy with
your proxy filled in — and keep it out of the repo:

```
sed 's/PROXY_HERE/HOST:PORT/' deploy/cpp-lab.pac > ~/cpp-lab.pac
```

Then in Firefox: **Settings → General → Network Settings → Settings…** → choose
**Automatic proxy configuration URL** and enter the file's full path as a URL:

```
file:///home/you/cpp-lab.pac
```

Press **Reload**, then **OK**.

## With a login, or in Chrome: FoxyProxy

Firefox's own settings take a SOCKS host and port but not credentials. Chrome does not
support SOCKS5 authentication at all — not natively and not through extensions — so a
proxy that needs a login is Firefox-only.

Install **FoxyProxy Standard**, add a proxy of type **SOCKS5** with the host, port and (if
needed) username and password, and give it exactly two patterns:

```
*://generativelanguage.googleapis.com/*
*://api.anthropic.com/*
```

Then set FoxyProxy to **Proxy by Patterns**. Anything matching neither pattern goes
direct, the same as the PAC file.

A note on Chrome and PAC files: Chrome has an open issue to drop support for loading a
PAC file from `file://`, so the PAC route is not recommended there even without a login.

## Checking it worked

Open the app, go to **Settings → Mentor chat** and re-save your key. That asks the
provider for its model list, which is the cheapest possible round trip. A list of models
means the proxy is in the path and working.

If instead the app says Google is refusing requests from your location, the proxy is not
being applied: the PAC file did not load, or FoxyProxy is not in pattern mode. Leave the
**relay** field in Settings empty — it is for the other approach (see PROXY.md), and
setting both would send requests to a relay that is not there.

## Why exact hostnames, and no fallback

The PAC file matches the two API hosts exactly rather than by suffix. A suffix match on
`googleapis.com` would route every other Google API through the proxy too, and a careless
one would match lookalikes such as `evilgoogleapis.com`.

It also has no `DIRECT` fallback. If the proxy is down, falling back would send the
request from a blocked location, and the error would be Google's location refusal —
which reads like a problem with your key or your model. Failing as a plain network error
keeps the real cause visible.
