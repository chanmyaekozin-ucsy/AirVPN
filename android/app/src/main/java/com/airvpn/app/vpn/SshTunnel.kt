package com.airvpn.app.vpn

import android.net.Network
import android.net.Uri
import android.util.Log
import com.airvpn.app.BuildConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.DirectConnection
import net.schmizz.sshj.transport.verification.PromiscuousVerifier
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Real SSH over optional TLS (stunnel-compatible, custom SNI) with a local SOCKS5
 * for Xray TUN. Credentials stay in memory for the session only.
 */
class SshTunnel private constructor(
    private val ssh: SSHClient,
    private val tlsBridge: TlsBridge?,
    private val socksServer: ServerSocket,
    private val pool: java.util.concurrent.ExecutorService,
    val localSocksPort: Int,
) {
    private val stopped = AtomicBoolean(false)
    /** Cap parallel DirectTCPIP — high enough for browsers; still guards runaway opens. */
    private val channelGate = Semaphore(MAX_CONCURRENT_CHANNELS)
    private val openChannels = AtomicInteger(0)

    fun isHealthy(): Boolean {
        if (stopped.get()) return false
        return try {
            ssh.isConnected && ssh.isAuthenticated
        } catch (_: Exception) {
            false
        }
    }

    /** Keep SSH/TLS sockets off the VPN routing table after TUN is up. */
    fun protectSockets(network: Network?, protect: (Socket) -> Boolean) {
        try {
            ssh.socket?.let { sock ->
                bindAndProtect(network, sock, protect)
            }
        } catch (e: Exception) {
            Log.w(TAG, "protect ssh.socket", e)
        }
        tlsBridge?.protectRemote(network, protect)
    }

    fun stop() {
        if (!stopped.compareAndSet(false, true)) return
        try {
            socksServer.close()
        } catch (_: Exception) {
        }
        try {
            pool.shutdownNow()
        } catch (_: Exception) {
        }
        try {
            if (ssh.isConnected) ssh.disconnect()
        } catch (_: Exception) {
        }
        try {
            ssh.close()
        } catch (_: Exception) {
        }
        tlsBridge?.stop()
    }

    data class Params(
        val host: String,
        val port: Int,
        val username: String,
        val password: String,
        val sni: String,
        val tls: Boolean,
        val allowInsecure: Boolean,
        val name: String,
    ) {
        fun redactedUri(): String {
            val q = buildString {
                append("tls=").append(if (tls) "1" else "0")
                if (sni.isNotBlank()) append("&sni=").append(Uri.encode(sni))
            }
            return "ssh://$username@$host:$port?$q"
        }
    }

    companion object {
        private const val TAG = "SshTunnel"
        private const val CONNECT_TIMEOUT_MS = 20_000
        /** Browsers/TikTok open many parallel TCP streams. */
        private const val MAX_CONCURRENT_CHANNELS = 48
        private const val SOCKS_POOL_SIZE = 16
        private const val PIPE_BUF = 32 * 1024
        private const val FLUSH_EVERY = 64 * 1024

        fun bindAndProtect(
            network: Network?,
            socket: Socket,
            protect: ((Socket) -> Boolean)?,
        ) {
            // bindSocket only works before connect — skip once the TLS/SSH socket is live
            if (!socket.isConnected) {
                try {
                    network?.bindSocket(socket)
                } catch (e: Exception) {
                    Log.w(TAG, "Network.bindSocket", e)
                }
            }
            protect?.invoke(socket)
        }

        fun parse(uri: String): Params {
            val raw = uri.trim()
            if (!raw.startsWith("ssh://", ignoreCase = true)) {
                throw IllegalArgumentException("Not an ssh:// URI")
            }
            val parsed = Uri.parse(raw)
            val host = parsed.host?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("SSH host missing")
            val userInfo = parsed.userInfo
                ?: throw IllegalArgumentException("SSH username missing")
            val colon = userInfo.indexOf(':')
            val username = if (colon >= 0) {
                urlDecode(userInfo.substring(0, colon))
            } else {
                urlDecode(userInfo)
            }
            val password = if (colon >= 0) urlDecode(userInfo.substring(colon + 1)) else ""
            if (username.isBlank()) throw IllegalArgumentException("SSH username missing")
            if (password.isBlank()) throw IllegalArgumentException("SSH password missing")
            val port = if (parsed.port > 0) parsed.port else 443
            val tls = parsed.getQueryParameter("tls")
                ?.let { it == "1" || it.equals("true", true) }
                ?: true
            val sni = parsed.getQueryParameter("sni")?.takeIf { it.isNotBlank() } ?: host
            // Stunnel + custom SNI (HTTP Injector): self-signed / non-matching cert
            var allowInsecure = parsed.getQueryParameter("allowInsecure")
                ?.let { it == "1" || it.equals("true", true) }
                ?: (parsed.getQueryParameter("allow_insecure")
                    ?.let { it == "1" || it.equals("true", true) }
                    ?: tls)
            if (tls && sni.isNotBlank() && !sni.equals(host, ignoreCase = true)) {
                allowInsecure = true
            }
            val name = parsed.fragment?.let { urlDecode(it) }.orEmpty()
            return Params(
                host = host,
                port = port,
                username = username,
                password = password,
                sni = sni,
                tls = tls,
                allowInsecure = allowInsecure,
                name = name,
            )
        }

        fun start(
            uri: String,
            underlyingNetwork: Network? = null,
            protect: ((Socket) -> Boolean)? = null,
        ): SshTunnel {
            ensureSecurityProviders()
            val p = parse(uri)
            Log.i(
                TAG,
                "starting host=${p.host} port=${p.port} tls=${p.tls} sni=${p.sni} user=${p.username}",
            )
            val tlsBridge = if (p.tls) {
                TlsBridge.start(p.host, p.port, p.sni, p.allowInsecure, underlyingNetwork, protect)
            } else {
                null
            }
            val ssh = SSHClient()
            // Outer TLS authenticates the path; sshd host key is behind stunnel.
            ssh.addHostKeyVerifier(PromiscuousVerifier())
            ssh.connectTimeout = CONNECT_TIMEOUT_MS
            // Only for handshake — do NOT leave a read timeout on the live session
            // (that causes idle drops; HTTP Injector keeps the socket blocking).
            ssh.timeout = CONNECT_TIMEOUT_MS
            try {
                if (tlsBridge != null) {
                    // Brief wait so the accept loop is scheduled
                    Thread.sleep(50)
                    ssh.connect("127.0.0.1", tlsBridge.localPort)
                } else {
                    ssh.connect(p.host, p.port)
                    bindAndProtect(underlyingNetwork, ssh.socket, protect)
                }
                ssh.authPassword(p.username, p.password.toCharArray())
                // Infinite socket read timeout + SSH keepalive (mobile NAT ~30–60s)
                ssh.timeout = 0
                try {
                    ssh.socket?.apply {
                        keepAlive = true
                        tcpNoDelay = true
                    }
                } catch (_: Exception) {
                }
                // Keepalive ~20s — enough for mobile NAT, less wakeups/heat than 10s
                ssh.connection.keepAlive.keepAliveInterval = 20
                try {
                    ssh.connection.windowSize = (2 * 1024 * 1024).toLong() // 2 MiB
                    ssh.connection.maxPacketSize = 32 * 1024
                } catch (_: Exception) {
                }
            } catch (e: Exception) {
                Log.e(TAG, "SSH start failed host=${p.host}:${p.port} tls=${p.tls}", e)
                try {
                    ssh.close()
                } catch (_: Exception) {
                }
                tlsBridge?.stop()
                throw IllegalStateException(humanSshError(e, p), e)
            }

            val socks = ServerSocket()
            socks.reuseAddress = true
            socks.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
            val localPort = socks.localPort
            // Bounded pool — unlimited cached threads were a heat source under TikTok
            val pool = Executors.newFixedThreadPool(SOCKS_POOL_SIZE) { r ->
                Thread(r, "ssh-socks").apply { isDaemon = false }
            }
            val tunnel = SshTunnel(ssh, tlsBridge, socks, pool, localPort)
            pool.execute {
                while (!socks.isClosed && !tunnel.stopped.get()) {
                    try {
                        val client = socks.accept()
                        pool.execute { tunnel.handleSocksClient(client) }
                    } catch (_: Exception) {
                        break
                    }
                }
            }
            Log.i(TAG, "SSH tunnel up socks=127.0.0.1:$localPort")
            return tunnel
        }

        fun buildXraySocksConfig(localPort: Int): String =
            VlessConfigBuilder.buildLocalSocks(localPort)

        private fun replySocks(out: DataOutputStream, rep: Int) {
            out.write(
                byteArrayOf(
                    0x05, rep.toByte(), 0x00, 0x01,
                    0, 0, 0, 0, 0, 0,
                ),
            )
            out.flush()
        }

        private fun pipe(input: InputStream, output: OutputStream) {
            val buf = ByteArray(PIPE_BUF)
            var pending = 0
            try {
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    pending += n
                    // Flush in batches — per-chunk flush burns CPU/heat
                    if (pending >= FLUSH_EVERY) {
                        output.flush()
                        pending = 0
                    }
                }
                if (pending > 0) output.flush()
            } catch (_: Exception) {
            } finally {
                try {
                    output.close()
                } catch (_: Exception) {
                }
                try {
                    input.close()
                } catch (_: Exception) {
                }
            }
        }

        private fun ensureSecurityProviders() {
            try {
                val bc = org.bouncycastle.jce.provider.BouncyCastleProvider()
                val existing = java.security.Security.getProvider(bc.name)
                if (existing == null) {
                    java.security.Security.insertProviderAt(bc, 1)
                } else if (existing.javaClass != bc.javaClass) {
                    java.security.Security.removeProvider(bc.name)
                    java.security.Security.insertProviderAt(bc, 1)
                }
            } catch (e: Exception) {
                Log.w(TAG, "BouncyCastle provider", e)
            }
        }

        private fun humanSshError(e: Exception, p: Params? = null): String {
            val chain = generateSequence(e as Throwable) { it.cause }
                .mapNotNull { it.message?.takeIf { m -> m.isNotBlank() } }
                .joinToString(" | ")
                .take(160)
            val tip = when {
                chain.contains("Auth fail", true) ||
                    chain.contains("authentication", true) -> "SSH auth failed"
                chain.contains("handshake", true) ||
                    chain.contains("SSL", true) ||
                    chain.contains("certificate", true) ||
                    chain.contains("Trust anchor", true) ->
                    "TLS handshake failed — turn off TLS wrap unless stunnel is running"
                chain.contains("Connection reset", true) ->
                    "Connection reset — wrong port or TLS/stunnel mismatch"
                chain.contains("timed out", true) ||
                    chain.contains("Timeout", true) -> "SSH connect timed out"
                chain.contains("Connection refused", true) -> "SSH connection refused"
                chain.contains("Network is unreachable", true) ||
                    chain.contains("Failed to connect", true) -> "SSH host unreachable"
                chain.contains("Unable to reach a settlement", true) ||
                    chain.contains("algorithm", true) -> "SSH algorithm negotiation failed"
                else -> "SSH connect failed"
            }
            val where = if (p != null) {
                " (${p.host}:${p.port} tls=${if (p.tls) "on" else "off"})"
            } else {
                ""
            }
            return tip + where
        }

        private fun urlDecode(s: String): String =
            try {
                URLDecoder.decode(s, StandardCharsets.UTF_8.name())
            } catch (_: Exception) {
                s
            }
    }

    private fun handleSocksClient(client: Socket) {
        var acquired = false
        try {
            client.tcpNoDelay = true
            val input = DataInputStream(client.getInputStream())
            val output = DataOutputStream(client.getOutputStream())
            // greeting
            val ver = input.readUnsignedByte()
            if (ver != 5) {
                client.close()
                return
            }
            val nMethods = input.readUnsignedByte()
            input.skipBytes(nMethods)
            output.write(byteArrayOf(0x05, 0x00))
            output.flush()
            // request
            val reqVer = input.readUnsignedByte()
            val cmd = input.readUnsignedByte()
            input.readUnsignedByte() // rsv
            val atyp = input.readUnsignedByte()
            if (reqVer != 5 || cmd != 1) {
                replySocks(output, 0x07)
                client.close()
                return
            }
            val destHost: String
            val destPort: Int
            when (atyp) {
                0x01 -> {
                    val addr = ByteArray(4)
                    input.readFully(addr)
                    destHost = InetAddress.getByAddress(addr).hostAddress ?: ""
                    destPort = input.readUnsignedShort()
                }
                0x03 -> {
                    val len = input.readUnsignedByte()
                    val name = ByteArray(len)
                    input.readFully(name)
                    destHost = String(name, StandardCharsets.UTF_8)
                    destPort = input.readUnsignedShort()
                }
                0x04 -> {
                    val addr = ByteArray(16)
                    input.readFully(addr)
                    destHost = InetAddress.getByAddress(addr).hostAddress ?: ""
                    destPort = input.readUnsignedShort()
                }
                else -> {
                    replySocks(output, 0x08)
                    client.close()
                    return
                }
            }
            if (destHost.isBlank() || destPort <= 0) {
                replySocks(output, 0x01)
                client.close()
                return
            }
            if (!channelGate.tryAcquire(45, TimeUnit.SECONDS)) {
                Log.w(TAG, "channel limit reached ($MAX_CONCURRENT_CHANNELS) open=${openChannels.get()}")
                replySocks(output, 0x05)
                client.close()
                return
            }
            acquired = true
            openChannels.incrementAndGet()
            val channel: DirectConnection = try {
                ssh.newDirectConnection(destHost, destPort)
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "direct-tcpip failed dest=$destHost:$destPort", e)
                }
                replySocks(output, 0x05)
                client.close()
                return
            }
            replySocks(output, 0x00)
            // Relay on the bounded pool (caller already runs on pool thread) —
            // use inline pipes with two short-lived join threads still, but daemon.
            val t1 = Thread({
                pipe(client.getInputStream(), channel.outputStream)
            }, "ssh-up").apply { isDaemon = true }
            val t2 = Thread({
                pipe(channel.inputStream, client.getOutputStream())
            }, "ssh-down").apply { isDaemon = true }
            t1.start()
            t2.start()
            t1.join()
            t2.join()
            try {
                channel.close()
            } catch (_: Exception) {
            }
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "socks client", e)
            }
        } finally {
            if (acquired) {
                openChannels.decrementAndGet()
                channelGate.release()
            }
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    /** Local TCP → TLS+SNI to remote (stunnel client role). */
    private class TlsBridge private constructor(
        private val serverSocket: ServerSocket,
        private val pool: java.util.concurrent.ExecutorService,
    ) {
        val localPort: Int = serverSocket.localPort
        private val stopped = AtomicBoolean(false)
        @Volatile
        private var remoteSocket: SSLSocket? = null

        fun protectRemote(network: Network?, protect: (Socket) -> Boolean) {
            remoteSocket?.let { sock ->
                bindAndProtect(network, sock, protect)
            }
        }

        fun stop() {
            if (!stopped.compareAndSet(false, true)) return
            try {
                serverSocket.close()
            } catch (_: Exception) {
            }
            try {
                remoteSocket?.close()
            } catch (_: Exception) {
            }
            remoteSocket = null
            try {
                pool.shutdownNow()
            } catch (_: Exception) {
            }
        }

        private fun relay(
            local: Socket,
            host: String,
            port: Int,
            sni: String,
            allowInsecure: Boolean,
            network: Network?,
            protect: ((Socket) -> Boolean)?,
        ) {
            var remote: SSLSocket? = null
            try {
                local.tcpNoDelay = true
                local.keepAlive = true
                remote = openTlsSocket(host, port, sni, allowInsecure, network, protect)
                remoteSocket = remote
                remote.keepAlive = true
                remote.tcpNoDelay = true
                remote.soTimeout = 0
                local.soTimeout = 0
                Log.i(TAG, "tls bridge up → $host:$port sni=$sni")
                val t1 = Thread({
                    pipeQuiet(local.getInputStream(), remote.getOutputStream())
                }, "tls-up").apply { isDaemon = true }
                val t2 = Thread({
                    pipeQuiet(remote.getInputStream(), local.getOutputStream())
                }, "tls-down").apply { isDaemon = true }
                t1.start()
                t2.start()
                t1.join()
                t2.join()
                Log.w(TAG, "tls bridge closed → $host:$port")
            } catch (e: Exception) {
                Log.w(TAG, "tls bridge error → $host:$port", e)
            } finally {
                if (remoteSocket === remote) remoteSocket = null
                try {
                    local.close()
                } catch (_: Exception) {
                }
                try {
                    remote?.close()
                } catch (_: Exception) {
                }
            }
        }

        companion object {
            fun start(
                host: String,
                port: Int,
                sni: String,
                allowInsecure: Boolean,
                network: Network?,
                protect: ((Socket) -> Boolean)?,
            ): TlsBridge {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
                val pool = Executors.newFixedThreadPool(2) { r ->
                    Thread(r, "ssh-tls-bridge").apply { isDaemon = false }
                }
                val bridge = TlsBridge(ss, pool)
                pool.execute {
                    while (!ss.isClosed && !bridge.stopped.get()) {
                        try {
                            val local = ss.accept()
                            pool.execute {
                                bridge.relay(local, host, port, sni, allowInsecure, network, protect)
                            }
                        } catch (_: Exception) {
                            break
                        }
                    }
                }
                return bridge
            }

            private fun pipeQuiet(input: InputStream, output: OutputStream) {
                val buf = ByteArray(PIPE_BUF)
                var pending = 0
                try {
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        pending += n
                        if (pending >= FLUSH_EVERY) {
                            output.flush()
                            pending = 0
                        }
                    }
                    if (pending > 0) output.flush()
                } catch (_: Exception) {
                }
            }

            private fun openTlsSocket(
                host: String,
                port: Int,
                sni: String,
                allowInsecure: Boolean,
                network: Network?,
                protect: ((Socket) -> Boolean)?,
            ): SSLSocket {
                val ctx = if (allowInsecure) {
                    insecureSslContext()
                } else {
                    SSLContext.getInstance("TLS").apply { init(null, null, null) }
                }
                val socket = ctx.socketFactory.createSocket() as SSLSocket
                socket.tcpNoDelay = true
                val params = socket.sslParameters
                params.serverNames = listOf(SNIHostName(sni))
                socket.sslParameters = params
                // Bind to Wi‑Fi/cell + protect before connect so path never enters TUN
                bindAndProtect(network, socket, protect)
                socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
                socket.startHandshake()
                return socket
            }

            private fun insecureSslContext(): SSLContext {
                val trustAll = arrayOf<TrustManager>(
                    object : X509TrustManager {
                        override fun checkClientTrusted(
                            chain: Array<java.security.cert.X509Certificate>,
                            authType: String,
                        ) = Unit

                        override fun checkServerTrusted(
                            chain: Array<java.security.cert.X509Certificate>,
                            authType: String,
                        ) = Unit

                        override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> =
                            emptyArray()
                    },
                )
                return SSLContext.getInstance("TLS").apply {
                    init(null, trustAll, SecureRandom())
                }
            }
        }
    }
}
