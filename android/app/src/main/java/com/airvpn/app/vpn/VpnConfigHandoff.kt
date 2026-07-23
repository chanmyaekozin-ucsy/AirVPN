package com.airvpn.app.vpn

/**
 * In-memory handoff for decrypted connect URIs so Intent extras never carry
 * SSH passwords (and so reconnect must re-fetch /v1/connect).
 */
object VpnConfigHandoff {
    @Volatile
    private var pending: String? = null

    fun put(configUri: String) {
        pending = configUri
    }

    fun take(): String? {
        val v = pending
        pending = null
        return v
    }

    fun clear() {
        pending = null
    }
}
