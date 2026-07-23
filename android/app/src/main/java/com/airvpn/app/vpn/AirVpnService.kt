package com.airvpn.app.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.airvpn.app.MainActivity
import com.airvpn.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class VpnState {
    Idle,
    Connecting,
    Connected,
    Disconnecting,
    Error,
}

/**
 * VPN service: VLESS/SS via Xray, or SSH-over-TLS (+ local SOCKS → Xray TUN).
 */
class AirVpnService : VpnService() {

    private var tun: ParcelFileDescriptor? = null
    private var sshTunnel: SshTunnel? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var connectJob: Job? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                // Prefer memory handoff (SSH secrets); fall back to Intent for VLESS/SS.
                val uri = VpnConfigHandoff.take()
                    ?: intent.getStringExtra(EXTRA_CONFIG_URI)
                val name = intent.getStringExtra(EXTRA_SERVER_NAME) ?: "AirVPN"
                if (uri.isNullOrBlank()) {
                    fail("Missing VPN config")
                    stopSelf()
                    return START_NOT_STICKY
                }
                connect(uri, name)
            }
            ACTION_DISCONNECT -> disconnect()
        }
        return START_STICKY
    }

    private fun connect(configUri: String, serverName: String) {
        connectJob?.cancel()
        connectJob = scope.launch {
            _state.value = VpnState.Connecting
            _errorMessage.value = null
            try {
                startVpnForeground(buildNotification(serverName, connecting = true))

                val isSsh = configUri.trim().startsWith("ssh://", ignoreCase = true)
                val configJson: String
                if (isSsh) {
                    // Establish SSH (+ TLS/SNI) before TUN so dialing is outside the VPN.
                    cleanupSshOnly()
                    val tunnel = SshTunnel.start(configUri)
                    sshTunnel = tunnel
                    configJson = SshTunnel.buildXraySocksConfig(tunnel.localSocksPort)
                } else {
                    configJson = VlessConfigBuilder.build(configUri)
                }

                val builder = Builder()
                    .setSession("AirVPN · $serverName")
                    .setMtu(1500)
                    .addAddress("10.8.0.2", 30)
                    .addDnsServer("1.1.1.1")
                    .addDnsServer("8.8.8.8")
                    .addRoute("0.0.0.0", 0)
                // Keep our process off the VPN so Xray/SSH can dial without a routing loop
                try {
                    builder.addDisallowedApplication(packageName)
                } catch (e: Exception) {
                    Log.w(TAG, "addDisallowedApplication", e)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    builder.setMetered(false)
                }
                try {
                    builder.addRoute("::", 0)
                    builder.addAddress("fd00:8:8:8::2", 64)
                } catch (_: Exception) {
                    // some devices reject IPv6 TUN
                }

                tun?.close()
                val established = builder.establish()
                if (established == null) {
                    fail("VPN permission denied or another VPN is active")
                    cleanupAll()
                    stopForegroundSafe()
                    stopSelf()
                    return@launch
                }
                tun = established
                val fd = established.fd
                if (fd < 3) {
                    fail("Invalid TUN file descriptor")
                    cleanupAll()
                    stopForegroundSafe()
                    stopSelf()
                    return@launch
                }

                XrayCore.start(
                    context = applicationContext,
                    configJson = configJson,
                    tunFd = fd,
                    onStopped = {
                        scope.launch {
                            if (_state.value == VpnState.Connected) {
                                fail("VPN core stopped unexpectedly")
                                cleanupAll()
                                stopForegroundSafe()
                                stopSelf()
                            }
                        }
                    },
                )

                lastTunFd = fd
                lastConfigLen = configUri.length
                // Never retain SSH passwords in the companion snapshot
                activeConfigUri = if (isSsh) {
                    runCatching { SshTunnel.parse(configUri).redactedUri() }.getOrNull()
                } else {
                    configUri
                }
                _state.value = VpnState.Connected
                _errorMessage.value = null
                startVpnForeground(buildNotification(serverName, connecting = false))
                Log.i(TAG, "tunnel up")
            } catch (e: Exception) {
                Log.e(TAG, "connect failed", e)
                fail(humanError(e))
                cleanupAll()
                stopForegroundSafe()
                stopSelf()
            }
        }
    }

    private fun humanError(e: Exception): String {
        val msg = e.message.orEmpty()
        return when {
            msg.contains("SSH", ignoreCase = true) -> msg.take(120)
            msg.contains("TLS", ignoreCase = true) -> msg.take(120)
            msg.contains("config error", ignoreCase = true) -> "Invalid Xray config"
            msg.contains("core init", ignoreCase = true) -> "Xray failed to start"
            msg.contains("Unsupported", ignoreCase = true) -> msg
            msg.contains("Missing", ignoreCase = true) -> msg
            msg.isNotBlank() -> msg.take(120)
            else -> e.javaClass.simpleName
        }
    }

    private fun startVpnForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun disconnect() {
        _state.value = VpnState.Disconnecting
        cleanupAll()
        stopForegroundSafe()
        _state.value = VpnState.Idle
        _errorMessage.value = null
        stopSelf()
    }

    private fun cleanupSshOnly() {
        try {
            sshTunnel?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "ssh stop", e)
        }
        sshTunnel = null
    }

    private fun cleanupAll() {
        try {
            XrayCore.stop()
        } catch (e: Exception) {
            Log.w(TAG, "xray stop", e)
        }
        cleanupSshOnly()
        try {
            tun?.close()
        } catch (_: Exception) {
        }
        tun = null
        activeConfigUri = null
        VpnConfigHandoff.clear()
    }

    private fun stopForegroundSafe() {
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {
        }
    }

    private fun fail(message: String) {
        _errorMessage.value = message
        _state.value = VpnState.Error
    }

    private fun buildNotification(serverName: String, connecting: Boolean): Notification {
        val channelId = "airvpn_vpn"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    "VPN",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        val pi = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle(getString(R.string.vpn_notification_title))
            .setContentText(
                if (connecting) {
                    "Connecting to $serverName…"
                } else {
                    getString(R.string.vpn_notification_connected) + " · $serverName"
                },
            )
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setContentIntent(pi)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    override fun onDestroy() {
        connectJob?.cancel()
        cleanupAll()
        scope.cancel()
        if (_state.value != VpnState.Idle && _state.value != VpnState.Error) {
            _state.value = VpnState.Idle
        }
        super.onDestroy()
    }

    override fun onRevoke() {
        disconnect()
        super.onRevoke()
    }

    companion object {
        private const val TAG = "AirVpnService"
        const val ACTION_CONNECT = "com.airvpn.app.CONNECT"
        const val ACTION_DISCONNECT = "com.airvpn.app.DISCONNECT"
        const val EXTRA_CONFIG_URI = "config_uri"
        const val EXTRA_SERVER_NAME = "server_name"
        private const val NOTIF_ID = 42

        private val _state = MutableStateFlow(VpnState.Idle)
        val state: StateFlow<VpnState> = _state.asStateFlow()

        private val _errorMessage = MutableStateFlow<String?>(null)
        val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

        @Volatile
        var activeConfigUri: String? = null
            private set

        @Volatile
        var lastTunFd: Int = -1
            private set

        @Volatile
        var lastConfigLen: Int = 0
            private set

        fun clearError() {
            if (_state.value == VpnState.Error) {
                _state.value = VpnState.Idle
                _errorMessage.value = null
            }
        }
    }
}
