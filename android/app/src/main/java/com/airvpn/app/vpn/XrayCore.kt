package com.airvpn.app.vpn

import android.content.Context
import android.util.Log
import com.airvpn.app.BuildConfig
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Thin wrapper around AndroidLibXrayLite (libv2ray).
 * Routing uses hardcoded private CIDRs — no geoip/geosite.dat bundled.
 */
object XrayCore {
    private const val TAG = "XrayCore"
    private val ready = AtomicBoolean(false)
    /** True while we are intentionally stopping — ignore shutdown callback. */
    private val intentionalStop = AtomicBoolean(false)
    private var controller: CoreController? = null

    @Synchronized
    fun ensureReady(context: Context) {
        if (ready.get()) return
        val assetDir = File(context.filesDir, "xray")
        if (!assetDir.exists()) assetDir.mkdirs()
        // Drop leftover geo DBs from older installs (were ~27MB on disk).
        File(assetDir, "geoip.dat").delete()
        File(assetDir, "geosite.dat").delete()
        Libv2ray.initCoreEnv(assetDir.absolutePath, "")
        ready.set(true)
        Log.i(TAG, "init ok version=${Libv2ray.checkVersionX()}")
    }

    @Synchronized
    fun start(context: Context, configJson: String, tunFd: Int, onStopped: (() -> Unit)? = null) {
        ensureReady(context)
        stop()
        val cb = object : CoreCallbackHandler {
            override fun startup(): Long = 0
            override fun shutdown(): Long {
                // stopLoop() always fires this — only treat unexpected exits as failures
                if (!intentionalStop.get()) {
                    onStopped?.invoke()
                }
                return 0
            }
            override fun onEmitStatus(l: Long, s: String?): Long {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "status[$l]: $s")
                }
                return 0
            }
        }
        val core = Libv2ray.newCoreController(cb)
        controller = core
        // tunFd is injected via env xray.tun.fd inside StartLoop
        core.startLoop(configJson, tunFd)
        if (!core.isRunning) {
            controller = null
            throw IllegalStateException("Xray core failed to start")
        }
        Log.i(TAG, "core running fd=$tunFd")
    }

    @Synchronized
    fun stop() {
        val core = controller ?: return
        controller = null
        intentionalStop.set(true)
        try {
            if (core.isRunning) {
                core.stopLoop()
            }
        } catch (e: Exception) {
            Log.w(TAG, "stopLoop", e)
        } finally {
            intentionalStop.set(false)
        }
    }

    val isRunning: Boolean
        get() = controller?.isRunning == true
}
