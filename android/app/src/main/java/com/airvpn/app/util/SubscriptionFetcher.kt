package com.airvpn.app.util

import android.util.Base64
import com.airvpn.app.data.model.SubscriptionInfo
import com.airvpn.app.data.model.VpnServerItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

data class SubscriptionFetchResult(
    val servers: List<VpnServerItem>,
    val info: SubscriptionInfo,
)

/**
 * Fetches a remote subscription URL (Clash/V2Ray style).
 * Body: base64 list of vless:// / ss:// lines (or plain text lines).
 * Headers often include: subscription-userinfo: upload=; download=; total=; expire=
 */
object SubscriptionFetcher {
    private val client = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    suspend fun fetch(url: String): Result<SubscriptionFetchResult> = withContext(Dispatchers.IO) {
        runCatching {
            val clean = url.trim()
            require(clean.startsWith("http://", true) || clean.startsWith("https://", true)) {
                "Subscription must be an http(s) URL"
            }
            val req = Request.Builder()
                .url(clean)
                .header("User-Agent", "AirVPN/1.0 (Android)")
                .header("Accept", "*/*")
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    error("Subscription HTTP ${resp.code}")
                }
                val bodyBytes = resp.body?.bytes() ?: error("Empty subscription body")
                val text = decodeBody(bodyBytes)
                val userInfo = resp.header("subscription-userinfo")
                    ?: resp.header("Subscription-Userinfo")
                val info = parseUserInfo(clean, userInfo)
                val servers = parseNodes(text, sourceUrl = clean)
                require(servers.isNotEmpty()) { "No vless:// or ss:// nodes in subscription" }
                SubscriptionFetchResult(
                    servers = servers,
                    info = info.copy(
                        nodeCount = servers.size,
                        lastFetchedAt = System.currentTimeMillis(),
                    ),
                )
            }
        }
    }

    private fun decodeBody(bytes: ByteArray): String {
        val raw = String(bytes, StandardCharsets.UTF_8).trim()
        // Already plain lines of URIs
        if (raw.contains("vless://", ignoreCase = true) || raw.contains("ss://", ignoreCase = true)) {
            return raw
        }
        return try {
            val cleaned = raw.replace("\\s".toRegex(), "")
            val padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4)
            String(Base64.decode(padded, Base64.DEFAULT), StandardCharsets.UTF_8)
        } catch (_: Exception) {
            try {
                val cleaned = raw.replace("\\s".toRegex(), "")
                val padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4)
                String(Base64.decode(padded, Base64.URL_SAFE or Base64.NO_WRAP), StandardCharsets.UTF_8)
            } catch (_: Exception) {
                raw
            }
        }
    }

    private fun parseNodes(text: String, sourceUrl: String): List<VpnServerItem> {
        val out = linkedMapOf<String, VpnServerItem>()
        for (line in text.lineSequence()) {
            val t = line.trim()
            if (t.isBlank() || t.startsWith("#")) continue
            // Some subs put multiple URIs space-separated
            val candidates = if (t.contains("://")) {
                t.split(Regex("\\s+")).filter { it.contains("://") }
            } else {
                listOf(t)
            }
            for (c in candidates) {
                VpnKeyImport.parse(c).onSuccess { item ->
                    // Region left empty — ViewModel fills country from the node's public IP.
                    out[item.id] = item.copy(
                        fromSubscription = true,
                        subscriptionUrl = sourceUrl,
                        region = "",
                        host = item.host ?: VpnKeyImport.hostFromUri(item.configUri),
                    )
                }
            }
        }
        return out.values.toList()
    }

    fun parseUserInfo(url: String, header: String?): SubscriptionInfo {
        if (header.isNullOrBlank()) {
            return SubscriptionInfo(url = url)
        }
        // upload=123; download=456; total=789; expire=1710000000
        val map = header.split(';')
            .map { it.trim() }
            .filter { it.contains('=') }
            .associate {
                val i = it.indexOf('=')
                it.substring(0, i).trim().lowercase() to it.substring(i + 1).trim()
            }
        return SubscriptionInfo(
            url = url,
            uploadBytes = map["upload"]?.toLongOrNull() ?: 0L,
            downloadBytes = map["download"]?.toLongOrNull() ?: 0L,
            totalBytes = map["total"]?.toLongOrNull() ?: 0L,
            expireAt = map["expire"]?.toLongOrNull() ?: 0L,
        )
    }
}
