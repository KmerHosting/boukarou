#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
echo "This removes the Boukarou panel, its database and its settings."
echo "Containers, snapshots and the LXD project are KEPT. Custom-domain nginx files are removed."
read -r -p "Type REMOVE to continue: " answer </dev/tty
[[ "$answer" == "REMOVE" ]] || { echo "Cancelled."; exit 0; }
systemctl disable --now boukarou 2>/dev/null || true
rm -f /etc/systemd/system/boukarou.service /usr/local/bin/boukarou
rm -f /etc/nginx/sites-enabled/boukarou-* /etc/nginx/sites-available/boukarou-*
command -v nginx >/dev/null && nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
rm -rf /opt/boukarou /etc/boukarou /var/lib/boukarou
systemctl daemon-reload
echo "Boukarou removed. To delete the containers too: lxc list --project boukarou"
