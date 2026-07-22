package com.airvpn.app.vpn

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * Builds an Xray JSON config from a vless:// or ss:// share URI,
 * with a TUN inbound that reads Android's VPN fd via xray.tun.fd.
 */
object VlessConfigBuilder {

    fun build(configUri: String): String {
        val uri = configUri.trim()
        return when {
            uri.startsWith("vless://", ignoreCase = true) -> buildVless(uri)
            uri.startsWith("ss://", ignoreCase = true) -> buildShadowsocks(uri)
            uri.startsWith("vmess://", ignoreCase = true) ->
                throw IllegalArgumentException("VMess share links not supported yet")
            else -> throw IllegalArgumentException("Unsupported config scheme")
        }
    }

    private fun buildShadowsocks(raw: String): String {
        val withoutScheme = raw.trim().removePrefix("ss://").removePrefix("SS://")
        val hashIdx = withoutScheme.indexOf('#')
        val main = if (hashIdx >= 0) withoutScheme.substring(0, hashIdx) else withoutScheme
        val at = main.lastIndexOf('@')
        if (at <= 0) throw IllegalArgumentException("Invalid SS link")
        val userInfoPart = main.substring(0, at)
        val hostPort = main.substring(at + 1)
        val host = hostPort.substringBefore(':')
        val port = hostPort.substringAfter(':', "443").toIntOrNull() ?: 443
        if (host.isBlank()) throw IllegalArgumentException("Invalid SS host")

        val (method, password) = decodeSsUserInfo(userInfoPart)
        val outbound = JSONObject()
            .put("tag", "proxy")
            .put("protocol", "shadowsocks")
            .put(
                "settings",
                JSONObject()
                    .put("servers", JSONArray().put(
                        JSONObject()
                            .put("address", host)
                            .put("port", port)
                            .put("method", method)
                            .put("password", password)
                            .put("level", 0),
                    )),
            )
        return rootConfig(outbound)
    }

    private fun decodeSsUserInfo(userInfoPart: String): Pair<String, String> {
        // method:password  OR  base64(method:password)
        val decoded = try {
            val padded = userInfoPart + "=".repeat((4 - userInfoPart.length % 4) % 4)
            String(
                android.util.Base64.decode(padded, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP),
                StandardCharsets.UTF_8,
            )
        } catch (_: Exception) {
            try {
                val padded = userInfoPart + "=".repeat((4 - userInfoPart.length % 4) % 4)
                String(
                    android.util.Base64.decode(padded, android.util.Base64.DEFAULT),
                    StandardCharsets.UTF_8,
                )
            } catch (_: Exception) {
                userInfoPart
            }
        }
        val colon = decoded.indexOf(':')
        if (colon <= 0) throw IllegalArgumentException("Invalid SS method/password")
        return decoded.substring(0, colon) to decoded.substring(colon + 1)
    }

    private fun rootConfig(proxyOutbound: JSONObject): String {
        val tunInbound = JSONObject()
            .put("tag", "tun-in")
            .put("protocol", "tun")
            .put(
                "settings",
                JSONObject()
                    .put("mtu", 1500)
                    .put("name", "xray0")
                    .put("userLevel", 0),
            )
            .put(
                "sniffing",
                JSONObject()
                    .put("enabled", true)
                    .put(
                        "destOverride",
                        JSONArray().put("http").put("tls").put("quic"),
                    )
                    .put("routeOnly", false),
            )
        return JSONObject()
            .put(
                "log",
                JSONObject()
                    .put("loglevel", "warning")
                    .put("access", "none")
                    .put("error", ""),
            )
            .put(
                "dns",
                JSONObject()
                    .put("servers", JSONArray().put("1.1.1.1").put("8.8.8.8"))
                    .put("queryStrategy", "UseIPv4"),
            )
            .put("inbounds", JSONArray().put(tunInbound))
            .put(
                "outbounds",
                JSONArray()
                    .put(proxyOutbound)
                    .put(JSONObject().put("tag", "direct").put("protocol", "freedom"))
                    .put(JSONObject().put("tag", "block").put("protocol", "blackhole")),
            )
            .put(
                "routing",
                JSONObject()
                    .put("domainStrategy", "AsIs")
                    .put(
                        "rules",
                        JSONArray()
                            .put(
                                JSONObject()
                                    .put("type", "field")
                                    .put(
                                        "ip",
                                        JSONArray()
                                            .put("0.0.0.0/8")
                                            .put("10.0.0.0/8")
                                            .put("127.0.0.0/8")
                                            .put("169.254.0.0/16")
                                            .put("172.16.0.0/12")
                                            .put("192.168.0.0/16")
                                            .put("224.0.0.0/4")
                                            .put("240.0.0.0/4")
                                            .put("::1/128")
                                            .put("fc00::/7")
                                            .put("fe80::/10"),
                                    )
                                    .put("outboundTag", "direct"),
                            )
                            .put(
                                JSONObject()
                                    .put("type", "field")
                                    .put("network", "tcp,udp")
                                    .put("outboundTag", "proxy"),
                            ),
                    ),
            )
            .put(
                "policy",
                JSONObject().put(
                    "system",
                    JSONObject()
                        .put("statsOutboundUplink", true)
                        .put("statsOutboundDownlink", true),
                ),
            )
            .put("stats", JSONObject())
            .toString()
    }

