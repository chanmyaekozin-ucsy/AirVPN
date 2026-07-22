package com.airvpn.app.util

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Resolves a host to an IP, then looks up ISO country code for the flag.
 * Results are cached in memory + SharedPreferences (by IP).
 */
object GeoIpLookup {
    private const val TAG = "GeoIpLookup"
    private const val PREFS = "airvpn_geoip_cache"
    private const val PARALLELISM = 6

    private val memory = ConcurrentHashMap<String, String>() // ip → CC
    private val hostMemory = ConcurrentHashMap<String, String>() // host → CC
    private val mutex = Mutex()
    private var prefsReady = false

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    fun init(context: Context) {
        if (prefsReady) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.all.forEach { (k, v) ->
            if (v is String && v.length == 2) memory[k] = v.uppercase()
        }
        prefsReady = true
    }

    private fun persist(context: Context, ip: String, cc: String) {
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(ip, cc)
            .apply()
    }

    /**
     * @return map of original host → ISO country code (e.g. "SG")
     */
    suspend fun countryCodesForHosts(
        context: Context,
        hosts: Collection<String>,
    ): Map<String, String> = coroutineScope {
        init(context)
        val unique = hosts.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (unique.isEmpty()) return@coroutineScope emptyMap()

        val out = ConcurrentHashMap<String, String>()
        unique.chunked(PARALLELISM).forEach { chunk ->
            chunk.map { host ->
                async {
                    countryForHost(context, host)?.let { out[host] = it }
                }
            }.awaitAll()
        }
        out
    }

    suspend fun countryForHost(context: Context, host: String): String? {
        init(context)
        val key = host.trim().lowercase()
        if (key.isBlank()) return null
        hostMemory[key]?.let { return it }

        val ip = resolvePublicIpv4(host) ?: return null
        memory[ip]?.let { cc ->
            hostMemory[key] = cc
            return cc
        }

        val cc = lookupCountryCode(ip) ?: return null
        mutex.withLock {
            memory[ip] = cc
            hostMemory[key] = cc
            persist(context, ip, cc)
        }
        return cc
    }

    private suspend fun resolvePublicIpv4(host: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            if (isIpv4(host)) {
                return@runCatching if (isPublicIpv4(host)) host else null
            }
            InetAddress.getAllByName(host)
                .filterIsInstance<Inet4Address>()
                .map { it.hostAddress }
                .firstOrNull { addr -> addr != null && isPublicIpv4(addr) }
        }.getOrNull()
    }

    private suspend fun lookupCountryCode(ip: String): String? = withContext(Dispatchers.IO) {
        // HTTPS, no API key — returns {"ip":"...","country":"SG"}
        val url = "https://api.country.is/$ip"
        runCatching {
            val req = Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("User-Agent", "AirVPN/1.0 (Android)")
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.d(TAG, "geo $ip HTTP ${resp.code}")
                    return@runCatching null
                }
                val body = resp.body?.string().orEmpty()
                val cc = JSONObject(body).optString("country", "").trim().uppercase()
                if (cc.length == 2 && cc.all { it in 'A'..'Z' }) cc else null
            }
        }.onFailure { Log.d(TAG, "geo $ip: ${it.message}") }.getOrNull()
    }

    private fun isIpv4(s: String): Boolean {
        val parts = s.split('.')
        if (parts.size != 4) return false
        return parts.all { p -> p.toIntOrNull()?.let { it in 0..255 } == true }
    }

    private fun isPublicIpv4(ip: String): Boolean {
        val parts = ip.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4) return false
        val (a, b) = parts[0] to parts[1]
        return when {
            a == 10 -> false
            a == 127 -> false
            a == 0 -> false
            a == 169 && b == 254 -> false
            a == 172 && b in 16..31 -> false
            a == 192 && b == 168 -> false
            a >= 224 -> false // multicast / reserved
            else -> true
        }
    }
}
