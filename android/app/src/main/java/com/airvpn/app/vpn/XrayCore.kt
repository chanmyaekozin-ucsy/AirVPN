package com.airvpn.app.vpn

import android.content.Context
import android.util.Log
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Thin wrapper around AndroidLibXrayLite (libv2ray).
 */
object XrayCore {
    private const val TAG = "XrayCore"
    private val ready = AtomicBoolean(false)
    private var controller: CoreController? = null

    @Synchronized
    fun ensureReady(context: Context) {
        if (ready.get()) return
        val assetDir = File(context.filesDir, "xray")
        if (!assetDir.exists()) assetDir.mkdirs()
        // geoip needed for geoip:private routing rule
        copyAssetIfNeeded(context, "geoip.dat", File(assetDir, "geoip.dat"))
        // geosite optional — copy if present
        runCatching { copyAssetIfNeeded(context, "geosite.dat", File(assetDir, "geosite.dat")) }
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
                onStopped?.invoke()
                return 0
            }
            override fun onEmitStatus(l: Long, s: String?): Long {
                Log.d(TAG, "status[$l]: $s")
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
        try {
            if (core.isRunning) {
                core.stopLoop()
            }
        } catch (e: Exception) {
            Log.w(TAG, "stopLoop", e)
        }
    }

    val isRunning: Boolean
        get() = controller?.isRunning == true

    private fun copyAssetIfNeeded(context: Context, name: String, dest: File) {
        if (dest.exists() && dest.length() > 0) return
        context.assets.open(name).use { input ->
            FileOutputStream(dest).use { output -> input.copyTo(output) }
        }
    }
}