    private fun buildVless(raw: String): String {
        val parsed = Uri.parse(raw)
        val uuid = parsed.userInfo?.substringBefore(':')
            ?: throw IllegalArgumentException("Missing VLESS UUID")
        val host = parsed.host
            ?: throw IllegalArgumentException("Missing VLESS host")
        val port = if (parsed.port > 0) parsed.port else 443
        val q = queryMap(parsed)

        val security = (q["security"] ?: "none").lowercase()
        val network = (q["type"] ?: "tcp").lowercase()
        val encryption = q["encryption"] ?: "none"
        val flow = q["flow"] ?: ""
        val sni = q["sni"] ?: host
        val fp = q["fp"] ?: "chrome"
        val pbk = q["pbk"] ?: ""
        val sid = q["sid"] ?: ""
        val spx = q["spx"] ?: "/"
        val alpn = q["alpn"]

        val user = JSONObject()
            .put("id", uuid)
            .put("encryption", encryption)
            .put("level", 0)
        if (flow.isNotBlank()) {
            user.put("flow", flow)
        }

        val vnext = JSONObject()
            .put("address", host)
            .put("port", port)
            .put("users", JSONArray().put(user))

        val outbound = JSONObject()
            .put("tag", "proxy")
            .put("protocol", "vless")
            .put("settings", JSONObject().put("vnext", JSONArray().put(vnext)))
            .put("streamSettings", streamSettings(security, network, q, sni, fp, pbk, sid, spx, alpn))
            .put(
                "mux",
                JSONObject()
                    .put("enabled", false)
                    .put("concurrency", -1),
            )
        return rootConfig(outbound)
    }

    private fun streamSettings(
        security: String,
        network: String,
        q: Map<String, String>,
        sni: String,
        fp: String,
        pbk: String,
        sid: String,
        spx: String,
        alpn: String?,
    ): JSONObject {
        val stream = JSONObject()
            .put("network", network)
            .put("security", security)

        when (security) {
            "reality" -> {
                val reality = JSONObject()
                    .put("show", false)
                    .put("fingerprint", fp)
                    .put("serverName", sni)
                    .put("publicKey", pbk)
                    .put("shortId", sid)
                    .put("spiderX", spx)
                // Post-quantum REALITY verify key (share link `pqv=`)
                val pqv = q["pqv"]
                if (!pqv.isNullOrBlank()) {
                    reality.put("mldsa65Verify", pqv)
                }
                stream.put("realitySettings", reality)
            }
            "tls" -> {
                val tls = JSONObject()
                    .put("serverName", sni)
                    .put("allowInsecure", false)
                    .put("fingerprint", fp)
                if (!alpn.isNullOrBlank()) {
                    tls.put(
                        "alpn",
                        JSONArray().apply {
                            alpn.split(',').forEach { put(it.trim()) }
                        },
                    )
                }
                stream.put("tlsSettings", tls)
            }
        }

        when (network) {
            "ws" -> {
                val path = q["path"] ?: "/"
                val hostHeader = q["host"] ?: sni
                stream.put(
                    "wsSettings",
                    JSONObject()
                        .put("path", path)
                        .put("headers", JSONObject().put("Host", hostHeader)),
                )
            }
            "grpc" -> {
                stream.put(
                    "grpcSettings",
                    JSONObject()
                        .put("serviceName", q["serviceName"] ?: q["path"] ?: "")
                        .put("multiMode", false),
                )
            }
            "tcp" -> {
                val headerType = q["headerType"] ?: "none"
                if (headerType == "http") {
                    stream.put(
                        "tcpSettings",
                        JSONObject().put(
                            "header",
                            JSONObject()
                                .put("type", "http")
                                .put(
                                    "request",
                                    JSONObject()
                                        .put("path", JSONArray().put(q["path"] ?: "/"))
                                        .put(
                                            "headers",
                                            JSONObject().put(
                                                "Host",
                                                JSONArray().put(q["host"] ?: sni),
                                            ),
                                        ),
                                ),
                        ),
                    )
                }
            }
            "h2", "http" -> {
                stream.put(
                    "httpSettings",
                    JSONObject()
                        .put("path", q["path"] ?: "/")
                        .put("host", JSONArray().put(q["host"] ?: sni)),
                )
            }
        }
        return stream
    }

    private fun queryMap(uri: Uri): Map<String, String> {
        val out = linkedMapOf<String, String>()
        for (name in uri.queryParameterNames) {
            val v = uri.getQueryParameter(name) ?: continue
            out[name] = try {
                URLDecoder.decode(v, StandardCharsets.UTF_8.name())
            } catch (_: Exception) {
                v
            }
        }
        return out
    }
}
