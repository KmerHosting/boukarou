#!/usr/bin/env bash
# Boukarou installer — free, self-hosted LXC panel.
#
#   curl -fsSL https://raw.githubusercontent.com/KmerHosting/boukarou/main/deploy/install.sh | sudo bash
#
# Options (environment variables):
#   BOUKAROU_PORT=1974            panel port
#   BOUKAROU_DOMAIN=panel.example.com   serve the panel on a domain with HTTPS (needs DNS first)
#   BOUKAROU_EMAIL=you@example.com      Let's Encrypt contact (optional)
#   BOUKAROU_NO_DOMAINS=1         skip nginx/certbot (disables custom domains for containers)
#   BOUKAROU_POOL_SIZE=100GB      size of the btrfs storage pool created for a fresh LXD
#   BOUKAROU_BRANCH=main
set -Eeuo pipefail

REPO="${BOUKAROU_REPO:-https://github.com/KmerHosting/boukarou.git}"
BRANCH="${BOUKAROU_BRANCH:-main}"
PORT="${BOUKAROU_PORT:-1974}"
APP=/opt/boukarou
CONF=/etc/boukarou
DATA=/var/lib/boukarou
ENV_FILE="$CONF/boukarou.env"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "Installation failed on line $LINENO. Fix the problem above and run the installer again; it is safe to re-run."' ERR

[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run the installer as root (sudo)."
[[ -r /etc/os-release ]] || die "Cannot identify the operating system."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "Boukarou supports Ubuntu 22.04, 24.04 and 26.04."
dpkg --compare-versions "${VERSION_ID:-0}" ge 22.04 || die "Ubuntu 22.04 or newer is required."
[[ "$(ps -p 1 -o comm= | tr -d ' ')" == "systemd" ]] || die "systemd must be running as PID 1."
if command -v systemd-detect-virt >/dev/null && systemd-detect-virt -cq; then
  die "This machine is itself a container. Install Boukarou on a VPS (KVM) or a dedicated server."
fi
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || die "BOUKAROU_PORT must be between 1024 and 65535."

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
APT=(apt-get -o Acquire::Retries=3 -q)
"${APT[@]}" update
"${APT[@]}" install -y ca-certificates curl git snapd btrfs-progs

node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  say "Installing Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  "${APT[@]}" install -y nodejs
fi
node_ok || die "Node.js 22.13 or newer is required."

WITH_DOMAINS=1
[[ -n "${BOUKAROU_NO_DOMAINS:-}" ]] && WITH_DOMAINS=0
if (( WITH_DOMAINS )); then
  busy80=$(ss -Hltnp 'sport = :80' 2>/dev/null | grep -v nginx || true)
  if [[ -n "$busy80" ]]; then
    echo "Port 80 is used by another program; custom domains will stay disabled."
    WITH_DOMAINS=0
  else
    say "Installing nginx and certbot (custom domains)"
    "${APT[@]}" install -y nginx certbot
    systemctl enable --now nginx
  fi
fi

say "Setting up LXD"
if ! command -v lxc >/dev/null || ! snap list lxd >/dev/null 2>&1; then
  if ! command -v incus >/dev/null; then
    snap wait system seed.loaded >/dev/null 2>&1 || true
    snap install lxd --channel=5.21/stable
  fi
fi
export PATH="/snap/bin:$PATH"
if ! lxc storage show default >/dev/null 2>&1; then
  if [[ -n "${BOUKAROU_POOL_SIZE:-}" ]]; then
    size="${BOUKAROU_POOL_SIZE}"
  else
    free_gb=$(df -BG --output=avail /var | tail -1 | tr -dc '0-9')
    size_gb=$(( free_gb * 60 / 100 ))
    (( size_gb < 15 )) && die "At least 25 GB of free disk is needed for containers (found ${free_gb} GB)."
    size="${size_gb}GB"
  fi
  echo "Creating a ${size} btrfs storage pool (hard disk limits per container)."
  lxd init --auto --storage-backend=btrfs --storage-create-loop="${size%GB}" || lxd init --auto
fi
lxc query /1.0 >/dev/null || die "LXD does not answer."

say "Installing Boukarou"
install -d -m 755 "$APP" "$CONF"
install -d -m 700 "$DATA"
if [[ -d "$APP/.git" ]]; then
  git -C "$APP" fetch --depth 1 origin "$BRANCH"
  git -C "$APP" reset --hard "origin/$BRANCH"
else
  rm -rf "$APP"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
cd "$APP"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

HOST=0.0.0.0
[[ -n "${BOUKAROU_DOMAIN:-}" ]] && HOST=127.0.0.1
umask 077
cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=$PORT
HOST=$HOST
BOUKAROU_DATA_DIR=$DATA
BOUKAROU_BRANCH=$BRANCH
${BOUKAROU_DOMAIN:+BOUKAROU_RESERVED_DOMAINS=$BOUKAROU_DOMAIN}
ENV
install -m 644 deploy/boukarou.service /etc/systemd/system/boukarou.service
install -m 755 deploy/boukarou /usr/local/bin/boukarou

say "Starting the panel"
systemctl daemon-reload
systemctl enable boukarou >/dev/null
systemctl restart boukarou
for _ in $(seq 1 40); do
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null || { journalctl -u boukarou -n 60 --no-pager; die "The panel did not start."; }

public_ip=$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
[[ -n "$public_ip" ]] && boukarou set-public-host "${BOUKAROU_DOMAIN:-$public_ip}" >/dev/null

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  say "Opening firewall ports"
  ufw allow 2200:2999/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  [[ -z "${BOUKAROU_DOMAIN:-}" ]] && ufw allow "$PORT/tcp" >/dev/null
fi

URL="http://${public_ip:-SERVER_IP}:$PORT"
if [[ -n "${BOUKAROU_DOMAIN:-}" ]] && (( WITH_DOMAINS )); then
  say "Serving the panel on https://$BOUKAROU_DOMAIN"
  cat > /etc/nginx/sites-available/boukarou-panel.conf <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name $BOUKAROU_DOMAIN;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
NGINX
  ln -sf /etc/nginx/sites-available/boukarou-panel.conf /etc/nginx/sites-enabled/boukarou-panel.conf
  nginx -t && systemctl reload nginx
  if [[ -n "${BOUKAROU_EMAIL:-}" ]]; then contact=(--email "$BOUKAROU_EMAIL"); else contact=(--register-unsafely-without-email); fi
  if certbot --nginx -d "$BOUKAROU_DOMAIN" --non-interactive --agree-tos --redirect "${contact[@]}"; then
    URL="https://$BOUKAROU_DOMAIN"
  else
    echo "Certificate request failed (is the DNS record in place?). The panel is on http://$BOUKAROU_DOMAIN for now."
    URL="http://$BOUKAROU_DOMAIN"
  fi
fi

trap - ERR
PASSFILE="$DATA/initial-admin-password"
echo
echo "────────────────────────────────────────────────────────"
echo "  Boukarou is running."
echo
echo "  Open:      $URL/admin"
echo "  Username:  admin"
if [[ -f "$PASSFILE" ]]; then
  echo "  Password:  $(cat "$PASSFILE")"
  rm -f "$PASSFILE"
  echo
  echo "  Save this password now; it is not shown again."
else
  echo "  Password:  (unchanged; reset it with: sudo boukarou reset-admin-password)"
fi
echo
echo "  Manage:    sudo boukarou doctor | update | reset-admin-password | logs"
echo "────────────────────────────────────────────────────────"
