#!/usr/bin/env bash
# Runs ON the VPS (uploaded by vps-one-click.sh).
# Modes:
#   auto  — reuse existing 3x-ui if present, otherwise fresh install (default)
#   reuse — require existing panel; add inbound + export config
#   fresh — always run installer (may reset credentials)
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

SERVER_ID="${AIRVPN_SERVER_ID:-node1}"
SERVER_NAME="${AIRVPN_SERVER_NAME:-AirVPN Node}"
SERVER_NAME_MY="${AIRVPN_SERVER_NAME_MY:-$SERVER_NAME}"
REGION="${AIRVPN_REGION:-US}"
VLESS_PORT="${AIRVPN_VLESS_PORT:-}"
PANEL_PORT="${AIRVPN_PANEL_PORT:-}"
SNI="${AIRVPN_SNI:-www.microsoft.com}"
PANEL_USER="${AIRVPN_PANEL_USER:-dominate}"
PANEL_PASS="${AIRVPN_PANEL_PASS:-}"
PANEL_URL_OVERRIDE="${AIRVPN_PANEL_URL:-}"
MODE="${AIRVPN_MODE:-auto}" # auto | reuse | fresh
REUSE_INBOUND_ID="${AIRVPN_REUSE_INBOUND_ID:-}" # if set, adopt existing inbound instead of creating

rand_port() {
  echo $((20000 + RANDOM % 40000))
}

rand_hex() {
  openssl rand -hex "${1:-8}"
}

rand_pass() {
  openssl rand -base64 18 | tr -d '/+=' | head -c 20
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

panel_installed() {
  [[ -x /usr/local/x-ui/x-ui ]] || systemctl is-active --quiet x-ui 2>/dev/null || [[ -f /etc/x-ui/x-ui.db ]]
}

wait_for_apt() {
  local i=0
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
    || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 \
    || fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ $i -gt 60 ]]; then
      echo "Timed out waiting for apt lock" >&2
      return 1
    fi
    sleep 2
  done
}

repair_apt() {
  wait_for_apt || true
  dpkg --configure -a || true
  apt-get -f install -y || true
}

ensure_host_packages() {
  echo "==> Preparing host"
  if need_cmd curl && need_cmd openssl && need_cmd jq; then
    echo "==> Host packages already present (curl/openssl/jq)"
    return 0
  fi
  if need_cmd apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    repair_apt
    wait_for_apt || true
    apt-get update -y || true
    # Retry install — previous 3x-ui runs often leave dpkg half-configured.
    if ! apt-get install -y curl ca-certificates openssl jq ufw; then
      echo "==> apt install failed; repairing dpkg and retrying…"
      repair_apt
      wait_for_apt || true
      apt-get install -y curl ca-certificates openssl jq ufw
    fi
  elif need_cmd dnf; then
    dnf install -y curl ca-certificates openssl jq
  elif need_cmd yum; then
    yum install -y curl ca-certificates openssl jq
  else
    echo "Unsupported OS (need apt/dnf/yum)" >&2
    exit 1
  fi
  if ! need_cmd jq; then
    echo "jq is required but missing after package install" >&2
    exit 1
  fi
  if ! need_cmd curl; then
    echo "curl is required but missing after package install" >&2
    exit 1
  fi
}

ensure_host_packages

PUBLIC_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org || true)"
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  echo "Could not detect public IP" >&2
  exit 1
fi

API_TOKEN=""
EXISTING=0
if panel_installed; then EXISTING=1; fi

if [[ "$MODE" == "auto" ]]; then
  if [[ "$EXISTING" -eq 1 ]]; then MODE=reuse; else MODE=fresh; fi
fi

if [[ "$MODE" == "reuse" && "$EXISTING" -eq 0 && -z "$PANEL_URL_OVERRIDE" ]]; then
  echo "No existing 3x-ui detected. Use --fresh or install first." >&2
  exit 1
fi

