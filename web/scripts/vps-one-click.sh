#!/usr/bin/env bash
# One-click: provision 3x-ui on a VPS and register it in the AirVPN web shop store.
#
# Usage:
#   ./scripts/vps-one-click.sh --ip 1.2.3.4 --password 'rootpass' --id us2 --region US
#   ./scripts/vps-one-click.sh --ip 1.2.3.4 --key ~/.ssh/id_rsa --id sg5 --name "Singapore 5" --region SG
#
# Existing 3x-ui on the VPS (default --mode auto reuses it):
#   ./scripts/vps-one-click.sh --ip 1.2.3.4 --password 'rootpass' --id us2 --mode reuse \
#     --panel-user dominate --panel-pass 'xxx' --panel-url 'http://1.2.3.4:51826/secret'
#   # or adopt an inbound that already exists:
#   ... --mode reuse --reuse-inbound 1 --panel-url '...' --panel-user ... --panel-pass ...
#   # force reinstall (resets panel credentials):
#   ... --mode fresh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_SCRIPT="$ROOT/scripts/remote-bootstrap.sh"
APPLY_SCRIPT="$ROOT/scripts/apply-vps-result.mjs"

IP=""
PASSWORD=""
SSH_KEY=""
SSH_USER="root"
SERVER_ID=""
SERVER_NAME=""
SERVER_NAME_MY=""
REGION="US"
SNI="www.microsoft.com"
PANEL_USER="dominate"
PANEL_PASS=""
PANEL_URL=""
VLESS_PORT=""
PANEL_PORT=""
MODE="auto"
REUSE_INBOUND_ID=""
SKIP_APPLY=0

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) IP="${2:-}"; shift 2 ;;
    --password) PASSWORD="${2:-}"; shift 2 ;;
    --key) SSH_KEY="${2:-}"; shift 2 ;;
    --user) SSH_USER="${2:-}"; shift 2 ;;
    --id) SERVER_ID="${2:-}"; shift 2 ;;
    --name) SERVER_NAME="${2:-}"; shift 2 ;;
    --name-my) SERVER_NAME_MY="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --sni) SNI="${2:-}"; shift 2 ;;
    --panel-user) PANEL_USER="${2:-}"; shift 2 ;;
    --panel-pass) PANEL_PASS="${2:-}"; shift 2 ;;
    --panel-url) PANEL_URL="${2:-}"; shift 2 ;;
    --vless-port) VLESS_PORT="${2:-}"; shift 2 ;;
    --panel-port) PANEL_PORT="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --reuse-inbound) REUSE_INBOUND_ID="${2:-}"; shift 2 ;;
    --skip-apply) SKIP_APPLY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

case "$MODE" in
  auto|reuse|fresh) ;;
  *) echo "--mode must be auto|reuse|fresh" >&2; exit 1 ;;
esac

if [[ -z "$IP" ]]; then
  echo "--ip is required" >&2
  usage 1
fi
if [[ -z "$PASSWORD" && -z "$SSH_KEY" ]]; then
  echo "Provide --password or --key" >&2
  usage 1
fi
if [[ -z "$SERVER_ID" ]]; then
  REGION_LC="$(printf '%s' "$REGION" | tr '[:upper:]' '[:lower:]')"
  SERVER_ID="${REGION_LC}$(printf '%s' "$IP" | tr -cd '0-9' | tail -c 2)"
fi
if [[ -z "$SERVER_NAME" ]]; then
  case "$(printf '%s' "$REGION" | tr '[:lower:]' '[:upper:]')" in
    US) SERVER_NAME="United States - ${SERVER_ID}" ;;
    SG) SERVER_NAME="Singapore - ${SERVER_ID}" ;;
    *) SERVER_NAME="AirVPN ${SERVER_ID}" ;;
  esac
fi
if [[ -z "$SERVER_NAME_MY" ]]; then
  SERVER_NAME_MY="$SERVER_NAME"
fi

if [[ ! -f "$REMOTE_SCRIPT" ]]; then
  echo "Missing $REMOTE_SCRIPT" >&2
  exit 1
fi

