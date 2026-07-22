package com.airvpn.app.util

import android.net.Uri
import com.airvpn.app.data.model.VpnServerItem
import org.json.JSONObject
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object VpnKeyImport {

    fun parse(raw: String): Result<VpnServerItem> {
        val trimmed = raw.trim()
            .removePrefix("```")
            .removeSuffix("```")
            .trim()
        if (trimmed.isBlank()) {
            return Result.failure(IllegalArgumentException("Paste a vless:// or ss:// key"))
        }
        // Support multi-line paste: take first URI-looking line
        val line = trimmed.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.contains("://") }
            ?: trimmed

        val lower = line.lowercase()
        return when {
            lower.startsWith("vless://") -> parseVless(line)
            lower.startsWith("ss://") -> parseShadowsocks(line)
            lower.startsWith("vmess://") ->
                Result.failure(IllegalArgumentException("VMess not supported yet — use vless:// or ss://"))
            else -> Result.failure(IllegalArgumentException("Key must start with vless:// or ss://"))
        }
    }

    private fun parseVless(uri: String): Result<VpnServerItem> {
        return try {
            val parsed = Uri.parse(uri)
            val host = parsed.host
                ?: return Result.failure(IllegalArgumentException("Invalid VLESS host"))
            if (parsed.userInfo.isNullOrBlank()) {
                return Result.failure(IllegalArgumentException("Invalid VLESS UUID"))
            }
            val name = fragmentName(parsed) ?: "Imported VLESS"
            val region = guessRegion(name, host)
            Result.success(
                VpnServerItem(
                    id = stableId("vless", uri),
                    name = name,
                    region = region,
                    protocol = "vless",
                    tag = "Vless",
                    tier = "free",
                    online = true,
                    configUri = uri.trim(),
                    host = host,
                    fromSubscription = false,
                ),
            )
        } catch (e: Exception) {
            Result.failure(IllegalArgumentException(e.message ?: "Invalid VLESS key"))
        }
    }

    private fun parseShadowsocks(uri: String): Result<VpnServerItem> {
        return try {
            val trimmed = uri.trim()
            // ss://base64@host:port#name  OR ss://method:pass@host:port#name
            val withoutScheme = trimmed.removePrefix("ss://").removePrefix("SS://")
            val hashIdx = withoutScheme.indexOf('#')
            val main = if (hashIdx >= 0) withoutScheme.substring(0, hashIdx) else withoutScheme
            val frag = if (hashIdx >= 0) {
                URLDecoder.decode(withoutScheme.substring(hashIdx + 1), "UTF-8")
            } else {
                null
            }

            val at = main.lastIndexOf('@')
            if (at <= 0) {
                return Result.failure(IllegalArgumentException("Invalid SS link"))
            }
            val hostPort = main.substring(at + 1)
            val host = hostPort.substringBefore(':').ifBlank {
                return Result.failure(IllegalArgumentException("Invalid SS host"))
            }
            val name = frag?.takeIf { it.isNotBlank() } ?: "Imported SS"
            Result.success(
                VpnServerItem(
                    id = stableId("ss", trimmed),
                    name = name,
                    region = guessRegion(name, host),
                    protocol = "ss",
                    tag = "SS",
                    tier = "free",
                    online = true,
                    configUri = trimmed,
                    host = host,
                    fromSubscription = false,
                ),
            )
        } catch (e: Exception) {
            Result.failure(IllegalArgumentException(e.message ?: "Invalid SS key"))
        }
    }

    private fun fragmentName(uri: Uri): String? {
        val f = uri.fragment ?: return null
        return try {
            URLDecoder.decode(f, StandardCharsets.UTF_8.name()).trim().ifBlank { null }
        } catch (_: Exception) {
            f.trim().ifBlank { null }
        }
    }

    private fun guessRegion(name: String, host: String): String {
        val blob = "$name $host".lowercase()
        return when {
            "sg" in blob || "singapore" in blob -> "SG"
            "us" in blob || "america" in blob || "united states" in blob -> "US"
            "jp" in blob || "japan" in blob || "tokyo" in blob -> "JP"
            "hk" in blob || "hong kong" in blob -> "HK"
            "my" in blob || "malaysia" in blob -> "MY"
            "th" in blob || "thailand" in blob -> "TH"
            "de" in blob || "germany" in blob -> "DE"
            "gb" in blob || "uk" in blob || "london" in blob -> "GB"
            else -> ""
        }
    }

    private fun stableId(prefix: String, uri: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val hex = md.digest(uri.trim().toByteArray(StandardCharsets.UTF_8))
            .take(8)
            .joinToString("") { "%02x".format(it) }
        return "import-$prefix-$hex"
    }

    fun toJson(item: VpnServerItem): JSONObject {
        return JSONObject()
            .put("id", item.id)
            .put("name", item.name)
            .put("region", item.region)
            .put("protocol", item.protocol)
            .put("tag", item.tag)
            .put("tier", item.tier)
            .put("online", item.online)
            .put("configUri", item.configUri)
            .put("host", item.host ?: hostFromUri(item.configUri))
            .put("fromSubscription", item.fromSubscription)
            .put("subscriptionUrl", item.subscriptionUrl)
    }

    fun fromJson(o: JSONObject): VpnServerItem {
        val uri = o.optString("configUri", "").takeIf { it.isNotBlank() }
        val host = o.optString("host", "").takeIf { it.isNotBlank() }
            ?: hostFromUri(uri)
        return VpnServerItem(
            id = o.getString("id"),
            name = o.optString("name", "Imported"),
            region = o.optString("region", ""),
            protocol = o.optString("protocol", "vless"),
            tag = o.optString("tag", "Vless"),
            tier = o.optString("tier", "free"),
            online = o.optBoolean("online", true),
            configUri = uri,
            host = host,
            fromSubscription = o.optBoolean("fromSubscription", false),
            subscriptionUrl = o.optString("subscriptionUrl", "").takeIf { it.isNotBlank() },
        )
    }

    /** Extract host/IP from a share link for display. */
    fun hostFromUri(uri: String?): String? {
        if (uri.isNullOrBlank()) return null
        val t = uri.trim()
        return try {
            when {
                t.startsWith("vless://", true) -> Uri.parse(t).host
                t.startsWith("ss://", true) -> {
                    val without = t.removePrefix("ss://").removePrefix("SS://")
                    val main = without.substringBefore('#')
                    val at = main.lastIndexOf('@')
                    if (at <= 0) null else main.substring(at + 1).substringBefore(':').ifBlank { null }
                }
                else -> Uri.parse(t).host
            }
        } catch (_: Exception) {
            null
        }
    }

    /** Extract port from a share link (defaults to 443). */
    fun portFromUri(uri: String?): Int {
        if (uri.isNullOrBlank()) return 443
        val t = uri.trim()
        return try {
            when {
                t.startsWith("vless://", true) -> {
                    val p = Uri.parse(t).port
                    if (p > 0) p else 443
                }
                t.startsWith("ss://", true) -> {
                    val without = t.removePrefix("ss://").removePrefix("SS://")
                    val main = without.substringBefore('#')
                    val at = main.lastIndexOf('@')
                    if (at <= 0) 443 else {
                        main.substring(at + 1).substringAfter(':', "443").toIntOrNull() ?: 443
                    }
                }
                else -> {
                    val p = Uri.parse(t).port
                    if (p > 0) p else 443
                }
            }
        } catch (_: Exception) {
            443
        }
    }
}
