package com.airvpn.app.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.IpPrefix
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.airvpn.app.MainActivity
import com.airvpn.app.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.Socket

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
    private var sshWatchJob: Job? = null
    /** Full SSH URI kept only while the VPN session is live (reconnect). */
    private var liveSshUri: String? = null
    private var liveServerName: String? = null

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
        sshWatchJob?.cancel()
        connectJob = scope.launch {
            _state.value = VpnState.Connecting
            _errorMessage.value = null
            try {
                startVpnForeground(buildNotification(serverName, connecting = true))

                val isSsh = configUri.trim().startsWith("ssh://", ignoreCase = true)
                val configJson: String
                val sshParams = if (isSsh) {
                    runCatching { SshTunnel.parse(configUri) }.getOrNull()
                } else {
                    null
                }
                if (isSsh) {
                    // Establish SSH (+ TLS/SNI) before TUN so dialing is outside the VPN.
                    cleanupSshOnly()
                    val underlying = underlyingNetwork()
                    Log.i(TAG, "SSH dial via network=${underlying?.toString() ?: "default"}")
                    val tunnel = SshTunnel.start(
                        uri = configUri,
                        underlyingNetwork = underlying,
                        protect = { socket -> protectSocketLogged(socket) },
                    )
                    sshTunnel = tunnel
                    liveSshUri = configUri
                    liveServerName = serverName
                    configJson = SshTunnel.buildXraySocksConfig(tunnel.localSocksPort)
                } else {
                    liveSshUri = null
                    liveServerName = null
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
                // Critical on Samsung: keep stunnel/SSH IP off the TUN so the TLS
                // path cannot be black-holed after establish() (API 33+).
                if (isSsh && sshParams != null && Build.VERSION.SDK_INT >= 33) {
                    excludeHostFromVpn(builder, sshParams.host)
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

                // Re-bind/protect SSH/TLS sockets now that the TUN owns default routes
                val underlyingAfter = underlyingNetwork()
                sshTunnel?.protectSockets(underlyingAfter) { socket ->
                    protectSocketLogged(socket)
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
                if (isSsh) {
                    startSshWatchdog(serverName)
                }
            } catch (e: CancellationException) {
                // New connect / destroy cancelled us — do not fail or tear down the replacement.
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "connect failed", e)
                fail(humanError(e))
                cleanupAll()
                stopForegroundSafe()
                stopSelf()
            }
        }
    }

    private fun startSshWatchdog(serverName: String) {
        sshWatchJob?.cancel()
        sshWatchJob = scope.launch {
            var failures = 0
            var reconnects = 0
            while (isActive && _state.value == VpnState.Connected) {
                delay(12_000)
                val tunnel = sshTunnel
                if (tunnel == null || !tunnel.isHealthy()) {
                    failures++
                    Log.w(TAG, "SSH health check failed ($failures)")
                    if (failures >= 2) {
                        val uri = liveSshUri
                        if (uri != null && reconnects < 3) {
                            reconnects++
                            Log.w(TAG, "SSH dead — reconnect attempt $reconnects")
                            startVpnForeground(buildNotification(serverName, connecting = true))
                            if (reconnectSsh(uri)) {
                                failures = 0
                                startVpnForeground(buildNotification(serverName, connecting = false))
                                continue
                            }
                        }
                        fail("SSH tunnel disconnected")
                        cleanupAll()
                        stopForegroundSafe()
                        stopSelf()
                        break
                    }
                } else {
                    failures = 0
                    val net = underlyingNetwork()
                    tunnel.protectSockets(net) { socket ->
                        protectSocketLogged(socket)
                    }
                }
            }
            Log.d(TAG, "SSH watchdog end for $serverName")
        }
    }

    /** Rebuild SSH+TLS and reattach Xray to the existing TUN. */
    private fun reconnectSsh(uri: String): Boolean {
        return try {
            try {
                XrayCore.stop()
            } catch (e: Exception) {
                Log.w(TAG, "xray stop for reconnect", e)
            }
            cleanupSshOnly()
            val underlying = underlyingNetwork()
            val tunnel = SshTunnel.start(
                uri = uri,
                underlyingNetwork = underlying,
                protect = { socket -> protectSocketLogged(socket) },
            )
            sshTunnel = tunnel
            liveSshUri = uri
            tunnel.protectSockets(underlying) { socket ->
                protectSocketLogged(socket)
            }
            val fd = tun?.fd ?: return false
            if (fd < 3) return false
            val configJson = SshTunnel.buildXraySocksConfig(tunnel.localSocksPort)
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
            Log.i(TAG, "SSH reconnected socks=${tunnel.localSocksPort}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "SSH reconnect failed", e)
            false
        }
    }

    private fun protectSocketLogged(socket: Socket): Boolean {
        val ok = try {
            protect(socket)
        } catch (e: Exception) {
            Log.w(TAG, "protect() threw", e)
            false
        }
        if (!ok) {
            Log.w(TAG, "protect() returned false for $socket")
        }
        return ok
    }

    /** Prefer Wi‑Fi/cellular, never the VPN network itself. */
    private fun underlyingNetwork(): Network? {
        return try {
            val cm = getSystemService(ConnectivityManager::class.java) ?: return null
            val networks = cm.allNetworks
            for (n in networks) {
                val caps = cm.getNetworkCapabilities(n) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
                if (Build.VERSION.SDK_INT >= 28 &&
                    !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                ) {
                    continue
                }
                return n
            }
            cm.activeNetwork
        } catch (e: SecurityException) {
            Log.w(TAG, "underlyingNetwork unavailable", e)
            null
        } catch (e: Exception) {
            Log.w(TAG, "underlyingNetwork", e)
            null
        }
    }

    private fun excludeHostFromVpn(builder: Builder, host: String) {
        if (Build.VERSION.SDK_INT < 33) return
        try {
            val addrs = InetAddress.getAllByName(host)
            for (addr in addrs) {
                when (addr) {
                    is Inet4Address -> {
                        builder.excludeRoute(IpPrefix(addr, 32))
                        Log.i(TAG, "excludeRoute ${addr.hostAddress}/32")
                    }
                    is Inet6Address -> {
                        builder.excludeRoute(IpPrefix(addr, 128))
                        Log.i(TAG, "excludeRoute ${addr.hostAddress}/128")
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "excludeHostFromVpn $host", e)
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
        sshWatchJob?.cancel()
        sshWatchJob = null
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
        liveSshUri = null
    }

    private fun cleanupAll() {
        sshWatchJob?.cancel()
        sshWatchJob = null
        try {
            XrayCore.stop()
        } catch (e: Exception) {
            Log.w(TAG, "xray stop", e)
        }
        cleanupSshOnly()
        liveServerName = null
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
