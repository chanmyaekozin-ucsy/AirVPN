package com.airvpn.app.util

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.InetSocketAddress
import java.net.Socket

/**
 * TCP connect latency to a node host:port (not ICMP).
 * Returns round-trip milliseconds, or null on timeout / failure.
 * Never throws — failures are returned as null.
 */
object ServerPinger {
    private const val DEFAULT_TIMEOUT_MS = 2_500L
    private const val PARALLELISM = 8

    suspend fun ping(host: String, port: Int, timeoutMs: Long = DEFAULT_TIMEOUT_MS): Int? =
        withContext(Dispatchers.IO) {
            runCatching {
                withTimeoutOrNull(timeoutMs) {
                    val socket = Socket()
                    try {
                        val start = System.nanoTime()
                        socket.connect(
                            InetSocketAddress(host, port),
                            timeoutMs.toInt().coerceAtLeast(1),
                        )
                        ((System.nanoTime() - start) / 1_000_000L).toInt().coerceAtLeast(1)
                    } finally {
                        runCatching { socket.close() }
                    }
                }
            }.getOrNull()
        }

    /**
     * Ping many endpoints with limited parallelism.
     * @return map of key → latency ms (null = unreachable)
     */
    suspend fun pingAll(
        targets: List<Pair<String, Pair<String, Int>>>,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): Map<String, Int?> = coroutineScope {
        if (targets.isEmpty()) return@coroutineScope emptyMap()
        val out = LinkedHashMap<String, Int?>()
        targets.chunked(PARALLELISM).forEach { chunk ->
            chunk.map { (key, endpoint) ->
                async {
                    key to ping(endpoint.first, endpoint.second, timeoutMs)
                }
            }.awaitAll().forEach { (key, ms) ->
                out[key] = ms
            }
        }
        out
    }
}