ssh_base=(ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=20)
scp_base=(scp -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

if [[ -n "$SSH_KEY" ]]; then
  ssh_base+=(-i "$SSH_KEY")
  scp_base+=(-i "$SSH_KEY")
  remote() { "${ssh_base[@]}" "${SSH_USER}@${IP}" "$@"; }
  upload() { "${scp_base[@]}" "$1" "${SSH_USER}@${IP}:$2"; }
elif command -v sshpass >/dev/null 2>&1; then
  export SSHPASS="$PASSWORD"
  remote() { sshpass -e "${ssh_base[@]}" "${SSH_USER}@${IP}" "$@"; }
  upload() { sshpass -e "${scp_base[@]}" "$1" "${SSH_USER}@${IP}:$2"; }
else
  echo "sshpass not found. Install it (brew install sshpass / apt install sshpass) or use --key" >&2
  exit 1
fi

echo "==> Checking SSH ${SSH_USER}@${IP}"
remote "echo ok >/dev/null"

TMP_REMOTE="/tmp/airvpn-remote-bootstrap-$$.sh"
RESULT_LOCAL="$(mktemp -t airvpn-result.XXXXXX.json)"
LOG_LOCAL="$(mktemp -t airvpn-install.XXXXXX.log)"
cleanup() { rm -f "$RESULT_LOCAL" "$LOG_LOCAL"; }
trap cleanup EXIT

echo "==> Uploading bootstrap"
upload "$REMOTE_SCRIPT" "$TMP_REMOTE"
remote "chmod +x $TMP_REMOTE"

echo "==> Mode=${MODE} — provisioning on ${IP}"
set +e
remote "\
  export AIRVPN_SERVER_ID=$(printf %q "$SERVER_ID"); \
  export AIRVPN_SERVER_NAME=$(printf %q "$SERVER_NAME"); \
  export AIRVPN_SERVER_NAME_MY=$(printf %q "$SERVER_NAME_MY"); \
  export AIRVPN_REGION=$(printf %q "$REGION"); \
  export AIRVPN_SNI=$(printf %q "$SNI"); \
  export AIRVPN_PANEL_USER=$(printf %q "$PANEL_USER"); \
  export AIRVPN_PANEL_PASS=$(printf %q "$PANEL_PASS"); \
  export AIRVPN_PANEL_URL=$(printf %q "$PANEL_URL"); \
  export AIRVPN_VLESS_PORT=$(printf %q "$VLESS_PORT"); \
  export AIRVPN_PANEL_PORT=$(printf %q "$PANEL_PORT"); \
  export AIRVPN_MODE=$(printf %q "$MODE"); \
  export AIRVPN_REUSE_INBOUND_ID=$(printf %q "$REUSE_INBOUND_ID"); \
  bash $TMP_REMOTE" | tee "$LOG_LOCAL"
status=${PIPESTATUS[0]}
set -e
if [[ $status -ne 0 ]]; then
  echo "Remote install failed (exit $status). See log above." >&2
  exit "$status"
fi

awk '/^AIRVPN_RESULT_BEGIN$/{f=1;next}/^AIRVPN_RESULT_END$/{f=0}f' "$LOG_LOCAL" > "$RESULT_LOCAL"
if [[ ! -s "$RESULT_LOCAL" ]]; then
  echo "Could not parse AIRVPN_RESULT from remote output" >&2
  exit 1
fi

OUT_DIR="$ROOT/data/vps-results"
mkdir -p "$OUT_DIR"
STAMPED="$OUT_DIR/${SERVER_ID}-$(date +%Y%m%d-%H%M%S).json"
cp "$RESULT_LOCAL" "$STAMPED"
echo "==> Saved result $STAMPED"

if [[ "$SKIP_APPLY" -eq 0 ]]; then
  echo "==> Registering server in shop store"
  node "$APPLY_SCRIPT" "$STAMPED"
else
  echo "==> Skipped store apply (--skip-apply)"
fi

echo
echo "Success."
jq -r '"\(.name) (\(.id))\nMode: \(.meta.mode // "n/a")\nPanel: \(.panelUrl)\nUser: \(.panelUsername)\nHost: \(.host):\(.port)\nInbound: \(.panelInboundId)\nPBK: \(.vlessPbk)\nSID: \(.vlessSid)"' "$STAMPED"
echo
echo "Open Admin → Servers and tap Test on ${SERVER_ID}."
