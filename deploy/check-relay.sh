#!/bin/sh
# Work out which layer is broken, rather than that something is.
#
# Run it on the VPS. Safe before setup-relay.sh (it checks the preconditions) and after
# (it also exercises the relay). Needs no API key: an unauthenticated request still
# proves whether the provider answered, which is the only thing being asked here.
#
#   sh check-relay.sh                          preconditions only
#   RELAY_HOST=... RELAY_TOKEN=... sh check-relay.sh    plus the relay itself
#
# RELAY_TOKEN is in /etc/caddy/relay.token after setup, and is read from there
# automatically when this runs as root.
set -u

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }
warn() { printf '  \033[33m??\033[0m    %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
FAILED=0

: "${RELAY_HOST:=}"
: "${RELAY_TOKEN:=}"
[ -z "$RELAY_TOKEN" ] && [ -r /etc/caddy/relay.token ] && RELAY_TOKEN=$(cat /etc/caddy/relay.token)

# --- 1. can this box reach the providers at all ----------------------------
# The decider. A relay in the same blocked country forwards a block.
head_ "1. Outbound reach (no API key needed)"

probe() {
  name=$1; url=$2; shift 2
  body=$(curl -sS -m 25 "$@" "$url" 2>&1)
  code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null)
  case "$body" in
    *"unregistered callers"*|*"x-api-key header is required"*|*"API key not valid"*)
      pass "$name answered ($code) — this box is not blocked" ;;
    *"location is not supported"*|*"User location"*)
      fail "$name geo-blocks this box" "A relay here relays the block. You need a VPS in another country." ;;
    *)
      if [ -z "$code" ] || [ "$code" = "000" ]; then
        fail "$name unreachable" "No HTTP response at all: $(printf '%s' "$body" | head -1)"
      else
        warn "$name answered $code, unrecognised body" "$(printf '%s' "$body" | head -c 160)"
      fi ;;
  esac
}
probe "Gemini"    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"
probe "Anthropic" "https://api.anthropic.com/v1/messages" -X POST -H 'content-type: application/json' -d '{}'

# --- 2. ports --------------------------------------------------------------
# Caddy needs 443 to serve and 80 for the Let's Encrypt HTTP challenge.
head_ "2. Ports 80 and 443"
# Two ways to look, because a check that cannot measure must not report "free".
# `ss` is the good one; where it is missing, ask whether anything answers a connection.
if command -v ss >/dev/null 2>&1; then
  LOOK=ss
elif command -v netstat >/dev/null 2>&1; then
  LOOK=netstat
else
  LOOK=connect
fi

for p in 80 443; do
  holder=''
  case "$LOOK" in
    ss)      holder=$(ss -tlnp 2>/dev/null      | awk -v m=":$p\$" '$4 ~ m {print $NF; exit}') ;;
    netstat) holder=$(netstat -tlnp 2>/dev/null | awk -v m=":$p\$" '$4 ~ m {print $NF; exit}') ;;
    connect)
      if curl -sS -m 3 -o /dev/null "http://127.0.0.1:$p" 2>/dev/null; then
        holder='something (detected by connecting; install iproute2 to see what)'
      fi ;;
  esac

  if [ -n "$holder" ]; then
    if printf '%s' "$holder" | grep -q caddy; then
      pass "$p is caddy's"
    else
      fail "$p is taken by something else" "$holder — AmneziaWG is UDP and will not conflict, but its XRay/Cloak modes sit on TCP 443. Move it, or serve the relay on another port."
    fi
  elif [ "$LOOK" = connect ]; then
    warn "$p: nothing answered, but neither ss nor netstat is installed" "Cannot tell 'free' from 'firewalled'. apt install iproute2 for a real answer."
  else
    pass "$p is free"
  fi
done

# --- 3. dns ----------------------------------------------------------------
head_ "3. DNS"
if [ -z "$RELAY_HOST" ]; then
  warn "RELAY_HOST not set, skipping" "Re-run with RELAY_HOST=... to check it."
