"""SSH catalog config helpers (URI build/parse; never log passwords)."""
from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse, urlunparse


def is_ssh_uri(uri: str | None) -> bool:
    return (uri or "").strip().lower().startswith("ssh://")


def redact_ssh_uri(uri: str | None) -> str:
    """Return ssh://user@host:port?... without password."""
    raw = (uri or "").strip()
    if not is_ssh_uri(raw):
        return ""
    try:
        parsed = urlparse(raw)
        user = unquote(parsed.username or "")
        host = parsed.hostname or ""
        if not host:
            return ""
        port = parsed.port
        netloc = quote(user, safe="") + "@" + host if user else host
        if port:
            netloc = f"{netloc}:{port}"
        return urlunparse(("ssh", netloc, "", "", parsed.query, parsed.fragment))
    except Exception:
        return ""


def build_ssh_uri(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    sni: str = "",
    tls: bool = True,
    allow_insecure: bool = False,
    name: str = "",
) -> str:
    host = (host or "").strip()
    user = (username or "").strip()
    if not host or not user:
        raise ValueError("ssh host and username required")
    if port <= 0 or port > 65535:
        raise ValueError("invalid ssh port")
    netloc = (
        f"{quote(user, safe='')}:{quote(password or '', safe='')}@"
        f"{host}:{int(port)}"
    )
    q: dict[str, str] = {
        "tls": "1" if tls else "0",
        "allowInsecure": "1" if allow_insecure else "0",
    }
    sni_clean = (sni or "").strip()
    if sni_clean:
        q["sni"] = sni_clean
    fragment = quote((name or "").strip(), safe="")
    return urlunparse(("ssh", netloc, "", "", urlencode(q), fragment))


def build_passwordless_ssh_uri(
    *,
    host: str,
    port: int,
    username: str,
    sni: str = "",
    tls: bool = True,
    allow_insecure: bool = False,
    name: str = "",
) -> str:
    return build_ssh_uri(
        host=host,
        port=port,
        username=username,
        password="",
        sni=sni,
        tls=tls,
        allow_insecure=allow_insecure,
        name=name,
    )


def parse_ssh_uri(uri: str) -> dict[str, Any]:
    raw = (uri or "").strip()
    if not is_ssh_uri(raw):
        raise ValueError("not an ssh:// URI")
    parsed = urlparse(raw)
    host = parsed.hostname or ""
    if not host:
        raise ValueError("ssh host missing")
    user = unquote(parsed.username or "")
    if not user:
        raise ValueError("ssh username missing")
    password = unquote(parsed.password or "")
    port = int(parsed.port or 22)
    qs = parse_qs(parsed.query, keep_blank_values=True)

    def _first(key: str, default: str = "") -> str:
        vals = qs.get(key) or qs.get(key.lower()) or []
        return (vals[0] if vals else default).strip()

    tls_raw = _first("tls", "1").lower()
    insecure_raw = _first("allowInsecure", _first("allow_insecure", "0")).lower()
    return {
        "host": host,
        "port": port,
        "username": user,
        "password": password,
        "sni": _first("sni") or host,
        "tls": tls_raw in ("1", "true", "yes"),
        "allow_insecure": insecure_raw in ("1", "true", "yes"),
        "name": unquote(parsed.fragment or ""),
    }


def ssh_fields_from_row(row: dict[str, Any]) -> dict[str, Any]:
    """Public SSH fields from a mobile_servers row (no password)."""
    uri = (row.get("config_uri") or "").strip()
    host = (row.get("ssh_host") or "").strip()
    user = (row.get("ssh_user") or "").strip()
    port = int(row.get("ssh_port") or 0)
    sni = (row.get("ssh_sni") or "").strip()
    tls = bool(row.get("ssh_tls") if row.get("ssh_tls") is not None else 1)
    allow_insecure = bool(row.get("ssh_allow_insecure") or 0)
    if (not host or not user) and is_ssh_uri(uri):
        try:
            parsed = parse_ssh_uri(uri)
            host = host or parsed["host"]
            user = user or parsed["username"]
            port = port or int(parsed["port"])
            sni = sni or parsed["sni"]
            if row.get("ssh_tls") is None:
                tls = parsed["tls"]
            if row.get("ssh_allow_insecure") is None:
                allow_insecure = parsed["allow_insecure"]
        except Exception:
            pass
    if port <= 0:
        port = 443 if tls else 22
    return {
        "host": host,
        "port": port,
        "username": user,
        "sni": sni,
        "tls": tls,
        "allow_insecure": allow_insecure,
        "password_set": bool((row.get("ssh_password_enc") or "").strip()),
    }


def connect_uri_from_row(row: dict[str, Any], password: str) -> str:
    fields = ssh_fields_from_row(row)
    if not fields["host"] or not fields["username"]:
        raise ValueError("SSH server incomplete")
    if not (password or "").strip():
        raise ValueError("SSH password missing")
    allow_insecure = bool(fields["allow_insecure"])
    # HTTP Injector–style stunnel: custom SNI + self-signed cert → must skip verify
    if fields["tls"] and not allow_insecure and fields["sni"] and fields["sni"] != fields["host"]:
        allow_insecure = True
    return build_ssh_uri(
        host=fields["host"],
        port=int(fields["port"]),
        username=fields["username"],
        password=password,
        sni=fields["sni"] or fields["host"],
        tls=bool(fields["tls"]),
        allow_insecure=allow_insecure,
        name=(row.get("name") or "").strip(),
    )