if [[ "$MODE" == "fresh" ]]; then
  if [[ -z "$VLESS_PORT" ]]; then VLESS_PORT="$(rand_port)"; fi
  if [[ -z "$PANEL_PORT" ]]; then PANEL_PORT="$(rand_port)"; fi
  if [[ "$PANEL_PORT" == "$VLESS_PORT" ]]; then PANEL_PORT=$((VLESS_PORT + 1)); fi
  if [[ -z "$PANEL_PASS" ]]; then PANEL_PASS="$(rand_pass)"; fi
  WEB_PATH="$(rand_hex 10)"

  if [[ "$EXISTING" -eq 1 ]]; then
    echo "==> Existing 3x-ui found — fresh install will reconfigure the panel"
  fi

  echo "==> Installing 3x-ui (non-interactive)"
  export XUI_NONINTERACTIVE=1
  export XUI_USERNAME="$PANEL_USER"
  export XUI_PASSWORD="$PANEL_PASS"
  export XUI_PANEL_PORT="$PANEL_PORT"
  export XUI_WEB_BASE_PATH="$WEB_PATH"
  export XUI_SSL_MODE=none
  export XUI_SERVER_IP="$PUBLIC_IP"

  bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)

  RESULT_FILE="/etc/x-ui/install-result.env"
  if [[ ! -f "$RESULT_FILE" ]]; then
    echo "Missing $RESULT_FILE after install" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$RESULT_FILE"
  PANEL_USER="${XUI_USERNAME:-$PANEL_USER}"
  PANEL_PASS="${XUI_PASSWORD:-$PANEL_PASS}"
  PANEL_PORT="${XUI_PANEL_PORT:-$PANEL_PORT}"
  WEB_PATH="${XUI_WEB_BASE_PATH:-$WEB_PATH}"
  API_TOKEN="${XUI_API_TOKEN:-}"
  WEB_PATH="${WEB_PATH#/}"
  WEB_PATH="${WEB_PATH%/}"
  PANEL_BASE="http://${PUBLIC_IP}:${PANEL_PORT}/${WEB_PATH}"