else
  # Several sources: any one of them can be unreachable, and being unable to learn
  # our own address must not look like a DNS failure.
  mine=''
  for svc in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    mine=$(curl -sS -m 8 "$svc" 2>/dev/null | tr -d '[:space:]')
    case "$mine" in [0-9]*.[0-9]*.[0-9]*.[0-9]*) break ;; *) mine='' ;; esac
  done
  theirs=$(getent hosts "$RELAY_HOST" 2>/dev/null | awk '{print $1; exit}')
  if [ -z "$theirs" ]; then
    fail "$RELAY_HOST does not resolve"
  elif [ -z "$mine" ]; then
    warn "$RELAY_HOST -> $theirs" "Could not learn this box's public IP to compare."
  elif [ "$mine" = "$theirs" ]; then
    pass "$RELAY_HOST -> $theirs, which is this box"
  else
    fail "$RELAY_HOST -> $theirs, but this box is $mine" "Certificate issuance will fail: the challenge goes to the other address."
  fi
fi

# --- 4. the relay itself ---------------------------------------------------
head_ "4. The relay"
if ! command -v caddy >/dev/null 2>&1; then
  warn "caddy not installed yet" "Run setup-relay.sh, then run this again."
elif ! systemctl is-active --quiet caddy 2>/dev/null && ! pgrep -x caddy >/dev/null 2>&1; then
  fail "caddy is installed but not running" "journalctl -u caddy -n 40 --no-pager"
elif [ -z "$RELAY_HOST" ] || [ -z "$RELAY_TOKEN" ]; then
  warn "no RELAY_HOST/RELAY_TOKEN, skipping" "Run as root, or pass them, to exercise the relay."
else
  base="https://$RELAY_HOST/$RELAY_TOKEN"

  code=$(curl -sS -m 30 -o /tmp/relay.out -w '%{http_code}' "$base/gemini/v1beta/models?pageSize=1" 2>/dev/null)
  if [ "$code" = "403" ] && grep -q "unregistered callers" /tmp/relay.out 2>/dev/null; then
    pass "forwards to Gemini, and TLS works (403 is the keyless answer, from Google)"
  elif [ "$code" = "404" ]; then
    fail "the relay 404s its own token" "Token mismatch: compare /etc/caddy/relay.token with what you passed."
  elif [ "$code" = "000" ] || [ -z "$code" ]; then
    fail "cannot connect over HTTPS" "Certificate not issued yet, or 443 unreachable from outside. journalctl -u caddy -n 40 --no-pager"
  else
    warn "relay answered $code" "$(head -c 160 /tmp/relay.out 2>/dev/null)"
  fi

  code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "https://$RELAY_HOST/definitely-wrong/gemini/v1beta/models" 2>/dev/null)
  [ "$code" = "404" ] && pass "a wrong token gets 404" || fail "a wrong token got $code, expected 404"

  origin=$(curl -sS -m 20 -D - -o /dev/null -X OPTIONS "$base/gemini/v1beta/models" \
    -H "Origin: ${APP_ORIGIN:-https://example.github.io}" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: x-goog-api-key' 2>/dev/null \
    | grep -i '^access-control-allow-origin:' | tr -d '\r' | awk '{print $2}')
  if [ -n "$origin" ]; then
    pass "CORS preflight answers (allow-origin: $origin)"
    printf '        \033[2mmust equal the origin your app is served from, exactly\033[0m\n'
  else
    fail "CORS preflight returned no allow-origin" "The browser will refuse before the request is made."
  fi
fi

head_ "Result"
if [ "$FAILED" -eq 0 ]; then
  printf '  Nothing failed. If the app still cannot reach the mentor, the next\n'
  printf '  suspect is APP_ORIGIN not matching where the app is served from.\n\n'
else
  printf '  %s check(s) failed — fix the first one; the later ones depend on it.\n\n' "$FAILED"
fi
exit 0
