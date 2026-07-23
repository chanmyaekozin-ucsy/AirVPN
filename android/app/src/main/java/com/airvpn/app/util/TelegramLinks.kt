package com.airvpn.app.util

import android.net.Uri

/**
 * Normalize Telegram handles / t.me links to [tg://] deep links so Android
 * opens them in the Telegram app instead of a browser.
 *
 * Examples:
 * - `@cloud_gameshop_bot` → `tg://resolve?domain=cloud_gameshop_bot`
 * - `https://t.me/cloud_gameshop_bot` → same
 * - `https://t.me/bot?start=ref` → `tg://resolve?domain=bot&start=ref`
 */
object TelegramLinks {
    private val USERNAME = Regex("^[A-Za-z0-9_]{4,64}$")
    private val AT_HANDLE = Regex("^@([A-Za-z0-9_]{4,64})$")

    fun toOpenUri(raw: String): String {
        val t = raw.trim()
        if (t.isEmpty()) return t
        if (t.startsWith("tg://", ignoreCase = true)) return t

        AT_HANDLE.matchEntire(t)?.let { m ->
            return "tg://resolve?domain=${m.groupValues[1]}"
        }

        val asHttp = when {
            t.startsWith("http://", ignoreCase = true) ||
                t.startsWith("https://", ignoreCase = true) -> t
            t.startsWith("t.me/", ignoreCase = true) ||
                t.startsWith("telegram.me/", ignoreCase = true) ||
                t.startsWith("telegram.dog/", ignoreCase = true) -> "https://$t"
            else -> return t
        }

        val uri = runCatching { Uri.parse(asHttp) }.getOrNull() ?: return t
        val host = uri.host?.lowercase()?.removePrefix("www.") ?: return t
        if (host !in setOf("t.me", "telegram.me", "telegram.dog")) return t

        val segments = uri.pathSegments.orEmpty().filter { it.isNotBlank() }
        if (segments.isEmpty()) return t

        val first = segments[0]
        if (first.startsWith("+")) {
            val invite = first.removePrefix("+")
            if (invite.isNotBlank()) return "tg://join?invite=$invite"
        }
        if (first.equals("joinchat", ignoreCase = true) && segments.size >= 2) {
            return "tg://join?invite=${segments[1]}"
        }

        val domain = first.removePrefix("@")
        if (!USERNAME.matches(domain)) return t

        val start = uri.getQueryParameter("start")
        return if (!start.isNullOrBlank()) {
            "tg://resolve?domain=$domain&start=${Uri.encode(start)}"
        } else {
            "tg://resolve?domain=$domain"
        }
    }

    /** Browser fallback when Telegram is not installed. */
    fun toHttpsFallback(raw: String): String? {
        val t = raw.trim()
        if (t.isEmpty()) return null
        if (t.startsWith("http://", ignoreCase = true) ||
            t.startsWith("https://", ignoreCase = true)
        ) {
            return t
        }
        AT_HANDLE.matchEntire(t)?.let { m ->
            return "https://t.me/${m.groupValues[1]}"
        }
        if (t.startsWith("t.me/", ignoreCase = true) ||
            t.startsWith("telegram.me/", ignoreCase = true)
        ) {
            return "https://$t"
        }
        if (t.startsWith("tg://", ignoreCase = true)) {
            val uri = Uri.parse(t)
            val domain = uri.getQueryParameter("domain")
            if (!domain.isNullOrBlank()) {
                val start = uri.getQueryParameter("start")
                return if (!start.isNullOrBlank()) {
                    "https://t.me/$domain?start=${Uri.encode(start)}"
                } else {
                    "https://t.me/$domain"
                }
            }
            val invite = uri.getQueryParameter("invite")
            if (!invite.isNullOrBlank()) return "https://t.me/+$invite"
        }
        return null
    }
}