else
  echo "==> Reusing existing 3x-ui"
  RESULT_FILE="/etc/x-ui/install-result.env"
  if [[ -n "$PANEL_URL_OVERRIDE" ]]; then
    PANEL_BASE="${PANEL_URL_OVERRIDE%/}"
  elif [[ -f "$RESULT_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$RESULT_FILE"
    PANEL_USER="${AIRVPN_PANEL_USER:-${XUI_USERNAME:-$PANEL_USER}}"
    PANEL_PASS="${AIRVPN_PANEL_PASS:-${XUI_PASSWORD:-$PANEL_PASS}}"
    PANEL_PORT="${XUI_PANEL_PORT:-$PANEL_PORT}"
    WEB_PATH="${XUI_WEB_BASE_PATH:-}"
    API_TOKEN="${XUI_API_TOKEN:-}"
    WEB_PATH="${WEB_PATH#/}"
    WEB_PATH="${WEB_PATH%/}"
    if [[ -n "$WEB_PATH" ]]; then
      PANEL_BASE="http://${PUBLIC_IP}:${PANEL_PORT}/${WEB_PATH}"
    else
      PANEL_BASE="http://${PUBLIC_IP}:${PANEL_PORT}"
    fi
    # Prefer access URL from installer if present
    if [[ -n "${XUI_ACCESS_URL:-}" ]]; then
      PANEL_BASE="${XUI_ACCESS_URL%/}"
      # Replace host with detected public IP when URL used localhost/0.0.0.0
      PANEL_BASE="$(printf '%s' "$PANEL_BASE" | sed -E "s#://(127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0)(:|/)#://${PUBLIC_IP}\\2#")"
    fi
  else
    if [[ -z "$PANEL_PASS" ]]; then
      echo "Existing panel has no /etc/x-ui/install-result.env." >&2
      echo "Pass credentials: --panel-user USER --panel-pass PASS --panel-url 'http://IP:PORT/path'" >&2
      exit 1
    fi
    if [[ -z "$PANEL_URL_OVERRIDE" ]]; then
      echo "Provide --panel-url for this existing panel (e.g. http://IP:2053/secret)." >&2
      exit 1
    fi
    PANEL_BASE="${PANEL_URL_OVERRIDE%/}"
  fi

  # Allow override credentials even when result file exists
  if [[ -n "${AIRVPN_PANEL_USER:-}" ]]; then PANEL_USER="$AIRVPN_PANEL_USER"; fi
  if [[ -n "${AIRVPN_PANEL_PASS:-}" ]]; then PANEL_PASS="$AIRVPN_PANEL_PASS"; fi

  if [[ -z "$VLESS_PORT" ]]; then VLESS_PORT="$(rand_port)"; fi
  # Derive panel port from URL when possible
  if [[ -z "$PANEL_PORT" ]]; then
    PANEL_PORT="$(printf '%s' "$PANEL_BASE" | sed -E 's#^[a-z]+://[^:/]+:([0-9]+)/.*#\1#' || true)"
  fi
fi

echo "==> Panel base: ${PANEL_BASE}"
echo "==> Opening firewall ports ${PANEL_PORT:-?} (panel) / ${VLESS_PORT} (vless)"
if need_cmd ufw; then
  [[ -n "${PANEL_PORT:-}" ]] && ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow "${VLESS_PORT}/tcp" >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

find_xray() {
  for candidate in \
    /usr/local/x-ui/bin/xray-linux-amd64 \
    /usr/local/x-ui/bin/xray-linux-arm64 \
    /usr/local/x-ui/bin/xray \
    "$(command -v xray || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

panel_csrf() {
  local csrf_json
  csrf_json="$(curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "${PANEL_BASE}/csrf-token")"
  printf '%s' "$csrf_json" | jq -r '.obj // empty'
}

panel_login() {
  local csrf login_json
  csrf="$(panel_csrf || true)"
  if [[ -z "$csrf" ]]; then
    sleep 2
    csrf="$(panel_csrf)"
  fi
  if [[ -z "$csrf" ]]; then
    echo "Failed to get csrf-token from ${PANEL_BASE}" >&2
    exit 1
  fi
  login_json="$(curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "${PANEL_BASE}/login" \
    -H "x-csrf-token: ${csrf}" \
    -H "content-type: application/x-www-form-urlencoded" \
    --data-urlencode "username=${PANEL_USER}" \
    --data-urlencode "password=${PANEL_PASS}")"
  if [[ "$(printf '%s' "$login_json" | jq -r '.success')" != "true" ]]; then
    echo "Panel login failed: $login_json" >&2
    echo "Hint: for existing panels pass --panel-user / --panel-pass / --panel-url" >&2
    exit 1
  fi
}

echo "==> Logging into panel API"
panel_login

PRIV=""
PUB=""
SHORT_ID=""
INBOUND_ID=""
VLESS_LISTEN_PORT="$VLESS_PORT"

if [[ -n "$REUSE_INBOUND_ID" ]]; then
  echo "==> Adopting existing inbound #${REUSE_INBOUND_ID}"
  CSRF="$(panel_csrf)"
  get_json="$(curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    "${PANEL_BASE}/panel/api/inbounds/get/${REUSE_INBOUND_ID}" \
    -H "x-csrf-token: ${CSRF}")"
  if [[ "$(printf '%s' "$get_json" | jq -r '.success')" != "true" ]]; then
    echo "get inbound failed: $get_json" >&2
    exit 1
  fi
  INBOUND_ID="$REUSE_INBOUND_ID"
  VLESS_LISTEN_PORT="$(printf '%s' "$get_json" | jq -r '.obj.port')"
  STREAM_RAW="$(printf '%s' "$get_json" | jq -r '.obj.streamSettings')"
  if [[ "$STREAM_RAW" == \{* ]]; then
    STREAM_OBJ="$STREAM_RAW"
  else
    STREAM_OBJ="$(printf '%s' "$STREAM_RAW" | jq -c .)"
  fi
  PUB="$(printf '%s' "$STREAM_OBJ" | jq -r '.realitySettings.settings.publicKey // empty')"
  SHORT_ID="$(printf '%s' "$STREAM_OBJ" | jq -r '.realitySettings.shortIds[0] // empty')"
  SNI="$(printf '%s' "$STREAM_OBJ" | jq -r '.realitySettings.serverNames[0] // empty')"
  if [[ -z "$SNI" || "$SNI" == "null" ]]; then SNI="${AIRVPN_SNI:-www.microsoft.com}"; fi
  if [[ -z "$PUB" || -z "$SHORT_ID" ]]; then
    echo "Inbound #${INBOUND_ID} is missing Reality publicKey/shortId" >&2
    exit 1
  fi
else
  echo "==> Generating Reality keys"
  XRAY_BIN="$(find_xray || true)"
  if [[ -z "$XRAY_BIN" ]]; then
    echo "xray binary not found" >&2
    exit 1
  fi
  KEY_OUT="$("$XRAY_BIN" x25519)"
  PRIV="$(printf '%s\n' "$KEY_OUT" | awk -F': *' '/[Pp]rivate/ {print $2; exit}' | tr -d '[:space:]')"
  PUB="$(printf '%s\n' "$KEY_OUT" | awk -F': *' '/[Pp]ublic/ {print $2; exit}' | tr -d '[:space:]')"
  if [[ -z "$PRIV" || -z "$PUB" ]]; then
    PRIV="$(printf '%s\n' "$KEY_OUT" | sed -n '1p' | tr -d '[:space:]')"
    PUB="$(printf '%s\n' "$KEY_OUT" | sed -n '2p' | tr -d '[:space:]')"
  fi
  SHORT_ID="$(openssl rand -hex 8)"

  CSRF="$(panel_csrf)"
  SETTINGS_JSON="$(jq -nc '{clients:[], decryption:"none", fallbacks:[]}')"
  STREAM_JSON="$(jq -nc \
    --arg priv "$PRIV" \
    --arg pub "$PUB" \
    --arg sni "$SNI" \
    --arg sid "$SHORT_ID" \
    '{
       network: "tcp",
       security: "reality",
       externalProxy: [],
       realitySettings: {
         show: false,
         xver: 0,
         dest: ($sni + ":443"),
         serverNames: [$sni],
         privateKey: $priv,
         minClientVer: "",
         maxClientVer: "",
         maxTimediff: 0,
         shortIds: [$sid],
         settings: {
           publicKey: $pub,
           fingerprint: "chrome",
           serverName: "",
           spiderX: "/"
         }
       },
       tcpSettings: { acceptProxyProtocol: false, header: { type: "none" } }
     }')"
  SNIFF_JSON="$(jq -nc '{enabled:true, destOverride:["http","tls","quic","fakedns"], metadataOnly:false, routeOnly:false}')"
  ADD_PAYLOAD="$(jq -nc \
    --argjson port "$VLESS_PORT" \
    --arg settings "$SETTINGS_JSON" \
    --arg stream "$STREAM_JSON" \
    --arg sniff "$SNIFF_JSON" \
    --arg remark "AirVPN-${SERVER_ID}" \
    '{
       up: 0, down: 0, total: 0,
       remark: $remark,
       enable: true,
       expiryTime: 0,
       listen: "",
       port: $port,
       protocol: "vless",
       settings: $settings,
       streamSettings: $stream,
       sniffing: $sniff
     }')"

  echo "==> Creating VLESS + Reality inbound on port ${VLESS_PORT}"
  add_json="$(curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "${PANEL_BASE}/panel/api/inbounds/add" \
    -H "x-csrf-token: ${CSRF}" \
    -H "content-type: application/json" \
    -d "$ADD_PAYLOAD")"

  if [[ "$(printf '%s' "$add_json" | jq -r '.success')" != "true" ]]; then
    echo "add inbound failed: $add_json" >&2
    exit 1
  fi

  INBOUND_ID="$(printf '%s' "$add_json" | jq -r '.obj.id // .obj // empty')"
  if [[ -z "$INBOUND_ID" || "$INBOUND_ID" == "null" ]]; then
    CSRF="$(panel_csrf)"
    list_json="$(curl -fsS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      "${PANEL_BASE}/panel/api/inbounds/list" \
      -H "x-csrf-token: ${CSRF}")"
    INBOUND_ID="$(printf '%s' "$list_json" | jq -r --argjson p "$VLESS_PORT" '
      (.obj // []) | map(select(.port == $p)) | .[0].id // empty')"
  fi
  if [[ -z "$INBOUND_ID" || "$INBOUND_ID" == "null" ]]; then
    echo "Could not resolve inbound id" >&2
    exit 1
  fi
  VLESS_LISTEN_PORT="$VLESS_PORT"
fi

# Resolve panel port for meta if still unknown
if [[ -z "${PANEL_PORT:-}" || "$PANEL_PORT" == "?" ]]; then
  PANEL_PORT="$(printf '%s' "$PANEL_BASE" | sed -nE 's#^[a-z]+://[^:/]+:([0-9]+).*#\1#p')"
  PANEL_PORT="${PANEL_PORT:-0}"
fi

jq -nc \
  --arg id "$SERVER_ID" \
  --arg slug "$SERVER_ID" \
  --arg name "$SERVER_NAME" \
  --arg nameMy "$SERVER_NAME_MY" \
  --arg region "$REGION" \
  --arg panelUrl "$PANEL_BASE" \
  --arg panelUsername "$PANEL_USER" \
  --arg panelPassword "$PANEL_PASS" \
  --arg panelSecret "$API_TOKEN" \
  --argjson panelInboundId "$INBOUND_ID" \
  --arg host "$PUBLIC_IP" \
  --argjson port "$VLESS_LISTEN_PORT" \
  --arg vlessPbk "$PUB" \
  --arg vlessSid "$SHORT_ID" \
  --arg vlessSni "$SNI" \
  --arg vlessFp "chrome" \
  --arg vlessFlow "xtls-rprx-vision" \
  --arg vlessSecurity "reality" \
  --arg vlessSpx "/" \
  --argjson panelPort "${PANEL_PORT:-0}" \
  --arg mode "$MODE" \
  '{
     id: $id,
     slug: $slug,
     name: $name,
     nameMy: $nameMy,
     region: $region,
     isActive: true,
     sortOrder: 1,
     panelUrl: $panelUrl,
     panelUsername: $panelUsername,
     panelPassword: $panelPassword,
     panelSecret: $panelSecret,
     panelInboundId: $panelInboundId,
     panelVerifySsl: false,
     host: $host,
     port: $port,
     vlessSecurity: $vlessSecurity,
     vlessFlow: $vlessFlow,
     vlessSni: $vlessSni,
     vlessFp: $vlessFp,
     vlessPbk: $vlessPbk,
     vlessSid: $vlessSid,
     vlessSpx: $vlessSpx,
     meta: { panelPort: $panelPort, publicIp: $host, mode: $mode }
   }' > /tmp/airvpn-node-result.json

echo "AIRVPN_RESULT_BEGIN"
cat /tmp/airvpn-node-result.json
echo
echo "AIRVPN_RESULT_END"
echo "==> Done (${MODE}). Panel: ${PANEL_BASE}"
