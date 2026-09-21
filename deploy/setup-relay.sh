#!/bin/sh
# Stand up the model-API relay on a fresh Debian/Ubuntu box. Idempotent: safe to re-run.
#
#   RELAY_HOST=lab.example.duckdns.org \
#   APP_ORIGIN=https://you.github.io \
#   sh setup-relay.sh
#
# Prints the URL to paste into Settings → Mentor chat → "Reach the API through a relay".
set -eu

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo sh $0)"; exit 1; }
: "${RELAY_HOST:?set RELAY_HOST to the hostname this box answers on}"
: "${APP_ORIGIN:?set APP_ORIGIN to the exact origin the app is served from}"

# Reuse the existing token on a re-run, so the URL already in your phone keeps working.
TOKEN_FILE=/etc/caddy/relay.token
if [ -f "$TOKEN_FILE" ]; then
	RELAY_TOKEN=$(cat "$TOKEN_FILE")
	echo "reusing the existing token"
else
	RELAY_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
fi

if ! command -v caddy >/dev/null 2>&1; then
	echo "installing caddy..."
	apt-get update -qq
	apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		| tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
	apt-get update -qq
	apt-get install -y -qq caddy
fi

mkdir -p /etc/caddy
printf '%s' "$RELAY_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

# Caddy reads these from its environment; systemd is where it gets one.
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/relay.conf <<EOF
[Service]
Environment=RELAY_HOST=${RELAY_HOST}
Environment=RELAY_TOKEN=${RELAY_TOKEN}
Environment=APP_ORIGIN=${APP_ORIGIN}
EOF

cp "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
	--envfile /dev/null >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
systemctl is-active --quiet caddy || { echo "caddy failed to start:"; journalctl -u caddy -n 30 --no-pager; exit 1; }

cat <<EOF

  Relay is up.

  Paste this into the app, Settings -> Mentor chat -> "Reach the API through a relay":

      https://${RELAY_HOST}/${RELAY_TOKEN}

  Check it from here first:
      curl -sS -o /dev/null -w '%{http_code}\\n' \\
        -H "x-goog-api-key: YOUR_KEY" \\
        "https://${RELAY_HOST}/${RELAY_TOKEN}/gemini/v1beta/models?pageSize=1"

  200 means the whole path works. 403 from Google means this box is geo-blocked too.

EOF
