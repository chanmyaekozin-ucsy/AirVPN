package com.airvpn.app.vpn

import android.net.Uri
import android.util.Log
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
import java.util.concurrent.atomic.AtomicBoolean
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

        fun start(uri: String): SshTunnel {
            ensureSecurityProviders()
            val p = parse(uri)
            Log.i(
                TAG,
                "starting host=${p.host} port=${p.port} tls=${p.tls} sni=${p.sni} user=${p.username}",
            )
            val tlsBridge = if (p.tls) {
                TlsBridge.start(p.host, p.port, p.sni, p.allowInsecure)
            } else {
                null
            }
            val ssh = SSHClient()
            // Outer TLS authenticates the path; sshd host key is behind stunnel.
            ssh.addHostKeyVerifier(PromiscuousVerifier())
            ssh.connectTimeout = CONNECT_TIMEOUT_MS
            ssh.timeout = CONNECT_TIMEOUT_MS
            try {
                if (tlsBridge != null) {
                    // Brief wait so the accept loop is scheduled
                    Thread.sleep(50)
                    ssh.connect("127.0.0.1", tlsBridge.localPort)
                } else {
                    ssh.connect(p.host, p.port)
                }
                ssh.authPassword(p.username, p.password.toCharArray())
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
            val pool = Executors.newCachedThreadPool { r ->
                Thread(r, "ssh-socks").apply { isDaemon = true }
            }
            val tunnel = SshTunnel(ssh, tlsBridge, socks, pool, localPort)
            pool.execute {
                while (!socks.isClosed && !tunnel.stopped.get()) {
                    try {
                        val client = socks.accept()
                        pool.execute { handleSocksClient(ssh, client) }
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

        private fun handleSocksClient(ssh: SSHClient, client: Socket) {
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
                val channel: DirectConnection = try {
                    ssh.newDirectConnection(destHost, destPort)
                } catch (e: Exception) {
                    Log.d(TAG, "direct-tcpip failed", e)
                    replySocks(output, 0x05)
                    client.close()
                    return
                }
                replySocks(output, 0x00)
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
                Log.d(TAG, "socks client", e)
            } finally {
                try {
                    client.close()
                } catch (_: Exception) {
                }
            }
        }

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
            val buf = ByteArray(16 * 1024)
            try {
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    output.flush()
                }
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

    /** Local TCP → TLS+SNI to remote (stunnel client role). */
    private class TlsBridge private constructor(
        private val serverSocket: ServerSocket,
        private val pool: java.util.concurrent.ExecutorService,
    ) {
        val localPort: Int = serverSocket.localPort
        private val stopped = AtomicBoolean(false)

        fun stop() {
            if (!stopped.compareAndSet(false, true)) return
            try {
                serverSocket.close()
            } catch (_: Exception) {
            }
            try {
                pool.shutdownNow()
            } catch (_: Exception) {
            }
        }

        companion object {
            fun start(
                host: String,
                port: Int,
                sni: String,
                allowInsecure: Boolean,
            ): TlsBridge {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
                val pool = Executors.newCachedThreadPool { r ->
                    Thread(r, "ssh-tls-bridge").apply { isDaemon = true }
                }
                val bridge = TlsBridge(ss, pool)
                pool.execute {
                    while (!ss.isClosed && !bridge.stopped.get()) {
                        try {
                            val local = ss.accept()
                            pool.execute {
                                relay(local, host, port, sni, allowInsecure)
                            }
                        } catch (_: Exception) {
                            break
                        }
                    }
                }
                return bridge
            }

            private fun relay(
                local: Socket,
                host: String,
                port: Int,
                sni: String,
                allowInsecure: Boolean,
            ) {
                var remote: SSLSocket? = null
                try {
                    local.tcpNoDelay = true
                    remote = openTlsSocket(host, port, sni, allowInsecure)
                    val t1 = Thread({
                        pipeQuiet(local.getInputStream(), remote!!.getOutputStream())
                    }, "tls-up").apply { isDaemon = true }
                    val t2 = Thread({
                        pipeQuiet(remote!!.getInputStream(), local.getOutputStream())
                    }, "tls-down").apply { isDaemon = true }
                    t1.start()
                    t2.start()
                    t1.join()
                    t2.join()
                } catch (e: Exception) {
                    Log.d(TAG, "tls bridge", e)
                } finally {
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

            private fun pipeQuiet(input: InputStream, output: OutputStream) {
                val buf = ByteArray(16 * 1024)
                try {
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        output.flush()
                    }
                } catch (_: Exception) {
                }
            }

            private fun openTlsSocket(
                host: String,
                port: Int,
                sni: String,
                allowInsecure: Boolean,
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
